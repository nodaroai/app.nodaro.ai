/**
 * The fire lanes' half of "a metered LLM model with no price" (R51).
 *
 * A schedule, a webhook, a Telegram message or a plugin event fires a run no
 * one answers. If the branch it runs meets a metered LLM call on a model with
 * no price, that call refuses at its own reservation — after every fixed node
 * upstream of it has run and charged. The lane refuses BEFORE it creates an
 * execution or enqueues, with ONE visible failed row carrying the stable code
 * (`llm_model_unpriced`), deduped like every other fire refusal
 * (`recordTriggerFireRefusal`): a schedule ticks forever and a webhook can be
 * hammered at its rate limit.
 *
 * The orchestrator asks the same question of every run it picks up
 * (`unpricedLlmRunPreflight`, the wall every lane passes); this check is what
 * answers a webhook caller `400` and keeps a refused trigger from writing one
 * failed row per tick. A graph it cannot read is left to that wall.
 *
 * Without credits, or under the tier-pricing rollback, every model is priced:
 * it answers "not refused" before reading anything.
 */
import { hasCredits, llmMeteredPricing } from "./config.js"
import { supabase } from "./supabase.js"
import { recordTriggerFireRefusal } from "./trigger-fire-refusal.js"
import { llmUnpricedMessage, unpricedLlmOfRun } from "./llm-unpriced-refusal.js"
import { triggerRunScope } from "../services/workflow-engine/execution-graph.js"

/** The stable code a refused fire's row carries (and dedupes on). */
export const LLM_MODEL_UNPRICED = "llm_model_unpriced"

/** The body a lane that answers sends: the same refusal every route gives. */
export interface UnpricedFireRefusal {
  readonly code: "validation_error"
  readonly reason: typeof LLM_MODEL_UNPRICED
  readonly modelId: string
  readonly message: string
}

type GraphNode = { id: string; type: string; data?: Record<string, unknown>; parentId?: string | null }
type GraphEdge = { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }

export async function refuseUnpricedFire(args: {
  workflowId: string
  userId: string
  triggerType: "webhook" | "schedule" | "telegram" | "telegram_account"
  triggerId?: string
  /** The trigger node this fire starts from — the branch it runs. */
  triggerNodeId?: string | null
}): Promise<UnpricedFireRefusal | null> {
  let refusal: UnpricedFireRefusal | null = null
  try {
    if (!hasCredits() || !llmMeteredPricing()) return null
    const { data, error } = await supabase.from("workflows").select("nodes, edges").eq("id", args.workflowId).single()
    if (error || !data) return null
    const row = data as { nodes?: unknown; edges?: unknown }
    const nodes = (Array.isArray(row.nodes) ? row.nodes : []).filter(
      (n): n is GraphNode => !!n && typeof (n as GraphNode).id === "string" && typeof (n as GraphNode).type === "string",
    )
    const edges = (Array.isArray(row.edges) ? row.edges : []).filter(
      (e): e is GraphEdge => !!e && typeof (e as GraphEdge).source === "string" && typeof (e as GraphEdge).target === "string",
    )
    // The branch the fire runs, as the orchestrator scopes it.
    const scope = triggerRunScope(nodes, edges, { triggerType: args.triggerType, triggerNodeId: args.triggerNodeId })
    const err = await unpricedLlmOfRun(nodes, edges, scope ? { runNodeIds: scope } : {})
    if (err) refusal = { code: "validation_error", reason: LLM_MODEL_UNPRICED, modelId: err.modelId, message: await llmUnpricedMessage(err) }
  } catch (err) {
    console.warn(
      `[trigger-fire] unpriced-model check skipped for workflow ${args.workflowId}:`,
      err instanceof Error ? err.message : String(err),
    )
    return null
  }
  if (!refusal) return null
  await recordTriggerFireRefusal({
    workflowId: args.workflowId,
    userId: args.userId,
    triggerType: args.triggerType,
    triggerId: args.triggerId,
    code: LLM_MODEL_UNPRICED,
  })
  return refusal
}
