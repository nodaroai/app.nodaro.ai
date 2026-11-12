/**
 * What each house model's lane adds to the seam, by id
 * (docs/design/house-models.md): the args that hold input-file URLs and the
 * rule those files must meet, the ONE delivery of a finished run, how a HELD run
 * settles on what it delivered, the plan arguments that price a delivered
 * output when the upstream reports no cost, and the lane's own sentences for a
 * failed run (`failureSentences`). Read by the worker's lane and by
 * the reconcile kind that finishes a job whose worker died
 * (lib/reconcile/house-model.ts): both deliver through
 * `deliverHouseModelRun` (house-model-delivery.ts), so a recovered job is
 * delivered exactly like a normal one.
 *
 * One row per house model. A new house model adds ONE row, keyed by its
 * catalog id, beside its rows in `house-model-timeouts.ts`. Every field is
 * neutral data about OUR model — never an upstream's name, request or rate.
 */
import type { HouseModelDeliveryOutcome, HouseModelPricedDelivery } from "./house-model-delivery.js"
import { NODARO_IMAGE_UPSCALE_LANE } from "./nodaro-image-upscale-size.js"

/**
 * The rule every input file of a run must meet — the ONE place its numbers
 * live. A lane hands it to the step that stores the input (an outside file is
 * copied to our storage under `maxBytes` as a hard cap on the bytes read; a
 * file already on our storage is measured from our storage's own object
 * metadata, never from a caller's claim). That step's measurement is the only
 * one: the lane passes what it measured to `runHouseModelTask` as
 * `inputFacts`, and the runner checks those same facts against this rule
 * before `start` — it never measures again. Applies to every file under the
 * row's `inputUrlArgs`. Neutral data about OUR model.
 */
export interface HouseModelInputRule {
  /** Which source the rule is about: the job's image or its video. */
  readonly media: "image" | "video"
  /** The file formats the model takes, as the platform's media probe names them (`png`, `jpeg`, `webp`, `mp4`…). Absent: any. */
  readonly acceptedFormats?: readonly string[]
  /** The largest input file the model takes, in bytes. Absent: no limit of its own. */
  readonly maxBytes?: number
}

/**
 * What the one measurement found for a stored input file, keyed by the stored
 * URL exactly as it appears in the run's `args`: its size in bytes — counted
 * while copying an outside file under the cap, or read from our storage's own
 * object metadata for a file already there, never from a caller's claim — and,
 * when the rule declares `acceptedFormats`, its format as the platform's media
 * probe names it (`png`, `jpeg`, `mp4`…, not a MIME type).
 */
export interface HouseModelInputFacts {
  readonly bytes: number
  readonly format?: string
}

/**
 * A lane's own sentences for a failed run, by the class of failure the plugin
 * reported (`PluginHouseModelFailure`). `houseModelFailureError` uses the
 * lane's sentence for that class when one is given, and the seam's fixed
 * sentence otherwise; every failure writer (the video worker's final catch and
 * the reconcile) keeps the job's own sentence, never the generic safety one.
 * Fixed text about OUR model, in plain words, that may name another model the
 * person can try — never an upstream's words, a URL or an internal id.
 */
export interface HouseModelFailureSentences {
  /** The plugin reported a content-policy block (`contentPolicy`). */
  readonly contentPolicy?: string
  /**
   * The upstream refused the run's input file (`inputImageRefused`,
   * `inputVideoRefused`, or a request refused for its input video). A failure
   * that is both a content-policy block and a refused input reads the
   * `contentPolicy` sentence.
   */
  readonly inputRefused?: string
}

/** What a finished run delivered, as the worker or the reconcile cron reads it. */
export interface HouseModelDelivered {
  /** The first result file, re-hosted or about to be. */
  readonly url: string
  readonly width?: number
  readonly height?: number
}

export interface HouseModelLane {
  /**
   * REQUIRED: the `args` keys that hold the URL of an input file the upstream
   * fetches (`imageUrl`, `videoUrl`, …), or `[]` for a model that reads no
   * file. Each one's value is a URL or an array of URLs. `runHouseModelTask`
   * refuses to start a run when any of them is not a file of this install's
   * own storage (`isOwnStoredFileUrl`, lib/own-storage-url.ts): an outside file
   * is copied to our storage first, and that copy is what is measured, billed
   * and sent. A row without this field is refused (the runner, and the guard
   * test over this table).
   */
  readonly inputUrlArgs: readonly string[]
  /** The input rule, for a model that reads a source file. */
  readonly input?: HouseModelInputRule
  /**
   * The ONE delivery of a finished run for this lane — re-host, a thumbnail
   * where the lane makes one, the output fields, the job's provider (the
   * house-model id) and the settle — when the default
   * (`defaultHouseModelDelivery`: the result re-hosted by the shared finalize,
   * `settledBase` applied) does not fit. Both paths call it with the same
   * inputs; nothing else in the seam delivers.
   */
  readonly deliver?: (delivery: HouseModelPricedDelivery) => Promise<HouseModelDeliveryOutcome>
  /**
   * The BASE (pre-markup) credits a HELD run settles to once it delivered — a
   * figure ABOVE 0 — or undefined to commit the reservation as it stands; read
   * by the default delivery. `job` is the worker's payload or the job's
   * `input_data`. Handed to `finalizeJobWithMedia` as `meteredBaseCredits`
   * (marked up once, never above the reservation). 0 does NOT mean "charge
   * nothing": the count-based settle needs a value above 0, so a 0 would
   * commit the WHOLE reservation — the delivery refuses it with an error log
   * and commits the reservation as it stands. A run that should cost nothing
   * is refused before its hold, never settled to 0.
   */
  readonly settledBase?: (job: Readonly<Record<string, unknown>>, delivered: HouseModelDelivered) => Promise<number | undefined>
  /**
   * The `plan` arguments that price what was delivered, built from the job's
   * request (the worker's payload or the job's `input_data`), for a run whose
   * upstream reports no cost (a run held without knowing its size); undefined
   * keeps the start's planned figure. Read by the one delivery, so the worker
   * and the recovery price a run alike.
   */
  readonly deliveredPlanArgs?: (
    job: Readonly<Record<string, unknown>>,
    delivered: HouseModelDelivered,
  ) => Readonly<Record<string, unknown>> | undefined
  /** The lane's own failure sentences, by class; a class with none reads the seam's fixed sentence. */
  readonly failureSentences?: HouseModelFailureSentences
}

/** Per-id lane rows. Keyed by the catalog id of an `ownLabel` entry. */
export const HOUSE_MODEL_LANES: Readonly<Record<string, HouseModelLane>> = Object.freeze({
  // Nodaro Image Upscale (lib/nodaro-image-upscale-size.ts): one image, at most 20 MB.
  "nodaro-image-upscale": NODARO_IMAGE_UPSCALE_LANE,
})

/** The lane row of `id`, or undefined when the table has none. */
export function houseModelLane(id: string): HouseModelLane | undefined {
  return Object.hasOwn(HOUSE_MODEL_LANES, id) ? HOUSE_MODEL_LANES[id] : undefined
}

/** The classes a lane may give a failure sentence for (`HouseModelFailureSentences`). */
const FAILURE_SENTENCE_CLASSES: ReadonlySet<string> = new Set(
  ["contentPolicy", "inputRefused"] satisfies ReadonlyArray<keyof HouseModelFailureSentences>,
)

/**
 * What is wrong with a lane row, or `[]` for a row the runner may use: it
 * exists, it declares `inputUrlArgs` as a list of arg names (empty only for a
 * model that reads no file), a row with an input rule names at least one, and
 * each failure sentence it gives is a non-empty string of a known class.
 */
export function houseModelLaneProblems(row: unknown): string[] {
  if (row === null || typeof row !== "object") return ["no lane row"]
  const { inputUrlArgs, input, failureSentences } = row as { inputUrlArgs?: unknown; input?: unknown; failureSentences?: unknown }
  if (!Array.isArray(inputUrlArgs)) {
    return ["declares no inputUrlArgs (the args holding an input file's URL, or [] for a model that reads none)"]
  }
  const problems: string[] = []
  inputUrlArgs.forEach((name, i) => {
    if (typeof name !== "string" || name.trim().length === 0) problems.push(`inputUrlArgs[${i}] is not an arg name`)
  })
  if (new Set(inputUrlArgs).size !== inputUrlArgs.length) problems.push("inputUrlArgs names an arg twice")
  if (input !== undefined && inputUrlArgs.length === 0) problems.push("has an input rule but names no input URL arg")
  if (failureSentences !== undefined) {
    if (failureSentences === null || typeof failureSentences !== "object") {
      problems.push("failureSentences is not an object")
    } else {
      for (const [cls, sentence] of Object.entries(failureSentences)) {
        if (!FAILURE_SENTENCE_CLASSES.has(cls)) problems.push(`failureSentences.${cls} is not a failure class`)
        else if (typeof sentence !== "string" || sentence.trim().length === 0) problems.push(`failureSentences.${cls} is not a sentence`)
      }
    }
  }
  return problems
}
