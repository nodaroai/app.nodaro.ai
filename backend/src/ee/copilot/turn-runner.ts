/**
 * One turn, end to end: reserve → run the loop → stream → settle.
 *
 * The route owns HTTP (auth, caps, SSE); this owns the turn's lifecycle so
 * the credit rules live in one place:
 *   - reserve a CEILING before the first token (the ceiling is a hard cap —
 *     `commit_credits` refunds a surplus but never charges above it);
 *   - persist cost after every iteration, so a crashed turn can still be
 *     settled by `reconcile.ts`;
 *   - commit the metered actual on any outcome that produced work, refund
 *     only when nothing was spent and nothing changed.
 */
import type Anthropic from "@anthropic-ai/sdk"
import type { WiredAsset } from "./tools/edit-workflow.js"
import type { FastifyInstance, FastifyRequest } from "fastify"
import { insertAppReport } from "../../lib/app-reports.js"
import { supabase } from "../../lib/supabase.js"
import { refundReservedCreditsForJob } from "../../lib/credits-job-lifecycle.js"
import { commitJobCredits } from "../../workers/shared.js"
import { buildMcpServer } from "../../lib/mcp/server.js"
import { createMcpInvoker } from "../../lib/mcp/invoke.js"
import { COPILOT_SCOPES, COPILOT_TIERS, DEFAULT_COPILOT_TIER, HEARTBEAT_INTERVAL_MS, TURN_CAPS, type CopilotModelTier } from "./constants.js"
import { resolveTurnBudget } from "./budget.js"
import { buildSystemPrompt } from "./system-prompt.js"
import { buildContextPreamble } from "./context-snapshot.js"
import { buildHistory, buildUserContent, extractImageRefIds } from "./history.js"
import { runAgentLoop, type LoopResult } from "./agent-loop.js"
import { buildToolDefinitions } from "./tools/registry.js"
import { registerTurnAbort, unregisterTurnAbort } from "./cancel-registry.js"
import {
  appendMessage,
  bumpThreadActivity,
  finishTurn,
  isCancelRequested,
  listRecentMessages,
  nextSeq,
  touchTurnHeartbeat,
  updateTurnProgress,
  threadAllowsPublishing,
  type CopilotThread,
  type CopilotTurn,
} from "./store.js"
import { resolveCopilotAssetRefs } from "./tools/asset-refs.js"
import type { CopilotToolContext } from "./tools/types.js"

export interface TurnEmit {
  (event: { type: string; data: Record<string, unknown> }): void
}

export interface RunTurnInput {
  req: FastifyRequest
  fastify: FastifyInstance
  thread: CopilotThread
  turn: CopilotTurn
  userId: string
  workflowId: string
  projectId: string
  workflowName: string
  version: number | null
  nodes: unknown
  edges: unknown
  message: string
  /** The thread's model ladder rung — resolved by the route from the thread row. */
  tier: CopilotModelTier
  usageLogId: string | null
  reservedCredits: number
  emit: TurnEmit
  signal: AbortSignal
}

export interface TurnOutcome {
  status: "completed" | "capped" | "cancelled" | "failed"
  assistantMessageId: string | null
  finalVersion: number | null
  creditsCharged: number | null
  usage: LoopResult["usage"]
  error?: { code: string; message: string }
}

/** Error codes the client may see. SSE bypasses the 500 sanitizer, so the wire text comes from here — never from a thrown error. */
export const TURN_ERROR_TEXT: Readonly<Record<string, string>> = {
  llm_error: "The assistant could not complete this turn. Try again.",
  model_refused: "The assistant declined to answer that.",
  turn_timeout: "This turn took too long and was stopped.",
  internal_error: "Something went wrong on our side. Try again.",
}

export async function runCopilotTurn(input: RunTurnInput): Promise<TurnOutcome> {
  const controller = new AbortController()
  const forward = (): void => controller.abort()
  input.signal.addEventListener("abort", forward, { once: true })
  registerTurnAbort(input.turn.id, controller)

  const server = await buildMcpServer({
    userId: input.userId,
    scopes: [...COPILOT_SCOPES],
    clientName: "copilot",
    fastify: input.fastify,
    projectScope: { projectId: input.projectId },
  })
  const invoker = createMcpInvoker(server)

  const addedNodeTypes = new Set<string>()
  const wiredAssets: WiredAsset[] = []
  const ctx: CopilotToolContext = {
    userId: input.userId,
    // The user’s own per-thread choice. Absent means the column has not been
    // promoted yet (migrations run on push to main, staging shares the
    // production database) — and absent must read as OFF.
    allowPublishing: threadAllowsPublishing(input.thread),
    workflowId: input.workflowId,
    projectId: input.projectId,
    threadId: input.thread.id,
    turnId: input.turn.id,
    fastify: input.fastify,
    emit: input.emit,
  }

  let finalVersion: number | null = null
  const emitWithVersion: TurnEmit = (event) => {
    if (event.type === "workflow_updated" && typeof event.data.version === "number") {
      finalVersion = event.data.version
    }
    input.emit(event)
  }

  let result: LoopResult | null = null
  let failure: { code: string; message: string } | undefined
  // The last usage the loop reported. If the loop THROWS mid-turn, `result`
  // is null but the earlier iterations really were billed by the vendor —
  // settling from zero would refund spend that happened.
  let lastUsage: LoopResult["usage"] = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 }

  // The heartbeat proves the turn's PROCESS is alive, so it must tick on its
  // own clock — not once per model call. A single call with adaptive thinking
  // routinely runs longer than the stale window, and a "stale" turn is
  // refunded and cancelled out from under itself.
  const heartbeat = setInterval(() => {
    void touchTurnHeartbeat(input.turn.id)
  }, HEARTBEAT_INTERVAL_MS)

  try {
    const [budget, preamble, priorRows, tools] = await Promise.all([
      resolveTurnBudget(input.reservedCredits),
      buildContextPreamble({
        userId: input.userId,
        workflowId: input.workflowId,
        workflowName: input.workflowName,
        version: input.version,
        nodes: input.nodes,
        edges: input.edges,
      }),
      listRecentMessages(input.thread.id, TURN_CAPS.historyMessageLimit),
      buildToolDefinitions(invoker),
    ])

    // Vision: the message's own [references] glossary names the attached
    // files; image ids that resolve as the CALLER'S OWN become image blocks,
    // so the model sees what the user attached. A foreign or non-image id
    // simply does not resolve — the text mention still stands, and the
    // assetId write path stays the only way media reaches a node.
    let imageUrls: string[] = []
    const imageRefIds = extractImageRefIds(input.message)
    if (imageRefIds.length > 0) {
      try {
        const resolvedRefs = await resolveCopilotAssetRefs(imageRefIds, input.userId)
        imageUrls = imageRefIds
          .map((id) => resolvedRefs.get(id))
          .filter((ref): ref is NonNullable<typeof ref> => Boolean(ref && ref.kind === "image" && ref.url))
          .map((ref) => ref.url)
      } catch (err) {
        // Vision is an enhancement, never a turn-blocker: a resolver hiccup
        // downgrades to the text-only turn the copilot always supported.
        input.req.log.warn({ err, turnId: input.turn.id }, "[copilot] vision resolve failed; text-only turn")
      }
    }

    const userContent = buildUserContent(preamble, input.message, imageUrls)
    const seq = await nextSeq(input.thread.id)
    await appendMessage({
      threadId: input.thread.id,
      turnId: input.turn.id,
      userId: input.userId,
      seq,
      role: "user",
      content: userContent as unknown[],
      contextPreamble: preamble,
      textPreview: input.message,
    })

    result = await runAgentLoop({
      tier: COPILOT_TIERS[input.tier ?? DEFAULT_COPILOT_TIER],
      system: buildSystemPrompt(),
      tools,
      history: buildHistory(priorRows),
      userContent: userContent as Anthropic.Messages.ContentBlockParam[],
      budget,
      signal: controller.signal,
      deps: { ctx: { ...ctx, emit: emitWithVersion }, invoker, addedNodeTypes, wiredAssets },
      events: {
        onToken: (delta) => input.emit({ type: "token", data: { text: delta } }),
        onToolCall: (event) => input.emit({ type: "tool_call", data: { ...event } }),
        onIteration: async (state) => {
          lastUsage = state.usage
          await updateTurnProgress(input.turn.id, {
            iterations: state.iterations,
            tool_calls: state.toolCalls,
            input_tokens: state.usage.inputTokens,
            output_tokens: state.usage.outputTokens,
            cache_read_tokens: state.usage.cacheReadTokens,
            cache_write_tokens: state.usage.cacheWriteTokens,
            cost_usd: state.usage.costUsd,
          })
        },
      },
      isCancelRequested: () => isCancelRequested(input.turn.id),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    failure = { code: "llm_error", message: TURN_ERROR_TEXT.llm_error! }
    input.req.log.error({ err, turnId: input.turn.id }, "[copilot] turn failed")
    void insertAppReport({
      node: "workflow-copilot",
      kind: "copilot-turn-failure",
      severity: "error",
      title: "Copilot turn failed",
      payload: { turnId: input.turn.id, threadId: input.thread.id, error: message.slice(0, 500) },
      userId: input.userId,
    })
  } finally {
    clearInterval(heartbeat)
    input.signal.removeEventListener("abort", forward)
    unregisterTurnAbort(input.turn.id)
    await invoker.close().catch(() => undefined)
  }

  const usage = result?.usage ?? lastUsage
  const status = resolveStatus(result, failure)

  // Persist whatever the model produced, even on a cancel — the user keeps
  // the partial answer, and the stored blocks stay replayable. A persistence
  // failure (e.g. the 256 KB content CHECK) must NOT skip settlement below,
  // or the reservation dangles until the reconcile sweep and the thread stays
  // 409 in the meantime.
  let assistantMessageId: string | null = null
  try {
    if (result && result.messages.length > 1) {
      let seq = await nextSeq(input.thread.id)
      for (const message of result.messages.slice(1)) {
        const row = await appendMessage({
          threadId: input.thread.id,
          turnId: input.turn.id,
          userId: input.userId,
          seq: seq++,
          role: message.role,
          content: (Array.isArray(message.content) ? message.content : [{ type: "text", text: message.content }]) as unknown[],
          textPreview: message.role === "assistant" ? result.assistantText : null,
        })
        if (message.role === "assistant") assistantMessageId = row.id
      }
    }
  } catch (err) {
    input.req.log.error({ err, turnId: input.turn.id }, "[copilot] failed to persist turn messages")
  }

  const creditsCharged = await settleCredits({
    jobId: input.turn.job_id,
    usageLogId: input.usageLogId,
    costUsd: usage.costUsd,
  })

  await updateTurnProgress(input.turn.id, { final_version: finalVersion })
  await finishTurn(input.turn.id, status === "failed" ? "failed" : status, {
    error: failure ? failure.code : null,
    credits_charged: creditsCharged,
  })
  await bumpThreadActivity(input.thread.id, 1)

  return {
    status,
    assistantMessageId,
    finalVersion,
    creditsCharged,
    usage,
    ...(failure ? { error: failure } : {}),
  }
}

function resolveStatus(result: LoopResult | null, failure: { code: string } | undefined): TurnOutcome["status"] {
  if (failure) return "failed"
  if (!result) return "failed"
  switch (result.stopReason) {
    case "cancelled":
      return "cancelled"
    case "capped":
    case "budget":
    // The model hit `max_tokens` mid-answer. Reporting that as "completed"
    // hands the user a sentence that stops mid-word and calls it done.
    case "truncated":
      return "capped"
    case "refused":
      return "failed"
    default:
      return "completed"
  }
}

/**
 * Commit the metered actual, or refund when the turn produced nothing. The
 * commit is `ceilingReservation`, so a normal turn (actual well under the
 * reservation) does not log an anomaly.
 */
async function settleCredits(input: {
  jobId: string | null
  usageLogId: string | null
  costUsd: number
}): Promise<number | null> {
  if (!input.jobId) return null
  // costUsd > 0 is the ONLY commit condition. A metered commit with a
  // zero cost falls through `commitJobCredits`'s branches to a bare
  // `commitCredits(usageLogId)`, which charges the FULL reservation — so a
  // turn cancelled two seconds in (no iteration finished, no usage yet) would
  // bill the user's whole balance. Nothing spent, nothing charged.
  if (input.costUsd > 0) {
    await commitJobCredits(input.usageLogId, input.jobId, input.costUsd, 0, true, true)
    const { data } = await supabase.from("jobs").select("credits_actual").eq("id", input.jobId).maybeSingle()
    await markJobSettled(input.jobId, "completed")
    return (data as { credits_actual: number | null } | null)?.credits_actual ?? null
  }
  await refundReservedCreditsForJob(input.jobId)
  await markJobSettled(input.jobId, "completed")
  return 0
}

/**
 * A copilot turn's job row must reach a terminal state here. Left at
 * `processing` with `provider_kind = "copilot-turn"`, every finished turn
 * would be re-scanned by the reconcile cron 15 minutes later, crowding
 * genuinely stuck provider jobs out of its batch.
 */
async function markJobSettled(jobId: string, status: "completed" | "failed"): Promise<void> {
  await supabase
    .from("jobs")
    .update({ status, completed_at: new Date().toISOString() })
    .eq("id", jobId)
    .in("status", ["pending", "processing"])
}
