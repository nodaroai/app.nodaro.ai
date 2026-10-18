/**
 * The refusals of `POST /v1/workflows/:id/run` that a run continuing an earlier
 * one (`continueFromExecutionId`) can answer, as typed errors (`runWorkflow`
 * in `api.ts` throws them). A client branches on the stable code, never on the
 * text, and never on the mere presence of an `executionId`: a superseded
 * continuation names an execution too, and is not "already running".
 *
 * Kept out of `api.ts` on purpose: the editor's run tests mock `@/lib/api`
 * with a hand-listed factory, and a class missing from such a factory reads
 * as `undefined`, which makes every `instanceof` against it throw.
 */
import {
  CONTINUATION_PREVIEW_PENDING,
  CONTINUATION_SUPERSEDED,
  RUN_CONTINUATION_CODES,
  type RunContinuationCode,
} from "@nodaro/shared/nodes"

/** The run that finishes what holds a Preview review (`next` on `continuation_preview_pending`). */
export interface HeldFinalRun {
  readonly continueFromExecutionId: string
  readonly nodeIds: readonly string[]
  readonly inputOverrides: Readonly<Record<string, Readonly<Record<string, unknown>>>>
}

/**
 * `409 continuation_superseded`: a later continuation of the run decides.
 * `status: "failed"`: continue that one instead. `status: "completed"`: it ran
 * all that was left, so the work is done and its results are on that run.
 */
export class ContinuationSupersededError extends Error {
  readonly code = CONTINUATION_SUPERSEDED
  constructor(
    message: string,
    readonly supersededBy: { readonly executionId: string; readonly status: string },
  ) {
    super(message)
    this.name = "ContinuationSupersededError"
  }
}

/**
 * `409 continuation_preview_pending`: the newest continuation stopped at a
 * Preview review. `executionId` is that run; its Apply EDL renders and its
 * review-on use-case nodes are named, with the run that finishes them (`next`)
 * when the server could work it out.
 */
export class ContinuationPreviewPendingError extends Error {
  readonly code = CONTINUATION_PREVIEW_PENDING
  constructor(
    message: string,
    readonly executionId: string,
    readonly renderNodeIds: readonly string[],
    readonly reviewNodeIds: readonly string[],
    readonly next: HeldFinalRun | null,
  ) {
    super(message)
    this.name = "ContinuationPreviewPendingError"
  }
}

/** Any other continuation refusal (the execution is not found, not yours, of another version, not completed, …). */
export class ContinuationRefusedError extends Error {
  constructor(
    message: string,
    readonly code: RunContinuationCode,
  ) {
    super(message)
    this.name = "ContinuationRefusedError"
  }
}

const CODES: ReadonlySet<string> = new Set(RUN_CONTINUATION_CODES)

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((id): id is string => typeof id === "string" && id.length > 0) : [])

function heldFinalRunOf(v: unknown): HeldFinalRun | null {
  if (!isRecord(v) || typeof v.continueFromExecutionId !== "string" || v.continueFromExecutionId.length === 0) return null
  const nodeIds = ids(v.nodeIds)
  if (nodeIds.length === 0) return null
  const overrides = isRecord(v.inputOverrides) ? (v.inputOverrides as HeldFinalRun["inputOverrides"]) : {}
  return { continueFromExecutionId: v.continueFromExecutionId, nodeIds, inputOverrides: overrides }
}

/**
 * The typed error for a `/run` answer that is a continuation refusal, or
 * `null` when it is not one. `message` is the person-facing text the caller
 * builds for the code (the api client's own copy rule).
 */
export function continuationRefusalOf(body: unknown, message: (code: string, serverMessage: string | undefined) => string): Error | null {
  if (!isRecord(body) || !isRecord(body.error)) return null
  const code = body.error.code
  if (typeof code !== "string" || !CODES.has(code)) return null
  const text = message(code, typeof body.error.message === "string" ? body.error.message : undefined)
  if (code === CONTINUATION_SUPERSEDED) {
    const by = isRecord(body.supersededBy) ? body.supersededBy : {}
    const executionId = typeof by.executionId === "string" ? by.executionId : typeof body.executionId === "string" ? body.executionId : ""
    if (executionId) return new ContinuationSupersededError(text, { executionId, status: typeof by.status === "string" ? by.status : "failed" })
  }
  if (code === CONTINUATION_PREVIEW_PENDING && typeof body.executionId === "string" && body.executionId.length > 0) {
    return new ContinuationPreviewPendingError(text, body.executionId, ids(body.renderNodeIds), ids(body.reviewNodeIds), heldFinalRunOf(body.next))
  }
  return new ContinuationRefusedError(text, code as RunContinuationCode)
}
