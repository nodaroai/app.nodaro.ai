import { DrainAbortError } from "../../lib/worker-drain.js"
import { buildNodeOutputFromJobData } from "./output-extractor.js"
import type { NodeOutput } from "./types.js"

/**
 * The ONE way a FAILED node's `NodeExecutionState.output` is produced.
 *
 * A run can refuse its result and still RETAIN what it produced. The 3D-scene
 * authoring lanes are the motivating case: once the repair budget is spent and
 * the visual reviewer refuses the scene, the job settles `failed` under
 * `SCENE_QUALITY_FAILED` — but the planner produced a recipe, the compiler
 * accepted it, the builder exported it, and `jobs.output_data` carries the
 * draft (`scenePlan`, `sceneRevisionId`, `deliveryId`, `posterAssetId`,
 * `validation`, `metadata.review`). That revision was billed and published.
 * A run whose visual review gave no usable verdict (never reached its provider,
 * or answered unusably) retains the same shape
 * under `SCENE_REVIEW_UNAVAILABLE`, minus the `metadata` block — a scene NOBODY
 * judged, whose `validation.warnings[]` leads with that code instead. Neither
 * error code appears below, which is why the second one needed no change.
 * Until this existed, every emitter of a failed node state built a fresh
 * object with `status`, `error` and nothing else, so the draft reached no
 * client — the canvas showed a bare refusal for a scene it had paid for.
 *
 * Deliberately DATA-DRIVEN, never keyed on a node-type list: it asks
 * `buildNodeOutputFromJobData` — the same extractor the COMPLETED path uses —
 * what the row actually carries, and answers `undefined` when that is nothing.
 * A new node type that starts retaining a result on failure is covered the day
 * its output keys are extractable, with no list to remember.
 *
 * Consumers gate on the FIELD, not on the status: presence of `output` on a
 * failed node never means the node succeeded.
 *
 * @param outputData `jobs.output_data` of the failed row (any shape, incl. null)
 * @param nodeType   the node's type, for the extractor's type-specific branches
 */
export function retainedOutputOfFailedJob(
  outputData: unknown,
  nodeType: string,
): NodeOutput | undefined {
  if (!outputData || typeof outputData !== "object" || Array.isArray(outputData)) return undefined
  const output = buildNodeOutputFromJobData(outputData as Record<string, unknown>, nodeType)
  return Object.values(output).some((v) => v != null) ? output : undefined
}

/**
 * The stable code a FAILED job recorded beside its sentence, so the failed node
 * state carries it as `errorCode` and the canvas, MCP and `diagnose_run` branch
 * on the code, never on the text. The sentence stays the job's `error_message`.
 *
 * Today one writer: UGC Clip, which stops a clip by name before its video
 * renders and keeps the code in `output_data.clipError.code` (a voice too long
 * for the video model's longest clip is `clip_voice_too_long`). Read for that
 * node type only: `clipError` is UGC Clip's key, not a shared convention.
 *
 * @param outputData `jobs.output_data` of the failed row (any shape, incl. null)
 * @param nodeType   the node's type
 * @returns the code, or undefined when the row recorded none
 */
export function failedJobErrorCode(outputData: unknown, nodeType: string): string | undefined {
  if (nodeType !== "ugc-clip") return undefined
  if (!outputData || typeof outputData !== "object" || Array.isArray(outputData)) return undefined
  const clipError = (outputData as { clipError?: unknown }).clipError
  if (!clipError || typeof clipError !== "object" || Array.isArray(clipError)) return undefined
  const code = (clipError as { code?: unknown }).code
  return typeof code === "string" && code.trim() !== "" ? code : undefined
}

/**
 * The same answer, read off the REJECTION an executing node threw rather than
 * off a job row.
 *
 * The orchestrator never sees the job — `pollJobToCompletion` polls it and
 * throws, attaching what {@link retainedOutputOfFailedJob} found (exactly as it
 * attaches `errorCode` and `errorHint`). This is the reader for that, and it
 * exists as a NAMED export so both emitters of a failed `NodeExecutionState`
 * import this one module: `failed-node-output-totality.test.ts` fails the build
 * for a failed-state writer that imports neither.
 */
export function retainedOutputOfRejection(reason: unknown): NodeOutput | undefined {
  if (!reason || typeof reason !== "object") return undefined
  const output = (reason as { output?: unknown }).output
  if (!output || typeof output !== "object" || Array.isArray(output)) return undefined
  return output as NodeOutput
}

/**
 * What a refused node already CHARGED before it failed — a node whose own child jobs were paid
 * along the way (UGC Creator's images and readings, UGC Cards' timing jobs) — read off its
 * rejection (`creditsUsed`), so the run's total and the failed state show what was spent. A
 * positive number of credits, else undefined.
 */
export function chargedCreditsOfRejection(reason: unknown): number | undefined {
  const credits = reason && typeof reason === "object" ? (reason as { creditsUsed?: unknown }).creditsUsed : undefined
  return typeof credits === "number" && Number.isFinite(credits) && credits > 0 ? credits : undefined
}

/**
 * A rejection that carries what its node charged (`creditsUsed`): a COPY, keeping its message and
 * every field the orchestrator reads off it (`errorCode`, `errorHint`, `output`); the original is
 * left as it was. Nothing charged, or a deploy drain (the run is requeued and counts the jobs
 * when it resumes), and the rejection goes on as it came.
 */
export function withChargedCredits(reason: unknown, credits: number): unknown {
  if (!(credits > 0) || reason instanceof DrainAbortError) return reason
  if (!(reason instanceof Error)) return Object.assign(new Error(String(reason)), { creditsUsed: credits })
  const copy = Object.assign(new Error(reason.message), reason, { creditsUsed: credits })
  copy.name = reason.name
  if (reason.stack !== undefined) copy.stack = reason.stack
  return copy
}

/**
 * What an ALL-OR-NOTHING fan-out (`FAN_OUT_ALL_OR_NOTHING_TYPES`, UGC Clip) still finished when one
 * of its items failed and the node failed as a whole: how many items it had, how many finished, and
 * the finished items' jobs (in settle order, never by position) and, beside each, the row it ran
 * (from 0: a UGC Clip's row is its clip). Rides the failed node state as `iterationTotal` /
 * `iterationCompleted` / `jobIds` / `jobRows`, so a reader can see what was made and paid for —
 * never `output.listResults`: a failed node hands no list on, so no reader takes a partial list
 * for the node's output.
 */
export interface FanOutProgress {
  readonly iterationTotal: number
  readonly iterationCompleted: number
  readonly jobIds: readonly string[]
  /** The row each of `jobIds` ran (from 0), index-aligned with it. */
  readonly jobRows: readonly number[]
}

/**
 * A rejection that carries what its fan-out finished (`fanOutProgress`): a COPY, keeping its message
 * and every field the orchestrator reads off it (`errorCode`, `errorHint`, `output`, `creditsUsed`);
 * the original is left as it was. A deploy drain goes on as it came (the run is requeued).
 */
export function withFanOutProgress(reason: unknown, progress: FanOutProgress): unknown {
  if (reason instanceof DrainAbortError) return reason
  const fanOutProgress: FanOutProgress = {
    iterationTotal: progress.iterationTotal,
    iterationCompleted: progress.iterationCompleted,
    jobIds: [...progress.jobIds],
    jobRows: [...progress.jobRows],
  }
  if (!(reason instanceof Error)) return Object.assign(new Error(String(reason)), { fanOutProgress })
  const copy = Object.assign(new Error(reason.message), reason, { fanOutProgress })
  copy.name = reason.name
  if (reason.stack !== undefined) copy.stack = reason.stack
  return copy
}

/** What a failed fan-out finished, read off its rejection (`withFanOutProgress`); undefined when it carries none. */
export function fanOutProgressOfRejection(reason: unknown): FanOutProgress | undefined {
  const raw = reason && typeof reason === "object" ? (reason as { fanOutProgress?: unknown }).fanOutProgress : undefined
  if (!raw || typeof raw !== "object") return undefined
  const { iterationTotal, iterationCompleted, jobIds, jobRows } = raw as Record<string, unknown>
  const count = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0
  if (!count(iterationTotal) || !count(iterationCompleted) || !Array.isArray(jobIds)) return undefined
  // Each job with its row; a row that cannot be read leaves every row out (the jobs still count).
  const rows = Array.isArray(jobRows) && jobRows.length === jobIds.length && jobRows.every(count) ? (jobRows as number[]) : undefined
  const kept = jobIds.flatMap((id, i) => (typeof id === "string" && id.length > 0 ? [{ id, row: rows?.[i] }] : []))
  const keptRows = kept.map((k) => k.row).filter(count)
  return {
    iterationTotal,
    iterationCompleted,
    jobIds: kept.map((k) => k.id),
    jobRows: keptRows.length === kept.length ? keptRows : [],
  }
}
