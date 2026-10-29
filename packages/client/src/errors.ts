import type { StudioOpsResponse } from "./resources/studio-productions.js"

export class NodaroError extends Error {
  /**
   * Every other field of the server's error envelope (`{ error: { code,
   * message, … } }`), as it was sent: for example a trend refusal's `slot`, a
   * publish refusal's `reasons`, a validation error's `issues`. Empty when the
   * envelope had nothing else, or for an error the SDK made itself. A copy —
   * changing it changes nothing else.
   */
  public readonly details: Readonly<Record<string, unknown>> = {}

  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message)
    this.name = "NodaroError"
    if (details) this.details = { ...details }
  }
}

export class UnauthorizedError extends NodaroError {
  constructor(message = "Authentication required") {
    super(message, "unauthorized", 401)
    this.name = "UnauthorizedError"
  }
}

export class ForbiddenError extends NodaroError {
  /** `code` defaults to `"forbidden"`; {@link ModelUnavailableError} passes its own. */
  constructor(message = "Forbidden", public readonly missingScope?: string, code = "forbidden") {
    super(message, code, 403)
    this.name = "ForbiddenError"
  }
}

export type ModelUnavailableCode = "model_not_available" | "model_disabled"

/**
 * The 403 codes {@link ModelUnavailableError} carries: a model this
 * deployment does not offer (`model_not_available` — outside its edition or
 * surface, or hidden by its operator) and a model an admin switched off on
 * the models page (`model_disabled`).
 */
export const MODEL_UNAVAILABLE_CODES: ReadonlySet<ModelUnavailableCode> = new Set<ModelUnavailableCode>([
  "model_not_available",
  "model_disabled",
])

/**
 * HTTP 403 refusing the MODEL, not the caller: this deployment does not offer
 * it, or an admin switched it off. Answered by the credit guard before any
 * credits are held (the LLM and pipeline lanes still answer a switched-off
 * model with a 402 for now).
 * Choosing another model is the remedy — retrying, topping up or a wider
 * scope changes nothing. A {@link ForbiddenError}, so existing catches keep
 * working; `code` is the server's own code and says which. The envelope
 * names no model: what was refused is the request's own `provider` (or, for
 * a fan-out, one of its `models`).
 */
export class ModelUnavailableError extends ForbiddenError {
  declare readonly code: ModelUnavailableCode

  constructor(code: ModelUnavailableCode, message = "This model is not available") {
    super(message, undefined, code)
    this.name = "ModelUnavailableError"
  }
}

export class NotFoundError extends NodaroError {
  constructor(message = "Not found") {
    super(message, "not_found", 404)
    this.name = "NotFoundError"
  }
}

export class RateLimitedError extends NodaroError {
  constructor(message = "Rate limited") {
    super(message, "rate_limited", 429)
    this.name = "RateLimitedError"
  }
}

/**
 * HTTP 402: the run costs more than the caller may spend. `code` is the
 * refusal's own code — `insufficient_credits` for the caller's own balance, or
 * another 402 code such as `free_video_limit`. A spending cap someone else set
 * (a workspace budget, a member cap, a per-user allowance) is the subclass
 * {@link CreditCapExceededError}, so `instanceof InsufficientCreditsError`
 * still catches every 402.
 */
export class InsufficientCreditsError extends NodaroError {
  constructor(
    message = "Insufficient credits",
    public readonly required?: number,
    public readonly available?: number,
    code = "insufficient_credits",
  ) {
    super(message, code, 402)
    this.name = "InsufficientCreditsError"
  }
}

/** The 402 codes of a spending cap set by someone other than the caller. */
export type CreditCapCode = "budget_exceeded" | "member_cap_exceeded" | "user_allowance_exceeded"

/**
 * The 402 codes {@link CreditCapExceededError} carries: the workspace's budget
 * (`budget_exceeded`), the caller's cap in that workspace
 * (`member_cap_exceeded`), the deployment's per-user allowance
 * (`user_allowance_exceeded`).
 */
export const CREDIT_CAP_CODES: ReadonlySet<CreditCapCode> = new Set<CreditCapCode>([
  "budget_exceeded",
  "member_cap_exceeded",
  "user_allowance_exceeded",
])

/**
 * HTTP 402 from a spending cap, not from the caller's own balance: topping up
 * does not help — whoever set the cap (the workspace's owner, the deployment's
 * operator) has to raise it. An {@link InsufficientCreditsError}, so existing
 * catches keep working; `code` says which cap. `available`, when sent, is what
 * the cap has left.
 */
export class CreditCapExceededError extends InsufficientCreditsError {
  declare readonly code: CreditCapCode

  constructor(code: CreditCapCode, message = "A credit cap cannot cover this run", required?: number, available?: number) {
    super(message, required, available, code)
    this.name = "CreditCapExceededError"
  }
}

/**
 * HTTP 413: what was sent does not fit. `code` is always `storage_exceeded`;
 * `reason` is the platform's own code, when the answer carried one:
 * `storage_limit_exceeded` is a full storage, while `file_too_large` is a
 * single file over the limit, not a full storage (likewise
 * `payload_too_large`, `post_too_large`, `duration_exceeded`).
 */
export class StorageExceededError extends NodaroError {
  constructor(
    message = "Storage exceeded",
    public readonly limitBytes?: number,
    /** The platform's own code for this 413, e.g. `storage_limit_exceeded` or `file_too_large`. */
    public readonly reason?: string,
  ) {
    super(message, "storage_exceeded", 413)
    this.name = "StorageExceededError"
  }
}

/**
 * Optimistic-concurrency rejection (HTTP 409 `workflow_conflict`): the workflow
 * was written by another tab/device after the state carried in
 * `expectedUpdatedAt`/`expectedVersion` was read. `currentRecord` — when the
 * server includes it — is the full current workflow: merge your changes onto it
 * and retry with its fresh `updatedAt`, no follow-up GET needed.
 */
export class WorkflowConflictError extends NodaroError {
  constructor(
    message = "Workflow was updated by another writer",
    public readonly currentUpdatedAt?: string,
    public readonly currentVersion?: number,
    public readonly currentRecord?: Record<string, unknown>,
    /**
     * The wire code this conflict actually arrived with.
     *
     * `production_busy` is the studio production routes' own 409: the row
     * changed under a read-modify-write and the server exhausted its retries.
     * It is the same situation and the same remedy — re-read and apply again —
     * so it is the same ERROR, and a caller catching `WorkflowConflictError`
     * handles both. The code stays truthful because a caller that logs or
     * branches on it should see what the server said, not what the class is
     * usually called.
     */
    code: WorkflowConflictCode = "workflow_conflict",
  ) {
    super(message, code, 409)
    this.name = "WorkflowConflictError"
  }
}

/** The 409 codes that mean "somebody else wrote first; re-read and retry". */
export type WorkflowConflictCode = "workflow_conflict" | "production_busy"

/**
 * A studio operation batch was refused, and the error names WHICH operation
 * (`opIndex`, zero-based) was wrong. Nothing in the batch was written: a batch
 * applies atomically or not at all, so fix that one operation and send the
 * whole batch again.
 *
 * Selected by SHAPE — any 4xx carrying a numeric `opIndex` — not by a list of
 * codes, so a new refusal reason (`op_invalid`, `op_target_missing`, whatever
 * the server adds next) reaches the caller as this error without an SDK
 * release. `code` is whatever the server sent.
 */
export class StudioOpError extends NodaroError {
  constructor(
    message: string,
    code: string,
    status: number,
    /** Zero-based index into the `ops` array that was sent. */
    public readonly opIndex: number,
  ) {
    super(message, code, status)
    this.name = "StudioOpError"
  }
}

/** The 409 codes whose answer names the job to turn to instead (a top-level `jobId`). */
const CONTINUATION_REFUSAL_CODES: ReadonlySet<string> = new Set([
  "already_running",
  "continuation_superseded",
  "render_final_already_rendered",
])

/**
 * A 409 that names the job to turn to instead: continuing a use-case run
 * (`client.edit.continueUseCase`) answers `already_running` (a continuation is
 * under way, or one that already completed — follow `jobId`),
 * `continuation_superseded` (a later continuation failed too — continue
 * `jobId` instead) or `render_final_already_rendered` (a Render final with this
 * very edit already completed — `jobId` holds the result). `code` and `status`
 * are what the server sent. Selected for exactly those three codes when the
 * answer carries a top-level `jobId`; every other 409 stays a plain
 * `NodaroError`.
 */
export class ContinuationRefusedError extends NodaroError {
  constructor(
    message: string,
    code: string,
    /** The job the refusal names. */
    public readonly jobId: string,
  ) {
    super(message, code, 409)
    this.name = "ContinuationRefusedError"
  }
}

/**
 * The one run that finishes a continuation held at a Preview review (the
 * `next` of {@link ContinuationPreviewPendingError}): pass these three fields
 * to `client.workflows.run`. It continues that execution, runs each held render
 * at Final and each held Tighten Episode continuing the run that made its
 * Preview, then every node after them.
 */
export interface HeldFinalRun {
  continueFromExecutionId: string
  /** The nodes it runs, in canvas order. */
  nodeIds: string[]
  /** For this run only: each held render at Final, each held use-case node's `useCaseContinue`. */
  inputOverrides: Record<string, Record<string, unknown>>
}

/**
 * HTTP 409 `continuation_preview_pending`: a continue-from-failed
 * (`client.workflows.run` with `continueMode: "from-failed"`) whose run's
 * newest later continuation completed by stopping at a Preview review, so
 * continuing again would stop there too. `executionId` is that continuation;
 * `renderNodeIds` the Apply EDL renders and `reviewNodeIds` the Tighten Episode
 * nodes holding it; `next` the run that finishes them — send it first
 * (`client.workflows.run(workflowId, error.next)`), then continue. Absent only
 * when the server could not name it. For a single held render, `next` is that
 * render's `client.workflows.renderFinal`.
 */
export class ContinuationPreviewPendingError extends NodaroError {
  constructor(
    message: string,
    public readonly executionId: string,
    public readonly renderNodeIds: readonly string[],
    public readonly reviewNodeIds: readonly string[],
    public readonly next?: HeldFinalRun,
  ) {
    super(message, "continuation_preview_pending", 409)
    this.name = "ContinuationPreviewPendingError"
  }
}

const stringList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((id): id is string => typeof id === "string") : [])

/** A `next` as the server sends it, or undefined for anything else. */
function heldFinalRunOf(v: unknown): HeldFinalRun | undefined {
  if (!v || typeof v !== "object") return undefined
  const r = v as Record<string, unknown>
  if (typeof r.continueFromExecutionId !== "string" || !Array.isArray(r.nodeIds)) return undefined
  if (!r.inputOverrides || typeof r.inputOverrides !== "object" || Array.isArray(r.inputOverrides)) return undefined
  return {
    continueFromExecutionId: r.continueFromExecutionId,
    nodeIds: stringList(r.nodeIds),
    inputOverrides: r.inputOverrides as Record<string, Record<string, unknown>>,
  }
}

/**
 * HTTP 409 `already_running` that names the execution under way (a top-level
 * `executionId`): the run you asked to start or continue is still running —
 * follow `executionId` (`client.executions.get`) instead of starting it again.
 * Sent by the workflow run route and by an app run's Retry
 * (`client.apps.resume`). An `already_running` that names a job instead stays
 * {@link ContinuationRefusedError}; one that names nothing, a plain
 * `NodaroError`.
 */
export class AlreadyRunningError extends NodaroError {
  constructor(
    message: string,
    /** The execution under way. */
    public readonly executionId: string,
  ) {
    super(message, "already_running", 409)
    this.name = "AlreadyRunningError"
  }
}

/**
 * HTTP 409 `app_run_version_changed`: a Retry of a failed app run
 * (`client.apps.resume`) refused because the app is on another version than
 * the one the run ran — continuing would mix them. `runVersion` is the run's
 * version, `appVersion` the one you are on (the `version` you sent, else the
 * app's latest). Start the run over (`client.apps.run`) to run `appVersion`,
 * or send `{ version: runVersion }` to continue on the run's own version.
 * Nothing was written or billed. Selected by code; the two numbers are
 * `undefined` when the answer does not carry them.
 */
export class AppRunVersionChangedError extends NodaroError {
  constructor(
    message: string,
    public readonly runVersion?: number,
    public readonly appVersion?: number,
  ) {
    super(message, "app_run_version_changed", 409)
    this.name = "AppRunVersionChangedError"
  }
}

/**
 * HTTP 422 `job_blocked`. A job policy registered by this deployment refused
 * the generation **before it ran** — no job was created, nothing was reserved
 * and nothing was charged. `message` is the policy's user-safe text: show it
 * as-is. Do not retry the identical request; whether the same input would be
 * judged differently is the deployment's policy's business.
 *
 * Only occurs on deployments that register a job policy. Selected by `code`,
 * not by status, the same way `workflow_conflict` narrows a 409 above — any
 * other 422 stays a plain `NodaroError`.
 */
export class JobBlockedError extends NodaroError {
  constructor(message = "Blocked by this deployment's content policy") {
    super(message, "job_blocked", 422)
    this.name = "JobBlockedError"
  }
}

/**
 * A job reached a terminal `failed`/`cancelled` status while being awaited by
 * `nodes.runAndWait` / `nodes.runMany`. Not an HTTP-level error (the polls
 * themselves succeeded), so `status` is 0 — distinguish it by type/`code`.
 * Carries the job's own `error_message` (as the message) and `jobId`.
 */
export class JobFailedError extends NodaroError {
  constructor(
    message: string,
    public readonly jobId: string,
    /** The terminal status that triggered the failure (`failed` | `cancelled`). */
    public readonly jobStatus: "failed" | "cancelled" = "failed",
  ) {
    super(message, "job_failed", 0)
    this.name = "JobFailedError"
  }
}

/**
 * `nodes.runAndWait` polled past its `maxMs` deadline without the job reaching
 * a terminal status. Not an HTTP error — `status` is 0; catch by type/`code`.
 */
export class JobTimeoutError extends NodaroError {
  constructor(
    message: string,
    public readonly jobId: string,
    /** The wall-clock deadline (ms) that was exceeded. */
    public readonly timeoutMs: number,
  ) {
    super(message, "job_timeout", 0)
    this.name = "JobTimeoutError"
  }
}

/**
 * The caller's `AbortSignal` fired while `nodes.runAndWait` was polling (or it
 * was already aborted on entry). Polling stops and this rejects. Not an HTTP
 * error — `status` is 0; catch by type/`code`.
 */
export class JobAbortedError extends NodaroError {
  constructor(message = "Aborted", public readonly jobId?: string) {
    super(message, "job_aborted", 0)
    this.name = "JobAbortedError"
  }
}

/**
 * A batch preview was asked for and this deployment cannot give one, so
 * NOTHING was sent: the batch is still unapplied and the production untouched.
 *
 * A preview is two requests because the route's body is parsed in strip mode —
 * a deployment that predates the preview silently DROPS the flag and APPLIES
 * the batch. So the SDK asks with an EMPTY batch first and sends the real one
 * only when that answer carries the `dryRun` marker. This is what it throws
 * when the answer does not: whatever the older deployment made of an empty
 * batch, the caller's batch never left.
 *
 * The remedy is a deployment that serves the preview — there is nothing to
 * retry here. To apply the batch instead, send it without the flag.
 *
 * A deployment that REFUSES the empty batch outright throws its own error
 * instead of this one, which is the right way round: the route's message says
 * more than "unavailable" does.
 *
 * Not an HTTP error: the request itself succeeded and answered the older shape.
 * `status` is 0; catch by type/`code`.
 */
export class StudioPreviewUnavailable extends NodaroError {
  constructor(
    message = "This deployment does not preview operation batches; nothing was sent",
  ) {
    super(message, "studio_preview_unavailable", 0)
    this.name = "StudioPreviewUnavailable"
  }
}

/**
 * A batch preview was asked for and the batch was APPLIED instead. The
 * production is written; this is the opposite of {@link
 * StudioPreviewUnavailable}, where nothing was sent.
 *
 * How it happens: the preview's proving ping and the batch are two requests,
 * and a fleet mid-rollout can serve them from different deployments. The ping
 * answers the marker, the batch reaches a deployment that predates the preview,
 * parses in strip mode, drops the flag and writes. The SDK cannot recall that
 * request — by the time the answer comes back the change has landed — so it
 * refuses to call the result a preview, which is the only thing still in its
 * gift. `receipts` and `warnings` are on both shapes, so an unchecked reply
 * would have shown a person what ALREADY happened under the heading of what
 * would.
 *
 * `applied` is what the route answered: the ordinary apply reply, whose
 * `production` and `version` are now the truth. Adopt them the way a plain
 * apply's caller does — do NOT re-send the batch, and do not present it for
 * approval.
 *
 * Not an HTTP error: the request succeeded, at the wrong thing. `status` is 0.
 */
export class StudioPreviewAppliedError extends NodaroError {
  constructor(
    /**
     * The apply reply the route sent back, as it sent it. An answer this
     * package does not recognise arrives here unchanged rather than being
     * dressed up: it is what the deployment said about a batch it took.
     *
     * `undefined` when the answer carried no body at all — a 204, an empty
     * envelope. The refusal still fires, because a non-preview answer is never
     * handed back as a preview, but there is nothing to report and the SDK will
     * not invent it: whether the batch was applied is unknown from here, and
     * the caller settles it by re-reading the production.
     */
    public readonly applied: StudioOpsResponse | undefined,
    message = applied
      ? "Asked for a preview and this deployment APPLIED the batch; the change is written — see `applied`"
      : "Asked for a preview and this deployment answered with neither one nor a body to read; the batch may have been applied — re-read the production before deciding anything",
  ) {
    super(message, "studio_preview_applied", 0)
    this.name = "StudioPreviewAppliedError"
  }
}

/**
 * The awaited job entered `pending_review`: a job policy registered by this
 * deployment held its output for a human reviewer. `pending_review` is
 * IN-FLIGHT, not terminal, so `nodes.runAndWait` / `nodes.runMany` end the
 * poll on the first tick they observe it rather than burning `maxMs` on a
 * status that no longer moves on its own.
 *
 * This does NOT cancel the job — the output exists, a human is reviewing it,
 * and the credit reservation stays `reserved` for the whole hold. Do not
 * re-run the request (a duplicate would be held too): re-fetch with
 * `jobs.get(jobId)` later, or surface "awaiting review" to your user and poll
 * `jobs.getStatus()` yourself. It resolves to `completed` (approved), `failed`
 * (rejected, with `error_hint.kind === "policy-block"`) or `cancelled`.
 *
 * Not an HTTP error — `status` is 0; catch by type/`code`.
 */
export class JobHeldError extends NodaroError {
  constructor(
    message: string,
    public readonly jobId: string,
  ) {
    super(message, "job_held", 0)
    this.name = "JobHeldError"
  }
}

/** The `{ error: { code, message, … } }` envelope every current route sends. */
interface ApiErrorEnvelope {
  code?: string
  message?: string
  missingScope?: string
  required?: number
  available?: number
  limitBytes?: number
  opIndex?: number
  [key: string]: unknown
}

interface ApiErrorBody {
  /** The envelope — or, on an older route, a bare string (see {@link readErrorBody}). */
  error?: ApiErrorEnvelope | string
  /** A top-level message: an older route's, a bare validation answer's, or the server framework's own. */
  message?: unknown
  /** OAuth's human text (RFC 6749 §5.2), beside a bare-string `error`. */
  error_description?: unknown
  /** A bare validation answer's per-field issues (`{ message, issues }`). */
  issues?: unknown
  /** A refusal that names another job (see {@link ContinuationRefusedError}). */
  jobId?: unknown
  /** `continuation_preview_pending`: the held continuation, what holds it, and the run that finishes it. */
  executionId?: unknown
  renderNodeIds?: unknown
  reviewNodeIds?: unknown
  next?: unknown
  /** The credit guard's 402 sends its figures beside the envelope: what the run needs… */
  required?: unknown
  /** …and what the caller has (withheld on a deployment-paid instance). */
  balance?: unknown
  /** A per-user allowance's 402: what the allowance has left. */
  remaining?: unknown
  /** `app_run_version_changed`: the version the run ran, and the one the caller is on. */
  runVersion?: unknown
  appVersion?: unknown
}

const finite = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined)

/** A machine code as an older route writes it: lower snake_case, never a sentence or a reason phrase. */
const BARE_CODE = /^[a-z][a-z0-9_]*$/

const nonEmpty = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined)

/**
 * Where a body keeps its code and its human message. Most routes send the
 * envelope `{ error: { code, message } }`; three other shapes reach the SDK
 * too, and each is read for what it says rather than collapsed into
 * `internal_error` / "Request failed":
 *
 * - an older route's bare string, `{ error: "<code>", message?, … }` (character
 *   training, a few profile and billing routes), and OAuth's
 *   `{ error: "<code>", error_description }`. A snake_case string is the code;
 *   a sentence (`"Profile not found"`) is the message.
 * - a bare validation answer, `{ message, issues: [...] }`: `validation_error`.
 * - the server framework's own answer, `{ statusCode, error: "<reason phrase>",
 *   message }` (a route it does not have): the reason phrase is neither, the
 *   message is kept — so "no such route" stays distinguishable from "no such
 *   resource".
 *
 * At HTTP 500 and above only the CODE is read from outside the envelope. Text
 * there can be whatever the server failed with: the framework's own answer to
 * an uncaught throw is `{ statusCode: 500, error: "Internal Server Error",
 * message: <the raw error> }`, and the server's sanitizer rewrites only the
 * `internal_error` envelope. The envelope's own message is a route's chosen
 * sentence and is read at every status, as before.
 *
 * `message` is undefined when the body carries no human text it may show, so a
 * typed class keeps its own default ("Not found").
 */
function readErrorBody(status: number, body: ApiErrorBody): { code: string | undefined; message: string | undefined; envelope: ApiErrorEnvelope } {
  const raw = body.error
  const envelope: ApiErrorEnvelope = raw && typeof raw === "object" ? raw : {}
  const bare = typeof raw === "string" ? raw : undefined
  const bareCode = bare !== undefined && BARE_CODE.test(bare) ? bare : undefined
  // Words with a space between them are human text: an older route's sentence,
  // or the framework's reason phrase — which always arrives with a real
  // `message`, read first. A single capitalised word ("Unauthorized") is a
  // reason phrase alone and says nothing the status does not.
  const bareSentence = bare !== undefined && bareCode === undefined && /\s/.test(bare.trim()) ? bare : undefined
  const code =
    nonEmpty(envelope.code) ??
    bareCode ??
    (status === 400 && raw === undefined && Array.isArray(body.issues) ? "validation_error" : undefined)
  const outside = status >= 500 ? undefined : (nonEmpty(body.message) ?? nonEmpty(body.error_description) ?? bareSentence)
  const message = nonEmpty(envelope.message) ?? outside
  return { code, message, envelope }
}

/** The envelope's fields other than `code` and `message` (see {@link NodaroError.details}). */
function envelopeDetails(envelope: ApiErrorEnvelope): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(envelope)) {
    if (key !== "code" && key !== "message") out[key] = value
  }
  return out
}

export function throwFromResponse(status: number, body: ApiErrorBody): never {
  try {
    selectError(status, body)
  } catch (err) {
    // Every class carries the envelope's other fields, whichever was chosen.
    if (err instanceof NodaroError) {
      const raw = body && typeof body === "object" ? body.error : undefined
      if (raw && typeof raw === "object") Object.defineProperty(err, "details", { value: envelopeDetails(raw), enumerable: true })
    }
    throw err
  }
}

function selectError(status: number, body: ApiErrorBody): never {
  // A body that is not an object (an empty answer, `null`, a bare string) still
  // throws by its status.
  const parsed: ApiErrorBody = body && typeof body === "object" ? body : {}
  const read = readErrorBody(status, parsed)
  const envelope = read.envelope
  const code = read.code ?? "internal_error"
  // A typed class falls back to its own default; a generic error to the code
  // it carries, which says more than "Request failed" does.
  const message = read.message ?? (read.code ? read.code : "Request failed")
  if (status === 401) throw new UnauthorizedError(read.message)
  if (status === 409 && (code === "workflow_conflict" || code === "production_busy")) {
    throw new WorkflowConflictError(
      read.message,
      envelope.currentUpdatedAt as string | undefined,
      envelope.currentVersion as number | undefined,
      envelope.currentRecord as Record<string, unknown> | undefined,
      code,
    )
  }
  // By shape, not by code — see StudioOpError. Only the studio operations route
  // sends an op index, so this cannot capture anyone else's 400.
  if (status >= 400 && status < 500 && typeof envelope.opIndex === "number") {
    throw new StudioOpError(message, code, status, envelope.opIndex)
  }
  if (status === 409 && CONTINUATION_REFUSAL_CODES.has(code) && typeof parsed.jobId === "string") {
    throw new ContinuationRefusedError(message, code, parsed.jobId)
  }
  if (status === 409 && code === "continuation_preview_pending" && typeof parsed.executionId === "string") {
    throw new ContinuationPreviewPendingError(
      message,
      parsed.executionId,
      stringList(parsed.renderNodeIds),
      stringList(parsed.reviewNodeIds),
      heldFinalRunOf(parsed.next),
    )
  }
  if (status === 409 && code === "already_running" && typeof parsed.executionId === "string") {
    throw new AlreadyRunningError(message, parsed.executionId)
  }
  if (status === 409 && code === "app_run_version_changed") {
    throw new AppRunVersionChangedError(message, finite(parsed.runVersion), finite(parsed.appVersion))
  }
  if (status === 422 && code === "job_blocked") throw new JobBlockedError(read.message)
  // The model, not the caller — before the scope line, so its own code is
  // kept (a plain ForbiddenError says "forbidden" whatever the server sent).
  const modelCode = read.code as ModelUnavailableCode | undefined
  if (status === 403 && modelCode !== undefined && MODEL_UNAVAILABLE_CODES.has(modelCode)) {
    throw new ModelUnavailableError(modelCode, read.message)
  }
  if (status === 403 && code === "insufficient_scope") {
    throw new ForbiddenError(read.message, envelope.missingScope)
  }
  if (status === 403) throw new ForbiddenError(read.message)
  // A 404 the framework answered itself (no route at that path) carries its
  // message at the top level, not under `error`; `readErrorBody` keeps it so
  // callers can tell "no such route" from "no such resource".
  if (status === 404) throw new NotFoundError(read.message)
  if (status === 429) throw new RateLimitedError(read.message)
  if (status === 402) {
    // The credit guard puts `required` / `balance` (an allowance: `remaining`)
    // beside the envelope; an envelope that carries them (`required` /
    // `available`) is read first.
    const required = finite(envelope.required) ?? finite(parsed.required)
    const available = finite(envelope.available) ?? finite(parsed.balance) ?? finite(parsed.remaining)
    const capCode = read.code as CreditCapCode | undefined
    if (capCode !== undefined && CREDIT_CAP_CODES.has(capCode)) {
      throw new CreditCapExceededError(capCode, read.message, required, available)
    }
    throw new InsufficientCreditsError(read.message, required, available, read.code ?? "insufficient_credits")
  }
  if (status === 413) throw new StorageExceededError(read.message, envelope.limitBytes, read.code)
  throw new NodaroError(message, code, status)
}
