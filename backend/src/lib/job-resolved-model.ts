/**
 * The model a queued job runs — recorded on its row as `input_data.resolvedModel`
 * so the admin Jobs page's Model filter finds every job by the model it ran,
 * including jobs whose payload named none (the handler's default ran) and jobs
 * whose `provider` field holds a vendor or UI name rather than a catalog id.
 *
 * Keyed by the job's BullMQ name, each entry decides as its handler decides:
 * the defaults are the handlers' own constants (`workers/handlers/default-models.ts`,
 * the `@nodaro/shared` defaults the handlers read), never a second copy. The
 * value is in the vocabulary of `MODEL_CATALOG` ids / `LLM_MODELS` ids wherever
 * the model has one; a model the catalog does not list keeps the id its payload
 * names. Nothing here changes what a job runs or bills. It does decide one
 * refusal: on a deployment that restricts models, a workflow node that names
 * no model is judged on the model its built job runs, read through
 * `judgedModelOfJob` below (`lib/run-model.ts` `jobRunModelOfBuild`).
 *
 * Callers: the routes that enqueue these jobs (at insert) and the workflow
 * engine's orchestrator rows (`node-executor.ts`, from the built payload).
 */
import { motionTransferModelOf, videoUpscaleModelOf } from "@nodaro/render-rules"
import { LLM_FEATURE_DEFAULTS, resolveScriptModelId } from "@nodaro/shared/llm-models"
import { defaultImageModel, IMAGE_MODEL_ROLE_DEFAULTS, MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import {
  DEFAULT_SUNO_MODEL,
  DEFAULT_TEXT_TO_AUDIO_PROVIDER,
  DEFAULT_TRANSCRIBE_PROVIDER,
  dialogueProviderOf,
  T2I_TO_I2I_VARIANT,
  type ScriptProvider,
} from "@nodaro/shared/models"
import { DEFAULT_VIDEO_MASK_PROVIDER } from "@nodaro/shared/media"
import {
  CHARACTER_MOTION_DEFAULT_PROVIDER, CREATURE_MOTION_DEFAULT_PROVIDER, EDIT_IMAGE_DEFAULT_PROVIDER, generateImageModelOf,
  IMAGE_TO_VIDEO_DEFAULT_PROVIDER, LIP_SYNC_DEFAULT_PROVIDER, LOCATION_MOTION_DEFAULT_PROVIDER, MOTION_TRANSFER_DEFAULT_PROVIDER,
  OBJECT_MOTION_DEFAULT_PROVIDER, TEXT_TO_VIDEO_DEFAULT_PROVIDER, VIDEO_DEPTH_DEFAULT_PROVIDER, VIDEO_RETAKE_MODEL, VIDEO_TO_VIDEO_DEFAULT_PROVIDER,
  VIDEO_UPSCALE_DEFAULT_PROVIDER, VOICED_VIDEO_DEFAULT_PROVIDER, type GenerateImageModelInput,
} from "../workers/handlers/default-models.js"
import { lottieModelId } from "./lottie-request.js"
import { ttsModelOf } from "./omitted-tts-provider.js"

type Data = Record<string, unknown>

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined)

/** generate-image / reference-board: the model the handler runs, after its image-to-image swap. */
const generateImage = (d: Data): string | undefined => str(generateImageModelOf(d as GenerateImageModelInput).effectiveModel)

const entityImage = (d: Data): string => str(d.provider) ?? IMAGE_MODEL_ROLE_DEFAULTS.character

const withDefault = (defaultModel: string) => (d: Data): string => str(d.provider) ?? defaultModel

/**
 * Motion transfer's `provider` is the node's option ("kling", "kling-3.0", …);
 * the model is the base of the credit id the route bills it under (Kling 2.6 is
 * catalog `motion-transfer`, Kling 3.0 `kling-3.0-motion`).
 */
const motionTransfer = (d: Data): string => motionTransferModelOf(str(d.provider) ?? MOTION_TRANSFER_DEFAULT_PROVIDER)

/** The upscale node's "topaz" is the catalog's `topaz-video` (frontend `free-video-locks.ts` reads it the same way). */
const videoUpscale = (d: Data): string => videoUpscaleModelOf(str(d.provider) ?? VIDEO_UPSCALE_DEFAULT_PROVIDER)

/** A Suno version ("V5") is the catalog entry that carries it as `dataValue` (`suno-v5`). */
const SUNO_CATALOG_ID_BY_VERSION: ReadonlyMap<string, string> = new Map(
  Object.values(MODEL_CATALOG)
    .filter((m) => m.family === "Suno" && typeof m.dataValue === "string")
    .map((m) => [m.dataValue as string, m.id]),
)
const sunoModel = (d: Data): string => {
  const version = str(d.model) ?? DEFAULT_SUNO_MODEL
  return SUNO_CATALOG_ID_BY_VERSION.get(version) ?? version
}

/** scene3d generate / edit: the planner model (handlers/scene3d.ts); an edit carrying `operations` runs none. */
const scene3d = (d: Data): string | undefined =>
  Array.isArray(d.operations) ? undefined : (str(d.llmModel) ?? LLM_FEATURE_DEFAULTS["3d-scene"])

/** The model each job name runs, from its payload — decided as its handler decides. */
export const RESOLVED_MODEL_OF_JOB: Readonly<Record<string, (d: Data) => string | undefined>> = Object.freeze({
  // Images
  "generate-image": generateImage,
  "reference-board": generateImage,
  "image-to-image": (d) => str(d.provider) ?? defaultImageModel("edit", str(d.aspectRatio)),
  "edit-image": withDefault(EDIT_IMAGE_DEFAULT_PROVIDER),
  "generate-character": entityImage,
  "generate-face": entityImage,
  "generate-character-asset": entityImage,
  "generate-object": entityImage,
  "generate-object-asset": entityImage,
  "generate-creature": entityImage,
  "generate-creature-asset": entityImage,
  "generate-location": entityImage,
  "generate-location-asset": entityImage,
  // Video
  "image-to-video": withDefault(IMAGE_TO_VIDEO_DEFAULT_PROVIDER),
  "text-to-video": withDefault(TEXT_TO_VIDEO_DEFAULT_PROVIDER),
  "voiced-video": withDefault(VOICED_VIDEO_DEFAULT_PROVIDER),
  "video-to-video": withDefault(VIDEO_TO_VIDEO_DEFAULT_PROVIDER),
  "motion-transfer": motionTransfer,
  "lip-sync": withDefault(LIP_SYNC_DEFAULT_PROVIDER),
  "video-upscale": videoUpscale,
  "generate-character-motion": withDefault(CHARACTER_MOTION_DEFAULT_PROVIDER),
  "generate-location-motion": withDefault(LOCATION_MOTION_DEFAULT_PROVIDER),
  "generate-object-motion": withDefault(OBJECT_MOTION_DEFAULT_PROVIDER),
  "generate-creature-motion": withDefault(CREATURE_MOTION_DEFAULT_PROVIDER),
  // The extensions (veo-extend, runway-extend, ltx-2.3-pro, seedance-2-5-extend, seedance-2-0-extend, kling-4-extend, pixverse-v6-extend, grok-extend) are catalog ids; `model` is a tier.
  "extend-video": (d) => str(d.provider),
  "video-depth": withDefault(VIDEO_DEPTH_DEFAULT_PROVIDER),
  // A retake runs LTX 2.3 Pro's retake task, whatever its payload says (it is priced on its own retake row).
  "video-retake": () => VIDEO_RETAKE_MODEL,
  "video-mask": withDefault(DEFAULT_VIDEO_MASK_PROVIDER),
  // Audio
  "text-to-speech": (d) => ttsModelOf(str(d.provider), typeof d.text === "string" ? d.text : ""),
  "text-to-dialogue": (d) => dialogueProviderOf(d.provider),
  "text-to-audio": withDefault(DEFAULT_TEXT_TO_AUDIO_PROVIDER),
  "transcribe": withDefault(DEFAULT_TRANSCRIBE_PROVIDER),
  "suno-generate": sunoModel,
  "suno-cover": sunoModel,
  "suno-extend": sunoModel,
  "suno-mashup": sunoModel,
  "suno-add-instrumental": sunoModel,
  "suno-add-vocals": sunoModel,
  "suno-upload-extend": sunoModel,
  // LLM jobs run on the worker
  "generate-script": (d) => resolveScriptModelId(str(d.provider) as ScriptProvider | undefined, str(d.llmModel)),
  "motion-graphics-lottie": (d) => lottieModelId({ llmModel: str(d.llmModel) }),
  "generate-3d-scene": scene3d,
  "edit-3d-scene": scene3d,
})

/** The model a job named `jobName` runs with this payload, or undefined when it names no model we can tell. */
export function resolvedModelOfJob(jobName: string, data: unknown): string | undefined {
  const resolve = Object.hasOwn(RESOLVED_MODEL_OF_JOB, jobName) ? RESOLVED_MODEL_OF_JOB[jobName]! : undefined
  if (!resolve) return undefined
  return resolve(data !== null && typeof data === "object" ? (data as Data) : {})
}

/**
 * Where the model a deployment's restriction judges differs from the model the
 * registry records — each entry overriding its job's registry entry:
 *  - generate-image / reference-board: the model named or defaulted — the
 *    payload's `provider`, else the general default — BEFORE the image-to-image
 *    swap the workflow build (`model`) or the handler (`effectiveModel`)
 *    applies, as a named `provider` is judged (the route's run model judges the
 *    same model); but a build that switched to another model (`model`, not the
 *    named one's image-to-image sibling: a trained character's model) is
 *    judged on that model (`imageModelJudged`);
 *  - a 3D scene build with an advanced `engine`: none — that build sends no
 *    planner model (`scene3d-http.ts` drops it), and the engine is judged where
 *    it runs.
 */
const imageModelChosen = (d: Data): string | undefined =>
  str(generateImageModelOf({ provider: str(d.provider), aspectRatio: str(d.aspectRatio) }).resolvedModel)

/**
 * The model a built image job is judged on: the model it was routed to when
 * the build switched it to another model (a trained character's model, carried
 * in `model` while `provider` names the provider that serves it), else the
 * model named or defaulted. A routed model that is the named one's declared
 * image-to-image sibling (`T2I_TO_I2I_VARIANT`) is not a switch: the named
 * model is judged, as above.
 */
const imageModelJudged = (d: Data): string | undefined => {
  const chosen = imageModelChosen(d)
  const routed = str(d.model)
  if (routed === undefined || routed === chosen) return chosen
  return chosen !== undefined && T2I_TO_I2I_VARIANT[chosen] === routed ? chosen : routed
}

const JUDGED_OVERRIDES: Readonly<Record<string, (d: Data) => string | undefined>> = Object.freeze({
  "generate-image": imageModelJudged,
  "reference-board": imageModelJudged,
  "generate-3d-scene": (d) => (d.engine ? undefined : scene3d(d)),
  "edit-3d-scene": (d) => (d.engine ? undefined : scene3d(d)),
})

/** The model a job named `jobName` runs with this payload, as a model restriction judges it. */
export function judgedModelOfJob(jobName: string, data: unknown): string | undefined {
  if (!Object.hasOwn(JUDGED_OVERRIDES, jobName)) return resolvedModelOfJob(jobName, data)
  return JUDGED_OVERRIDES[jobName]!(data !== null && typeof data === "object" ? (data as Data) : {})
}

/** `inputData` with the model the job runs recorded as `resolvedModel` (unchanged when none can be told). */
export function withResolvedModel<T extends Data>(inputData: T, jobName: string, payload: unknown = inputData): T & { resolvedModel?: string } {
  const resolvedModel = resolvedModelOfJob(jobName, payload)
  return resolvedModel ? { ...inputData, resolvedModel } : inputData
}
