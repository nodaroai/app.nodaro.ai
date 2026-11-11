/**
 * House models in core (docs/design/house-models.md): models a deployment
 * offers under its own label, whose upstream a private plugin supplies through
 * `PluginServices.houseModels`. The plugin owns the upstream — its client, its
 * key, the request, the result parsing and the rates. Core owns the job — the
 * hold, the queue, the checkpoint, the poll loop, the reconcile, the finalize,
 * the commit and the refund — and treats the upstream as an opaque task.
 *
 * Three entry points, the seam's contract, and the processes each is valid in:
 *   - `houseModelServed(id)` — the catalog marks `id` own-label AND this
 *     deployment serves it (house-models-served.ts, the leaf `isModelDenied`
 *     asks). Valid in EVERY process: where the plugins are loaded it reads them;
 *     the standalone orchestrator asks its API, failing closed.
 *   - `planHouseModelRun(id, args)` — `plan` through the seam: null when not
 *     served or the args describe no valid run. Valid ONLY in a process that
 *     loaded the plugins: the API (a route's guard, before the hold), the video
 *     worker (before `start`). Anywhere else it THROWS `HouseModelsNotLoadedError`
 *     — a programming error, never mistaken for "invalid run". The workflow
 *     engine (the standalone orchestrator) therefore never calls it: a lane
 *     validates its own args with its own core rules before the hold, and the
 *     worker plans before it starts.
 *   - `runHouseModelTask(id, args, opts)` — start, save the reference on the job
 *     at once, poll until done or `timeoutMs`. Valid ONLY where the plugins are
 *     loaded (the video worker); anywhere else it throws the same error.
 *
 * The reconcile kind (lib/reconcile/house-model.ts) runs in the API process
 * (the reconcile cron, `server.ts`) and the video worker (the inline re-pick),
 * both of which load the plugins; it throws the same error anywhere else.
 *
 * Nothing here names an upstream, and nothing here imports a provider client.
 */
import { getPluginServices, pluginServicesLoaded } from "./private-plugins/services-registry.js"
import type { PluginHouseModelPoll, PluginHouseModelsService } from "./private-plugins/types.js"
import { throwIfJobCancelled } from "./job-cancellation.js"
import { DeterministicJobError } from "./deterministic-job-error.js"
import { DrainAbortError, isWorkerDraining } from "./worker-drain.js"
import {
  HouseModelRunPendingError,
  houseModelFailureError,
  houseModelFailureOf,
  houseModelLabel,
} from "./house-model-failure.js"
import { HOUSE_MODEL_CLAIM_REF, claimHouseModelStart, saveHouseModelReference } from "./house-model-claim.js"
import { redactProviderDetail } from "./provider-error-detail.js"
import { houseModelLane, houseModelLaneProblems, type HouseModelInputFacts, type HouseModelLane } from "./house-model-lanes.js"
import { isOwnStoredFileUrl } from "./own-storage-url.js"
import { houseModelServed } from "./house-models-served.js"

export { HouseModelRunPendingError, isHouseModelRunFinal, isHouseModelRunPending } from "./house-model-failure.js"

export {
  houseModelServed,
  isOwnLabelModel,
  ownLabelModelIds,
  servedHouseModelIds,
  refreshHouseModelsServed,
  setHouseModelsServedSource,
  HOUSE_MODELS_PROVIDER,
  HOUSE_MODEL_PROVIDER_KIND,
  HOUSE_MODELS_SERVED_TTL_MS,
  HOUSE_MODELS_SERVED_FAILURE_TTL_MS,
  HouseModelsServedUnknownError,
  HouseModelsTemporarilyUnavailableError,
  HOUSE_MODELS_SERVED_STALE_LIMIT_MS,
  HOUSE_MODELS_UNKNOWN_HAND_BACK_MS,
  houseModelServedState,
  houseRuleWithholdsAModel,
} from "./house-models-served.js"

/**
 * A house model's `plan` or run asked in a process that never loaded the
 * plugins (the standalone orchestrator): a programming error, not an answer —
 * the plugin that would answer is not in this process. Never caught as
 * "invalid run" or "not served".
 */
export class HouseModelsNotLoadedError extends Error {
  constructor(what: string) {
    super(`${what} runs only in a process that loaded the private plugins (the API server, the video worker); this process loaded none`)
    this.name = "HouseModelsNotLoadedError"
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** Throws `HouseModelsNotLoadedError` unless this process loaded the plugins. */
export function assertHouseModelPluginsLoaded(what: string): void {
  if (!pluginServicesLoaded()) throw new HouseModelsNotLoadedError(what)
}

/** Consecutive status reads that may fail (the read itself, not the run) before the worker gives the run up for now. */
export const HOUSE_MODEL_MAX_POLL_READ_FAILURES = 5

/** The served service, or undefined when `id` is not served here. */
function servingService(id: string): PluginHouseModelsService | undefined {
  return houseModelServed(id) ? getPluginServices().houseModels : undefined
}

/** A non-negative finite USD figure, or undefined. */
function usd(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined
}

/**
 * `plan` through the seam; null when not served or the args are invalid.
 * Valid only in a process that loaded the plugins (the API, the video worker);
 * throws `HouseModelsNotLoadedError` anywhere else (the standalone orchestrator).
 */
export function planHouseModelRun(id: string, args: Readonly<Record<string, unknown>>): { providerCostUsd: number } | null {
  assertHouseModelPluginsLoaded("planHouseModelRun")
  const service = servingService(id)
  if (!service) return null
  try {
    const planned = service.plan(id, args)
    const providerCostUsd = usd(planned?.providerCostUsd)
    return providerCostUsd === undefined ? null : { providerCostUsd }
  } catch (err) {
    console.warn(`[house-models] plan(${id}) threw; the run is refused: ${redactProviderDetail(err instanceof Error ? err.message : String(err)) ?? "(no words)"}`)
    return null
  }
}

/** The refusal of a run whose model is not served here — final, nothing was started. */
export function houseModelNotServedError(id: string): DeterministicJobError {
  return new DeterministicJobError(`${houseModelLabel(id)} is not available on this deployment.`)
}

/** The refusal of a run whose settings describe no valid run — final, nothing was started. */
export function houseModelInvalidRunError(id: string): DeterministicJobError {
  return new DeterministicJobError(`${houseModelLabel(id)} cannot make this run with these settings.`)
}

/**
 * The refusal of a run on a job already claimed for one (house-model-claim.ts)
 * that holds no reference to read — final, nothing was started. Reached when a
 * worker died between `start` and saving the reference, or the save failed,
 * and the lane runs again for the same job: a second `start` could be a
 * second paid run.
 */
export class HouseModelStartRefusedError extends DeterministicJobError {
  readonly houseModelRefusal = "already-claimed" as const

  constructor(id: string) {
    super(`${houseModelLabel(id)} could not complete this run.`)
    this.name = "HouseModelStartRefusedError"
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/**
 * The refusal of a run with an input file that is not a file of this
 * install's own storage — final, nothing was started. A lane copies an
 * outside file to our storage before it measures, bills or sends it; this is
 * the runner's backstop for a lane that did not.
 */
/**
 * Why a run's input was refused before `start`: a declared input file not on
 * our storage; a URL under an arg the lane did not declare; a declared input
 * file the lane passed no measurement for (`inputFacts`); or a measured file
 * the lane row's input rule does not take (too large, or a format it does not
 * accept).
 */
export type HouseModelInputRefusal = "input-not-stored" | "undeclared-url" | "input-unmeasured" | "input-rule"

export class HouseModelInputNotStoredError extends DeterministicJobError {
  /**
   * Which refusal this is, for a reader that has only the error: a declared
   * input file not on our storage, or a URL under an arg the lane did not
   * declare as an input file (`houseModelUndeclaredUrlArgs`).
   */
  readonly houseModelRefusal: HouseModelInputRefusal

  constructor(id: string, refusal: HouseModelInputRefusal = "input-not-stored") {
    super(`${houseModelLabel(id)} could not use this input file, so the run was not started.`)
    this.houseModelRefusal = refusal
    this.name = "HouseModelInputNotStoredError"
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/**
 * The lane's declared input-URL args (`inputUrlArgs`) whose value in `args`
 * is not a file of this install's own storage (`isOwnStoredFileUrl`, the
 * strict test the platform uses for a link an outside service fetches). A
 * value is a URL or an array of URLs; an absent arg (undefined or null) is
 * skipped; anything else counts as not stored.
 */
export function houseModelInputsNotStored(
  lane: Pick<HouseModelLane, "inputUrlArgs">,
  args: Readonly<Record<string, unknown>>,
): string[] {
  return lane.inputUrlArgs.filter((name) => {
    const value = Object.hasOwn(args, name) ? args[name] : undefined
    if (value === undefined || value === null) return false
    const urls: readonly unknown[] = Array.isArray(value) ? value : [value]
    return urls.some((url) => typeof url !== "string" || !isOwnStoredFileUrl(url))
  })
}

/** The declared input files of `args`: every URL under the lane's `inputUrlArgs`. */
function declaredInputUrls(lane: Pick<HouseModelLane, "inputUrlArgs">, args: Readonly<Record<string, unknown>>): string[] {
  const urls: string[] = []
  for (const name of lane.inputUrlArgs) {
    const value = Object.hasOwn(args, name) ? args[name] : undefined
    for (const url of Array.isArray(value) ? value : [value]) if (typeof url === "string") urls.push(url)
  }
  return urls
}

/**
 * The lane row's input rule held against the ONE measurement the lane passed
 * in (`facts`, keyed by stored URL) — never a second measurement. `unmeasured`:
 * declared input files with no usable facts (a lane programming error);
 * `refused`: files whose facts the rule does not take. Both empty when the
 * row has no input rule.
 */
export function houseModelInputRuleProblems(
  lane: Pick<HouseModelLane, "inputUrlArgs" | "input">,
  args: Readonly<Record<string, unknown>>,
  facts: Readonly<Record<string, HouseModelInputFacts>> | undefined,
): { unmeasured: string[]; refused: string[] } {
  const rule = lane.input
  const unmeasured: string[] = []
  const refused: string[] = []
  if (!rule) return { unmeasured, refused }
  const accepted = rule.acceptedFormats ? new Set(rule.acceptedFormats.map((f) => f.toLowerCase())) : undefined
  for (const url of declaredInputUrls(lane, args)) {
    const fact = facts && Object.hasOwn(facts, url) ? facts[url] : undefined
    const bytes = fact?.bytes
    const format = typeof fact?.format === "string" ? fact.format.trim().toLowerCase() : ""
    // The size always (the one measurement); the format only where the rule names formats.
    if (typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes < 0 || (accepted !== undefined && format.length === 0)) {
      unmeasured.push(url)
      continue
    }
    if ((rule.maxBytes !== undefined && bytes > rule.maxBytes) || (accepted && !accepted.has(format))) refused.push(url)
  }
  return { unmeasured, refused }
}

/** True when `text` holds an http(s) URL anywhere (a scheme, `://`, then something). */
function holdsUrl(text: string): boolean {
  return /https?:\/\/\S/i.test(text)
}

/**
 * Every place in `args` OUTSIDE the lane's declared input-URL args that holds
 * an http(s) URL — in a string at any depth of nested objects and arrays —
 * as a path (`options.refs[1]`). An upstream may fetch any URL it is handed,
 * so a URL the lane did not declare is one the storage rule never checked: a
 * lane programming error, refused before `start`. A string that only contains
 * the letters "http" is not a URL.
 */
export function houseModelUndeclaredUrlArgs(
  lane: Pick<HouseModelLane, "inputUrlArgs">,
  args: Readonly<Record<string, unknown>>,
): string[] {
  const declared = new Set(lane.inputUrlArgs)
  const found: string[] = []
  const seen = new Set<object>()
  const walk = (value: unknown, path: string, depth: number): void => {
    if (typeof value === "string") {
      if (holdsUrl(value)) found.push(path)
      return
    }
    if (value === null || typeof value !== "object" || depth > 32 || seen.has(value)) return
    seen.add(value)
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, `${path}[${i}]`, depth + 1))
      return
    }
    for (const [key, item] of Object.entries(value)) walk(item, path ? `${path}.${key}` : key, depth + 1)
  }
  for (const [key, value] of Object.entries(args)) {
    if (!declared.has(key)) walk(value, key, 0)
  }
  return found
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))
}

/** A `done` poll's result files, or undefined when it carries none. */
function resultUrlsOf(done: Extract<PluginHouseModelPoll, { state: "done" }>): readonly string[] | undefined {
  const urls = Array.isArray(done.resultUrls) ? done.resultUrls.filter((u): u is string => typeof u === "string" && u.length > 0) : []
  return urls.length > 0 ? urls : undefined
}

/** A positive whole pixel count, or undefined. */
function side(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : undefined
}

/** What a finished run hands its lane's delivery. */
export interface HouseModelRunResult {
  /** The result files, in order; the first is the job's result. */
  readonly resultUrls: readonly string[]
  /** The delivered size, as a pair or not at all. */
  readonly width?: number
  readonly height?: number
  /** What the upstream reported the run cost, in USD; null when it reported none. */
  readonly reportedCostUsd: number | null
  /** The start's planned cost, in USD (also saved on the row with the reference). */
  readonly plannedCostUsd: number
}

/**
 * Runs one house-model task to its end: start, store the reference on the job
 * at once, poll until done or `timeoutMs`. Resolves with the result; rejects
 * with an Error carrying the failure flags (one mapper turns them into the
 * job's `error_hint`, as for a plugin handler's error).
 *
 * Valid only where the plugins are loaded (the video worker); throws
 * `HouseModelsNotLoadedError` anywhere else.
 *
 * - Refused before `start` (a `DeterministicJobError`): the model is not served
 *   here or has no valid lane row (`houseModelLaneProblems`); an input file
 *   the lane declares (`inputUrlArgs`) is not a file of this install's own
 *   storage, a URL sits under an arg the lane did not declare, or a declared
 *   input file has no measurement in `opts.inputFacts` or one the row's input
 *   rule does not take (`HouseModelInputNotStoredError`, its
 *   `houseModelRefusal` says which); or `plan` finds no valid run in `args`.
 *   Nothing is submitted upstream; the job fails and is refunded.
 * - `start` is called ONCE per job, ever, held by the job row: right before
 *   it the runner claims the job (`claimHouseModelStart`, a compare-and-set
 *   that lands only on a live row with no saved task id). A job that already
 *   holds this run's reference is READ, never started again (the worker's
 *   inline safety retry runs the lane twice in one process); a job claimed
 *   with no reference is refused, final (`HouseModelStartRefusedError`: the
 *   worker died, or the save failed, after `start`). The upstream has no
 *   idempotency key and a submit that timed out may still have created a
 *   task, so a rejected `start` (or one that resolves without a reference) is
 *   FINAL: the job fails and is refunded, and nothing runs the lane again.
 * - The reference replaces the claim at once (`saveHouseModelReference`, with
 *   the planned cost): a worker that dies after it is never re-submitted — a
 *   queue re-pick finds the task id and the reconcile reads its status.
 * - A drain (`isWorkerDraining`) hands the job back (`DrainAbortError`) once
 *   the reference is saved; the re-pick reads the run. A run whose reference
 *   could not be saved keeps polling: handing it back could not resume it.
 * - A `failed` status, or a `done` with no result file, is the run's end: final.
 * - Every tick honours a cancel (`throwIfJobCancelled`). A status read that
 *   throws is retried, at most {@link HOUSE_MODEL_MAX_POLL_READ_FAILURES} times
 *   in a row; past that, or past `timeoutMs`, the run is given up for now
 *   (`HouseModelRunPendingError`), so a retry re-picks the saved reference —
 *   unless the reference could not be saved, which makes every failure after
 *   `start` final (a retry would otherwise start a second run).
 *   `isHouseModelRunFinal` / `isHouseModelRunPending` tell the two apart.
 * - The start's planned cost is saved with the reference. The result carries
 *   what the upstream reported (`reportedCostUsd`) and the planned figure
 *   (`plannedCostUsd`); the one delivery resolves the cost the job records
 *   (house-model-delivery.ts).
 * - `width` / `height` are reported as a pair or not at all.
 */
export async function runHouseModelTask(
  id: string,
  args: Readonly<Record<string, unknown>>,
  opts: {
    jobId: string
    pollIntervalMs: number
    timeoutMs: number
    onProgress?: () => void
    /** The one measurement of each declared input file, keyed by its stored URL; required when the lane row has an input rule. */
    inputFacts?: Readonly<Record<string, HouseModelInputFacts>>
  },
): Promise<HouseModelRunResult> {
  assertHouseModelPluginsLoaded("runHouseModelTask")
  const service = servingService(id)
  if (!service) throw houseModelNotServedError(id)
  const lane = houseModelLane(id)
  const laneProblems = houseModelLaneProblems(lane)
  if (!lane || laneProblems.length > 0) {
    console.error(`[house-models] job ${opts.jobId} (${id}): its lane row ${laneProblems.join("; ")}; the run is refused`)
    throw houseModelNotServedError(id)
  }
  const notStored = houseModelInputsNotStored(lane, args)
  if (notStored.length > 0) {
    console.warn(`[house-models] job ${opts.jobId} (${id}): ${notStored.join(", ")} is not a file of this install's storage; refused before start`)
    throw new HouseModelInputNotStoredError(id)
  }
  const undeclared = houseModelUndeclaredUrlArgs(lane, args)
  if (undeclared.length > 0) {
    console.error(`[house-models] job ${opts.jobId} (${id}): a URL under ${undeclared.join(", ")}, which the lane row does not declare as an input file; refused before start`)
    throw new HouseModelInputNotStoredError(id, "undeclared-url")
  }
  const ruled = houseModelInputRuleProblems(lane, args, opts.inputFacts)
  if (ruled.unmeasured.length > 0) {
    console.error(`[house-models] job ${opts.jobId} (${id}): ${ruled.unmeasured.length} input file(s) passed with no measurement (inputFacts); refused before start`)
    throw new HouseModelInputNotStoredError(id, "input-unmeasured")
  }
  if (ruled.refused.length > 0) {
    console.warn(`[house-models] job ${opts.jobId} (${id}): ${ruled.refused.length} input file(s) outside the lane's input rule; refused before start`)
    throw new HouseModelInputNotStoredError(id, "input-rule")
  }
  const planned = planHouseModelRun(id, args)
  if (!planned) throw houseModelInvalidRunError(id)
  const label = houseModelLabel(id)

  // A job cancelled while it was checked is never started.
  await throwIfJobCancelled()
  const claim = await claimHouseModelStart(opts.jobId)
  let taskRef: string
  let saved: boolean
  if (claim.state === "started") {
    // This job's run was started already (the worker's inline safety retry, a
    // second run of the lane in this process): read it, never start again.
    console.warn(`[house-models] job ${opts.jobId} (${id}): already started; reading that run instead of starting another`)
    taskRef = claim.taskRef
    saved = true
  } else if (claim.state === "taken") {
    console.error(`[house-models] job ${opts.jobId} (${id}): claimed for a run whose reference was never saved (or no longer live); refused, nothing started`)
    throw new HouseModelStartRefusedError(id)
  } else if (claim.state === "error") {
    // Nothing was started; whether the claim landed is unknown, and a retry finds out.
    console.warn(`[house-models] job ${opts.jobId} (${id}): the job could not be claimed for a run: ${claim.message}`)
    throw new Error(`${label} could not be started just now.`)
  } else {
    let started: unknown
    try {
      started = (await service.start(id, args, { jobId: opts.jobId }))?.taskRef
    } catch (err) {
      throw final(houseModelFailureError(houseModelFailureOf(err), { id, jobId: opts.jobId }))
    }
    if (typeof started !== "string" || started.length === 0 || started === HOUSE_MODEL_CLAIM_REF) {
      throw final(houseModelFailureError({ message: "start resolved without a task reference" }, { id, jobId: opts.jobId }))
    }
    taskRef = started
    // The planned cost rides with the reference: a job the recovery finishes keeps it when the upstream reports none.
    saved = await saveHouseModelReference(opts.jobId, taskRef, planned.providerCostUsd)
    if (!saved) console.warn(`[house-models] job ${opts.jobId} (${id}): the run's reference could not be saved; any failure from here is final`)
  }
  /** A failure after `start`: retryable only when a re-pick can find the saved reference. */
  const afterStart = <E extends Error>(err: E): E => (saved ? err : final(err))

  const deadline = Date.now() + opts.timeoutMs
  let readFailures = 0
  for (;;) {
    // A cancel ends the job through the cancel path (refunded there); it is never retried.
    await throwIfJobCancelled()
    // A drain hands the job back once a re-pick can find the run; an unsaved run keeps polling.
    if (saved && isWorkerDraining()) throw new DrainAbortError()
    let polled: PluginHouseModelPoll | undefined
    try {
      polled = await service.poll(id, taskRef)
      readFailures = 0
    } catch (err) {
      readFailures++
      // The read's own words go to this log line only, redacted like every upstream word.
      console.warn(`[house-models] job ${opts.jobId} (${id}) status read ${readFailures} failed: ${redactProviderDetail(err instanceof Error ? err.message : String(err)) ?? "(no words)"}`)
      if (readFailures >= HOUSE_MODEL_MAX_POLL_READ_FAILURES) {
        throw afterStart(new HouseModelRunPendingError(`${label} stopped answering; the run will be checked again.`, id))
      }
    }
    if (polled?.state === "done") {
      const resultUrls = resultUrlsOf(polled)
      if (!resultUrls) throw final(houseModelFailureError({ message: "done without result files" }, { id, jobId: opts.jobId }))
      return {
        resultUrls,
        ...sizeOf(polled),
        reportedCostUsd: usd(polled.providerCostUsd) ?? null,
        plannedCostUsd: planned.providerCostUsd,
      }
    }
    if (polled?.state === "failed") throw final(houseModelFailureError(houseModelFailureOf(polled), { id, jobId: opts.jobId }))
    if (Date.now() >= deadline) {
      throw afterStart(new HouseModelRunPendingError(`${label} did not finish within ${Math.round(opts.timeoutMs / 60_000)} minutes; the run will be checked again.`, id))
    }
    opts.onProgress?.()
    await sleep(opts.pollIntervalMs)
  }
}

/** Marks `err` final (deterministic: no queue retry runs the lane again) and returns it. */
function final<E extends Error>(err: E): E {
  ;(err as E & { deterministic?: true }).deterministic = true
  return err
}

/** The delivered size, only as a pair. */
function sizeOf(polled: { width?: unknown; height?: unknown }): { width?: number; height?: number } {
  const width = side(polled.width)
  const height = side(polled.height)
  return width && height ? { width, height } : {}
}
