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
