// @registry-lookup asks the body of the one use-case type it is given (usecaseBodyTakesNull, usecaseBodyTakesEmpty)
/**
 * What a use-case node (decided 2026-10-13) asks its type's route for, and
 * the one call that asks it — the request half of use-case-node.ts. The
 * route, the setting keys and the inputs it sends come from the type's
 * descriptor (`@nodaro/render-rules`); nothing here names a type:
 *  - a run of the node with its wired recording and its settings;
 *  - a continuation its override names (an app's Render final), or — in an
 *    outer run continued from one where this node failed — a continue of that
 *    failed inner run, with the fresh run as its fallback when there is
 *    nothing to continue.
 * Every call carries the parent run's lane (depth, reviewer, payer) and the
 * node's Idempotency-Key.
 */
import { CONTINUATION_SETTLING, CONTINUATION_SUPERSEDED, RENDER_FINAL_ALREADY_RENDERED } from "@nodaro/shared/nodes"
import {
  usecaseContinuePath,
  usecaseDescriptor,
  usecaseFanOutRefusalOf,
  usecaseKindHasPlan,
  usecaseRunRecordings,
  usecaseSentSettings,
  type UseCaseNodeType,
  type UseCaseRunViewer,
} from "@nodaro/render-rules"
import { RENDER_FINAL_ALREADY_RUNNING } from "../../lib/render-final-codes.js"
import { usecaseBodyTakesEmpty, usecaseBodyTakesNull } from "../../lib/use-case/bodies.js"
import { loopbackFetch } from "./loopback-fetch.js"
import { failedAttemptJobIdOf } from "./failed-attempt.js"
import { syncLaneHeaders } from "./sync-lane-headers.js"
import { NODE_TIMEOUT_MS, type NodeOutput, type OrchestratorContext, type ResolvedInputs, type SimpleNode } from "./types.js"

export interface UseCaseRequest {
  readonly path: string
  /** The node's English label, for an answer the route sent no message with. */
  readonly label: string
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
 * The refusal for fanning a use-case node out over a list (one whose own
 * result is a list, or one with review on), or null. Asked where the engine
 * fans a node out, before any item runs: nothing is called, charged or started.
 */
export function usecaseFanOutRefusal(node: SimpleNode): CodedError | null {
  const refusal = usecaseFanOutRefusalOf(node)
  return refusal ? coded(refusal.message, refusal.code) : null
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
  // Its own failed state, or — the run was seeded from a later generation
  // that left the node out — the failed attempt that generation's seed carries.
  return failedAttemptJobIdOf(ctx.continuedFromStates?.[node.id])
}

/**
 * What a fresh run of the node sends its type's route, without the lane: its
 * wired recordings in the node's order, the music, intro card and Master
 * audio where the type takes them, and its settings — the node's data as this
 * run holds it, its input overrides merged. How many recordings, whether the
 * master and the Cameras settings ride, is both engines' one rule
 * (`usecaseRunRecordings`): several recordings and a master only when
 * `viewer.multicam` (the run's viewer may use Speaker Map, `usecaseMulticamAvailable`),
 * else the first recording alone, exactly as before multicam; an `auto`
 * framing source (written, or absent on a type whose absent default is
 * `auto`) is sent as the even split unless `viewer.framesAvailable`
 * (`usecaseFramingForViewer`). Key order: the
 * recordings, music, intro card, master, then the settings. Throws when no
 * recording is wired. Also what a failed attempt's inputs are held to before
 * it is resumed (failed-attempt.ts `attemptRanWithInputs`).
 */
export function freshRunInputs(node: SimpleNode, resolvedInputs: ResolvedInputs, viewer: UseCaseRunViewer): Record<string, unknown> {
  const type = node.type as UseCaseNodeType
  const d = usecaseDescriptor(type)
  const data = (node.data ?? {}) as Record<string, unknown>
  // The type's own settings (its request body, lib/use-case/bodies.ts), by
  // both engines' rule (usecaseSentSettings), its nulls and empty strings
  // asked of the body itself.
  const sent = usecaseSentSettings(type, d.settingKeys, data, {
    null: (k) => usecaseBodyTakesNull(type, k),
    empty: (k) => usecaseBodyTakesEmpty(type, k),
  })
  // The recordings, the master and the Cameras settings: both engines' one rule.
  const run = usecaseRunRecordings({
    wired: resolvedInputs.useCaseMedia,
    data,
    maxRecordings: d.maxRecordings,
    takesMaster: d.inputs.includes("masterAudio"),
    master: resolvedInputs.useCaseMasterAudio ? { nodeId: resolvedInputs.useCaseMasterAudioNodeId ?? "", url: resolvedInputs.useCaseMasterAudio } : undefined,
    multicam: viewer.multicam,
    framesAvailable: viewer.framesAvailable,
    absentFramingSource: d.absentFramingSource,
    settings: sent,
  })
  if (run.recordings.length === 0) throw new Error(`${d.label} needs a recording wired into Media`)
  const settings = run.settings
  return {
    mediaUrls: run.recordings.map((m) => m.url),
    ...(resolvedInputs.useCaseMusic && d.inputs.includes("music") ? { musicUrl: resolvedInputs.useCaseMusic } : {}),
    ...(resolvedInputs.useCaseIntroCard && d.inputs.includes("introCard") ? { introCardUrl: resolvedInputs.useCaseIntroCard } : {}),
    ...(run.masterAudioUrl ? { masterAudioUrl: run.masterAudioUrl } : {}),
    ...settings,
  }
}

/** The call this node makes: a run, or the continuation its override (or the run being continued) names. */
export function requestOf(
  node: SimpleNode,
  resolvedInputs: ResolvedInputs,
  ctx: OrchestratorContext,
  failedAttempt: string | null,
  /** What the run's viewer may use: Speaker Map (every recording and the master) and Speaker Frames (`auto` follows faces) — `freshRunInputs`. */
  viewer: UseCaseRunViewer,
): UseCaseRequest {
  const type = node.type as UseCaseNodeType
  const d = usecaseDescriptor(type)
  const continuePath = usecaseContinuePath(type)
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
    // The reviewer's edit of the plan: what the person authored, sent with a Render final only — and
    // only by a type that has a plan to edit (a layout has none: a stray saved edit is never sent).
    const edited = data.editedEdl
    const edit = cont.mode === "render-final" && usecaseKindHasPlan(d.resultKind) && edited !== undefined && edited !== null ? { editedEdl: edited } : {}
    return { path: continuePath, label: d.label, body: { jobId: cont.jobId, mode: cont.mode, ...edit, ...lane } }
  }
  const fresh = (): UseCaseRequest => ({ path: d.route, label: d.label, body: { ...freshRunInputs(node, resolvedInputs, viewer), ...lane } })
  if (failedAttempt) return { path: continuePath, label: d.label, body: { jobId: failedAttempt, mode: "from-failed", ...lane }, fallback: fresh }
  return fresh()
}

/**
 * A continue-from-failed of a newer generation of the same run (no edit: that
 * applies to a Render final only). Only a continuation is answered with a
 * newer generation, so `request.path` is already the type's continue route.
 */
export function continuingGeneration(request: UseCaseRequest, jobId: string): UseCaseRequest {
  const { editedEdl: _edit, ...body } = request.body
  return { ...request, body: { ...body, jobId, mode: "from-failed" } }
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
  const message = answer.error?.message ?? `${request.label} failed to start (${res.status})`
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
