/**
 * What a use-case node (Tighten Episode, decided 2026-10-13) asks its route
 * for, and the one call that asks it — the request half of use-case-node.ts:
 *  - a run of the node with its wired recording and its settings;
 *  - a continuation its override names (an app's Render final), or — in an
 *    outer run continued from one where this node failed — a continue of that
 *    failed inner run, with the fresh run as its fallback when there is
 *    nothing to continue.
 * Every call carries the parent run's lane (depth, reviewer, payer) and the
 * node's Idempotency-Key.
 */
import { CONTINUATION_SETTLING, CONTINUATION_SUPERSEDED, RENDER_FINAL_ALREADY_RENDERED } from "@nodaro/shared/nodes"
import { USE_CASE_REVIEW_LIST_DRIVEN, USE_CASE_REVIEW_LIST_DRIVEN_MESSAGE, usecaseFanOutRefused } from "@nodaro/render-rules"
import { RENDER_FINAL_ALREADY_RUNNING } from "../../lib/render-final-run.js"
import { loopbackFetch } from "./loopback-fetch.js"
import { syncLaneHeaders } from "./sync-lane-headers.js"
import { NODE_TIMEOUT_MS, type NodeOutput, type OrchestratorContext, type ResolvedInputs, type SimpleNode } from "./types.js"

/** The node's settings the run route reads (its request schema, lib/use-case/request.ts). */
const SETTING_KEYS = [
  "output", "framing", "captions", "captionStyle", "reviewBeforeRender", "planTier", "instructions", "styleGuide", "musicDuckAmount",
] as const

export const CONTINUE_PATH = "/v1/tighten-episode/continue"

export interface UseCaseRequest {
  readonly path: string
  readonly body: Record<string, unknown>
  /** A continue of the outer run's failed attempt: the fresh run, when there is nothing to continue. */
  readonly fallback?: () => UseCaseRequest
}

/** The route's answer to one call. */
export type UseCaseAnswer =
  | { readonly kind: "started"; readonly jobId: string }
  /** A continuation of the same run already under way or done (`already_running`). */
  | { readonly kind: "running"; readonly jobId: string }
  /** A newer generation of the run that failed too (`continuation_superseded`): continue that one. */
  | { readonly kind: "superseded"; readonly jobId: string; readonly message: string }
  | { readonly kind: "settling" }

export type CodedError = Error & { errorCode?: string; output?: NodeOutput }

export function coded(message: string, code?: string, output?: NodeOutput): CodedError {
  const err = new Error(message) as CodedError
  if (code) err.errorCode = code
  if (output) err.output = output
  return err
}

/**
 * The refusal for fanning a review-on use-case node out over a list, or null.
 * Asked where the engine fans a node out, before any item runs: nothing is
 * called, charged or started.
 */
export function usecaseFanOutRefusal(node: SimpleNode): CodedError | null {
  return usecaseFanOutRefused(node) ? coded(USE_CASE_REVIEW_LIST_DRIVEN_MESSAGE, USE_CASE_REVIEW_LIST_DRIVEN) : null
}

/** The override an app's Render final (or a continue-from-failed) sets on the node: its own earlier wrapper. */
function continuationOf(data: Record<string, unknown>): { mode: "render-final" | "from-failed"; jobId: string } | null {
  const cont = data.useCaseContinue as { mode?: unknown; jobId?: unknown } | null | undefined
  if (!cont || typeof cont.jobId !== "string") return null
  return cont.mode === "render-final" || cont.mode === "from-failed" ? { mode: cont.mode, jobId: cont.jobId } : null
}

/**
 * The wrapper this node's attempt in the run being continued failed with, when
 * this is a top-level, single run of the node (a fan-out's per-item wrappers
 * are not told apart in the node state; a sub-workflow's nodes are not the
 * continued run's).
 */
export function failedAttemptOf(
  node: SimpleNode,
  ctx: OrchestratorContext,
  iterationIndex: number | undefined,
  scope: readonly string[],
): string | null {
  if (iterationIndex !== undefined || scope.length > 0) return null
  const state = ctx.continuedFromStates?.[node.id]
  return state?.status === "failed" && typeof state.jobId === "string" && state.jobId ? state.jobId : null
}

/** The call this node makes: a run, or the continuation its override (or the run being continued) names. */
export function requestOf(
  node: SimpleNode,
  resolvedInputs: ResolvedInputs,
  ctx: OrchestratorContext,
  failedAttempt: string | null,
): UseCaseRequest {
  const data = (node.data ?? {}) as Record<string, unknown>
  const lane = {
    componentDepth: (ctx.componentDepth ?? 0) + 1,
    executingComponentIds: ctx.executingComponentIds ?? [],
    previewStopRule: ctx.previewStopRule === true,
    reviewerPresent: ctx.reviewerPresent === true,
    billingContext: ctx.billingContext,
    userId: ctx.userId,
    ...(ctx.workflowId ? { workflowId: ctx.workflowId } : {}),
    nodeId: node.id,
  }
  const cont = continuationOf(data)
  if (cont) {
    // The reviewer's edit of the plan: what the person authored, sent with a Render final only.
    const edited = data.editedEdl
    const edit = cont.mode === "render-final" && edited !== undefined && edited !== null ? { editedEdl: edited } : {}
    return { path: CONTINUE_PATH, body: { jobId: cont.jobId, mode: cont.mode, ...edit, ...lane } }
  }
  const fresh = (): UseCaseRequest => {
    const media = resolvedInputs.useCaseMedia?.[0]
    if (!media) throw new Error("Tighten Episode needs a recording wired into Media")
    const settings = Object.fromEntries(SETTING_KEYS.filter((k) => data[k] !== undefined && data[k] !== null).map((k) => [k, data[k]]))
    return {
      path: "/v1/tighten-episode",
      body: {
        mediaUrls: [media.url],
        ...(resolvedInputs.useCaseMusic ? { musicUrl: resolvedInputs.useCaseMusic } : {}),
        ...settings,
        ...lane,
      },
    }
  }
  if (failedAttempt) return { path: CONTINUE_PATH, body: { jobId: failedAttempt, mode: "from-failed", ...lane }, fallback: fresh }
  return fresh()
}

/** A continue-from-failed of a newer generation of the same run (no edit: that applies to a Render final only). */
export function continuingGeneration(request: UseCaseRequest, jobId: string): UseCaseRequest {
  const { editedEdl: _edit, ...body } = request.body
  return { ...request, path: CONTINUE_PATH, body: { ...body, jobId, mode: "from-failed" } }
}

/**
 * One call to the route. Any refusal it does not answer with (not found,
 * continuation_not_failed, render_final_not_preview, the preview stop rule,
 * the connection, the recording…) is thrown with its code.
 */
export async function askRoute(request: UseCaseRequest, key: string, ctx: OrchestratorContext): Promise<UseCaseAnswer> {
  const port = process.env.BACKEND_PORT || process.env.PORT || "8000"
  const res = await loopbackFetch(
    `http://localhost:${port}${request.path}`,
    {
      method: "POST",
      headers: { ...syncLaneHeaders(ctx), "Idempotency-Key": key },
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(NODE_TIMEOUT_MS),
    },
    { label: `Use-case call to ${request.path}` },
  )
  const answer = (await res.json().catch(() => ({}))) as { jobId?: unknown; error?: { code?: string; message?: string } }
  // 202 (a run started, or a keyed retry's earlier run) and 200 (the credit
  // guard's dedup of the same request) both name the wrapper to wait on.
  if (res.ok && typeof answer.jobId === "string") return { kind: "started", jobId: answer.jobId }
  const code = answer.error?.code
  const message = answer.error?.message ?? `Tighten Episode failed to start (${res.status})`
  // Inside a Render final, a final already under way or already made with
  // this very edit FAILS the node with that refusal (decided 2026-10-13):
  // followed, the earlier final would hand on as this run's result and every
  // node after it would run — and charge — again. The final it names rides on
  // the failure (`useCaseFinalJobId`), so the editor can show it.
  if (request.body.mode === "render-final" && (code === RENDER_FINAL_ALREADY_RUNNING || code === RENDER_FINAL_ALREADY_RENDERED)) {
    throw coded(message, code, typeof answer.jobId === "string" ? { useCaseFinalJobId: answer.jobId } : undefined)
  }
  // A continue-from-failed that another request already continues: wait on that one.
  if (code === RENDER_FINAL_ALREADY_RUNNING && typeof answer.jobId === "string") return { kind: "running", jobId: answer.jobId }
  if (code === CONTINUATION_SUPERSEDED && typeof answer.jobId === "string") return { kind: "superseded", jobId: answer.jobId, message }
  if (code === CONTINUATION_SETTLING) return { kind: "settling" }
  throw coded(message, code)
}
