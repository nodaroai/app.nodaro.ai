/**
 * Trigger lanes served by a plugin daemon (`tk.triggers`, daemon host only).
 *
 * A daemon holds a live connection on a user's behalf and hears events no
 * webhook delivers. It reads its lane's active `workflow_triggers` rows and,
 * when an event matches one, asks the host to fire it. The host — not the
 * plugin — owns everything a fire must get right, as the built-in lanes do
 * (routes/telegram-webhook.ts, routes/webhook-triggers.ts, lib/schedule-cron.ts):
 *
 *   1. the row is re-read by id: it must still exist, be active and belong to
 *      a plugin lane; its workflow, owner and node come from the ROW, so a
 *      daemon names a trigger and can never start someone else's workflow;
 *   2. the row must still name the account the event came from, and that
 *      account must be its owner's (the daemon's view may be a refresh stale);
 *   3. the trigger node must still be on the graph — a run scoped to a missing
 *      node would run the WHOLE workflow, so an orphaned row is switched off;
 *   4. a stranger controls the volume, so each trigger is rate-limited and
 *      capped in runs in flight (`throttled`) — no flood, no reply loop;
 *   5. the owner may still run the workflow (`canRunWorkflow`), else ONE
 *      visible failed row (`recordTriggerFireRefusal`);
 *   6. the payer is resolved at fire time, and a degraded resolve on
 *      workspace-homed work refuses rather than bills;
 *   7. the execution row carries a lane-namespaced `idempotency_key` — the
 *      unique (user_id, idempotency_key) index turns a redelivered event into
 *      `duplicate` instead of a second paid run;
 *   8. the run is queued with `triggerNodeId`, so only the branch behind the
 *      trigger node executes (`triggerRunScope`).
 */
import { TELEGRAM_ACCOUNT_TRIGGER_NODE_TYPE } from "@nodaro/shared"
import type {
  PluginTriggerFireInput,
  PluginTriggerFireResult,
  PluginTriggerLane,
  PluginTriggerRow,
} from "./private-plugins/daemon-contract.js"
import type { WorkflowExecutionJob } from "../services/workflow-engine/types.js"
import { supabase } from "./supabase.js"
import { redis } from "./queue.js"
import { getRuntimeEnv } from "./runtime-env.js"
import { canRunWorkflow } from "./workflow-access.js"
import { recordTriggerFireRefusal } from "./trigger-fire-refusal.js"
import { resolveBillingContext, shouldRefuseDegradedRunFor } from "./billing-context.js"
import { billingPairColumns } from "./insert-job.js"
import { orchestrationQueue } from "./orchestration-queue.js"

/** Each plugin lane and the node type its rows are projected from. */
const NODE_TYPE_BY_LANE: Readonly<Record<PluginTriggerLane, string>> = {
  telegram_account: TELEGRAM_ACCOUNT_TRIGGER_NODE_TYPE,
}
export const PLUGIN_TRIGGER_LANES = Object.keys(NODE_TYPE_BY_LANE) as readonly PluginTriggerLane[]

/** A message is small; a payload past this is a daemon bug, not a message. */
export const MAX_TRIGGER_DATA_BYTES = 64 * 1024
/** Fires per trigger per clock minute. */
export const TRIGGER_FIRES_PER_MINUTE = 20
/** Runs of one trigger's workflow that may be pending or running at once. */
export const MAX_TRIGGER_RUNS_IN_FLIGHT = 3
const MAX_IDEMPOTENCY_KEY_LENGTH = 200
const UNIQUE_VIOLATION = "23505"

function isPluginLane(type: unknown): type is PluginTriggerLane {
  return typeof type === "string" && (PLUGIN_TRIGGER_LANES as readonly string[]).includes(type)
}

function nodeIdOf(config: unknown): string | null {
  const nodeId = (config as { nodeId?: unknown } | null)?.nodeId
  return typeof nodeId === "string" && nodeId.trim() !== "" ? nodeId : null
}

export async function listActivePluginTriggers(query: { type: PluginTriggerLane }): Promise<PluginTriggerRow[]> {
  if (!isPluginLane(query.type)) throw new Error(`not a plugin trigger lane: ${String(query.type)}`)
  const { data, error } = await supabase
    .from("workflow_triggers")
    .select("id, workflow_id, user_id, config")
    .eq("type", query.type)
    .eq("is_active", true)
  if (error) throw new Error(`workflow_triggers read failed: ${error.message}`)
  return (data ?? []).map((row) => {
    const config = (row.config && typeof row.config === "object" ? row.config : {}) as Record<string, unknown>
    return { id: row.id, workflowId: row.workflow_id, userId: row.user_id, nodeId: nodeIdOf(config), config }
  })
}

function validateFireInput(input: PluginTriggerFireInput): void {
  if (typeof input.triggerId !== "string" || input.triggerId.trim() === "") throw new Error("triggerId is required")
  if (typeof input.accountId !== "string" || input.accountId.trim() === "") throw new Error("accountId is required")
  const key = input.idempotencyKey
  if (typeof key !== "string" || key.trim() === "" || key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new Error(`idempotencyKey must be 1..${MAX_IDEMPOTENCY_KEY_LENGTH} characters`)
  }
  const data = input.triggerData
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("triggerData must be an object")
  if (Buffer.byteLength(JSON.stringify(data), "utf8") > MAX_TRIGGER_DATA_BYTES) {
    throw new Error(`triggerData exceeds ${MAX_TRIGGER_DATA_BYTES} bytes`)
  }
}

/** The owner's own account, in this environment. */
async function accountIsOwners(accountId: string, userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("plugin_account_secrets")
    .select("id")
    .eq("id", accountId)
    .eq("user_id", userId)
    .eq("runtime_env", getRuntimeEnv())
    .maybeSingle()
  if (error) throw new Error(`plugin_account_secrets read failed: ${error.message}`)
  return data !== null
}

async function triggerNodeOnGraph(workflowId: string, nodeId: string, nodeType: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("workflows")
    .select("id")
    .eq("id", workflowId)
    .contains("nodes", [{ id: nodeId, type: nodeType }])
    .maybeSingle()
  if (error) throw new Error(`workflows read failed: ${error.message}`)
  return data !== null
}

/** True when this fire is over the trigger's per-minute rate. */
async function overRate(triggerId: string): Promise<boolean> {
  const key = `plugin:trigger-rate:${triggerId}:${Math.floor(Date.now() / 60_000)}`
  const count = await redis.incr(key)
  if (count === 1) await redis.expire(key, 120)
  return count > TRIGGER_FIRES_PER_MINUTE
}

async function runsInFlight(workflowId: string, lane: PluginTriggerLane): Promise<number> {
  const { count, error } = await supabase
    .from("workflow_executions")
    .select("id", { count: "exact", head: true })
    .eq("workflow_id", workflowId)
    .eq("trigger_type", lane)
    .in("status", ["pending", "running"])
  if (error) throw new Error(`workflow_executions count failed: ${error.message}`)
  return count ?? 0
}

export async function firePluginTrigger(input: PluginTriggerFireInput): Promise<PluginTriggerFireResult> {
  validateFireInput(input)

  const { data: row, error: readError } = await supabase
    .from("workflow_triggers")
    .select("id, workflow_id, user_id, type, is_active, config")
    .eq("id", input.triggerId)
    .maybeSingle()
  if (readError) throw new Error(`workflow_triggers read failed: ${readError.message}`)
  if (!row || row.is_active !== true || !isPluginLane(row.type)) return { fired: false, reason: "inactive" }

  const lane: PluginTriggerLane = row.type
  const workflowId: string = row.workflow_id
  const userId: string = row.user_id
  const config = (row.config ?? {}) as Record<string, unknown>

  // The daemon's view may be stale, and the account link is the host's to hold.
  if (config.accountId !== input.accountId || !(await accountIsOwners(input.accountId, userId))) {
    return { fired: false, reason: "inactive" }
  }

  const triggerNodeId = nodeIdOf(config)
  if (!triggerNodeId || !(await triggerNodeOnGraph(workflowId, triggerNodeId, NODE_TYPE_BY_LANE[lane]))) {
    // Orphaned (a write path that does not re-project): switch it off for good.
    await supabase.from("workflow_triggers").update({ is_active: false }).eq("id", row.id)
    return { fired: false, reason: "inactive" }
  }

  if ((await overRate(row.id)) || (await runsInFlight(workflowId, lane)) >= MAX_TRIGGER_RUNS_IN_FLIGHT) {
    return { fired: false, reason: "throttled" }
  }

  if (!(await canRunWorkflow(userId, workflowId))) {
    await recordTriggerFireRefusal({ workflowId, userId, triggerType: lane, triggerId: row.id })
    return { fired: false, reason: "refused" }
  }

  const billingContext = await resolveBillingContext({ userId, workflowId })
  if (await shouldRefuseDegradedRunFor(billingContext, workflowId)) return { fired: false, reason: "degraded" }

  const { data: execution, error: insertError } = await supabase
    .from("workflow_executions")
    .insert({
      workflow_id: workflowId,
      user_id: userId,
      status: "pending",
      trigger_type: lane,
      trigger_data: input.triggerData,
      // Namespaced by lane so no other lane's key can ever collide with it.
      idempotency_key: `${lane}:${input.idempotencyKey}`,
      ...billingPairColumns(billingContext),
    })
    .select("id")
    .single()
  if (insertError) {
    if (insertError.code === UNIQUE_VIOLATION) return { fired: false, reason: "duplicate" }
    throw new Error(`workflow_executions insert failed: ${insertError.message}`)
  }
  if (!execution) throw new Error("workflow_executions insert returned no row")

  const jobData: WorkflowExecutionJob = {
    executionId: execution.id,
    workflowId,
    userId,
    triggerType: lane,
    triggerNodeId,
    triggerData: input.triggerData,
    billingContext,
  }
  await orchestrationQueue.add("workflow-execution", jobData, { jobId: execution.id })
  // Best effort, like the webhook lane: what the trigger list shows as "last fired".
  await supabase
    .from("workflow_triggers")
    .update({ last_triggered_at: new Date().toISOString() })
    .eq("id", row.id)
    .then(
      () => undefined,
      () => undefined,
    )
  return { fired: true, executionId: execution.id }
}
