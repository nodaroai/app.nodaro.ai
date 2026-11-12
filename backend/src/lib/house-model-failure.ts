/**
 * The ONE mapper from a house model's upstream failure to the error the job
 * fails with (docs/design/house-models.md).
 *
 * The plugin hands core the upstream's own words and the failure flags a
 * `PluginHandlerFn` error already carries (`PluginHouseModelFailure`). Core
 * builds a FRESH error from them: a fixed sentence the person reads (the
 * lane's own for the failure's class, `failureSentences` in
 * house-model-lanes.ts, else the seam's), a neutral operator detail (`internalDetails`, what `providerDetailOf` writes to
 * `jobs.error_detail`, which a deployment may show the job's owner), and the
 * flags as own properties — so the worker's catch and the reconcile cron map
 * it to `error_hint` exactly as they map a plugin handler's error
 * (`refusalHintFor` and friends in lib/safety-block.ts), while both keep the
 * sentence as `error_message` (`isHouseModelRunError`). The plugin's error is
 * never rethrown or chained as `cause`: its message is the upstream's words,
 * and every user-facing reader walks the cause chain.
 *
 * The upstream's words go to ONE server log line with the job id, and nowhere
 * else.
 */
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import type { PluginHouseModelFailure } from "./private-plugins/types.js"
import { redactProviderDetail } from "./provider-error-detail.js"
import { isDeterministicJobError } from "./deterministic-job-error.js"
import { houseModelLane, type HouseModelLane } from "./house-model-lanes.js"

/** A house-model run that failed upstream, as the job fails with it. */
export class HouseModelRunError extends Error {
  /** The neutral operator detail (`jobs.error_detail`): which flags the run failed with, never the upstream's words. */
  readonly internalDetails: string
  readonly houseModelId: string
  deterministic?: true
  requestRefused?: true
  requestRefusedSubject?: "input_video"
  inputImageRefused?: true
  inputVideoRefused?: true
  promptRefused?: true
  contentPolicyClass?: "safety"

  constructor(message: string, houseModelId: string, internalDetails: string) {
    super(message)
    this.name = "HouseModelRunError"
    this.houseModelId = houseModelId
    this.internalDetails = internalDetails
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

const FLAG_NAMES = [
  "deterministic",
  "requestRefused",
  "inputImageRefused",
  "inputVideoRefused",
  "promptRefused",
  "contentPolicy",
] as const satisfies ReadonlyArray<keyof PluginHouseModelFailure>

/**
 * The failure a plugin value describes — a rejected `start`'s Error (flags as
 * own properties) or `poll`'s failed state (flags as fields). Only `true`
 * counts as a flag; anything else is absent.
 */
export function houseModelFailureOf(value: unknown): PluginHouseModelFailure {
  const rec = value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {}
  const message = typeof rec.message === "string" ? rec.message : typeof value === "string" ? value : ""
  const failure: PluginHouseModelFailure = { message }
  for (const name of FLAG_NAMES) if (rec[name] === true) failure[name] = true
  if (rec.requestRefusedSubject === "input_video") failure.requestRefusedSubject = "input_video"
  return failure
}

/** The name the person reads for `id`: its catalog label. */
export function houseModelLabel(id: string): string {
  return Object.hasOwn(MODEL_CATALOG, id) ? MODEL_CATALOG[id]!.label : "This model"
}

/**
 * The sentence the person reads for this failure: the lane's own sentence for
 * its class (`failureSentences`, house-model-lanes.ts) when the lane gives
 * one, else the seam's fixed sentence. A content-policy block is the
 * `contentPolicy` class even when the input was refused too; a refused input
 * file (an image or a video, or a request refused for its input video) is
 * `inputRefused`.
 */
function houseModelFailureSentence(
  failure: PluginHouseModelFailure,
  label: string,
  sentences: HouseModelLane["failureSentences"],
): string {
  const inputRefused =
    failure.inputImageRefused === true ||
    failure.inputVideoRefused === true ||
    failure.requestRefusedSubject === "input_video"
  const own = failure.contentPolicy === true
    ? sentences?.contentPolicy
    : inputRefused
      ? sentences?.inputRefused
      : undefined
  if (typeof own === "string" && own.trim().length > 0) return own
  return failure.requestRefused
    ? `${label} refused this request as it was sent.`
    : `${label} could not complete this run.`
}

/**
 * The error a job fails with for this upstream failure. Logs the upstream's
 * words (redacted of URLs and secrets) once, with the job id. Its message is
 * the lane's sentence for the failure's class, or the seam's fixed sentence;
 * every failure writer keeps it as the job's `error_message`
 * (`isHouseModelRunError`), a content-policy block included.
 */
export function houseModelFailureError(
  failure: PluginHouseModelFailure,
  ctx: { readonly id: string; readonly jobId: string },
  lane: Pick<HouseModelLane, "failureSentences"> | undefined = houseModelLane(ctx.id),
): HouseModelRunError {
  const flags: string[] = FLAG_NAMES.filter((name) => failure[name] === true)
  if (failure.requestRefusedSubject) flags.push(`requestRefusedSubject=${failure.requestRefusedSubject}`)
  console.warn(
    `[house-models] job ${ctx.jobId} (${ctx.id}) failed upstream` +
      `${flags.length ? ` [${flags.join(", ")}]` : ""}: ${redactProviderDetail(failure.message) ?? "(no words)"}`,
  )
  const sentence = houseModelFailureSentence(failure, houseModelLabel(ctx.id), lane?.failureSentences)
  const err = new HouseModelRunError(
    sentence,
    ctx.id,
    `House model run failed${flags.length ? ` (${flags.join(", ")})` : ""}.`,
  )
  if (failure.deterministic) err.deterministic = true
  if (failure.requestRefused) err.requestRefused = true
  if (failure.requestRefusedSubject) err.requestRefusedSubject = failure.requestRefusedSubject
  if (failure.inputImageRefused) err.inputImageRefused = true
  if (failure.inputVideoRefused) err.inputVideoRefused = true
  if (failure.promptRefused) err.promptRefused = true
  if (failure.contentPolicy) err.contentPolicyClass = "safety"
  return err
}

/**
 * True when `err` is a house-model run's failure (`houseModelFailureError`):
 * its message is the lane's or the seam's fixed sentence, which the video
 * worker's final catch and the reconcile keep as `error_message` — never the
 * generic safety sentence, whose "adjust the prompt" advice is wrong for a run
 * with no prompt. Read on the TOP-LEVEL error only: a wrapper's text is not
 * the seam's. The `error_hint` is still the shared mapping's.
 */
export function isHouseModelRunError(err: unknown): err is HouseModelRunError {
  return err instanceof HouseModelRunError
}

/**
 * A run given up for now — past its poll budget, or after its status reads
 * kept failing — with its reference saved: NOT final. Nothing ends it here:
 * on a non-final queue attempt the retry re-picks the job and the recovery
 * reads the same run (the worker routes a row with a saved task id there); on
 * the final attempt the worker leaves the row for the reconcile cron instead
 * of failing it (workers/video-worker.ts). Either way the run is checked
 * again, and never started a second time. When the reference could not be
 * saved the same error is marked final (`deterministic`).
 */
export class HouseModelRunPendingError extends Error {
  readonly houseModelId: string
  deterministic?: true

  constructor(message: string, houseModelId: string) {
    super(message)
    this.name = "HouseModelRunPendingError"
    this.houseModelId = houseModelId
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/**
 * True when a rejection of `runHouseModelTask` is FINAL: the job fails and is
 * refunded now, and nothing runs the lane again — a refusal before `start`
 * (not served, no valid lane row, an input file not on our storage or outside
 * the input rule, a URL under an undeclared arg, no valid run, a job already
 * claimed for a run), a rejected `start`, a returned failure, a done with no
 * file, or any failure after `start` whose reference was not saved. Every one
 * is a `DeterministicJobError` or carries `deterministic: true`, which the
 * video worker already treats as final. A lane rethrows the error unchanged.
 */
export function isHouseModelRunFinal(err: unknown): boolean {
  return isDeterministicJobError(err)
}

/**
 * True when a rejection of `runHouseModelTask` leaves the run to be read
 * again: a timeout or failed status reads with the reference saved
 * (`HouseModelRunPendingError`, not marked final). A cancel and a drain
 * (`DrainAbortError`) are neither: the cancel path ends the job, and a drain
 * hands it back to the queue. A lane rethrows the error unchanged.
 */
export function isHouseModelRunPending(err: unknown): boolean {
  return err instanceof HouseModelRunPendingError && !isDeterministicJobError(err)
}
