/**
 * Typed request bodies and results for the image routes beside
 * `generate-image`: `image-to-image`, `edit-image`, `split-image` and
 * `generate-mask` — the overloads live on `NodesResource.run` / `runAndWait`.
 *
 * Every vocabulary is the platform's own (`@nodaro/shared`), never a copy:
 * the route Zod enums are built from the same tuples. The field lists are held
 * to the route bodies by `backend/src/routes/__tests__/sdk-image-params-contract.test.ts`.
 */
import type {
  ImageAspectRatio,
  ImageEditProvider,
  ImageEditTargetResolution,
  ImageQuality,
  ImageRenderingSpeed,
  ImageResolution,
  ModifyImageProvider,
  TaskChainedEditProvider,
} from "@nodaro/shared/models"
import type { TopazUpscaleFactor } from "@nodaro/shared/credits"
import type { ImageToImageAttachColumn } from "@nodaro/shared/entities"
import type { GenerationSessionParams, NodeJobOutput, RunNodeAdjustment } from "./nodes.js"

/**
 * What `nodes.run("image-to-image" | "edit-image" | "generate-mask", …)`
 * answers: the job it started. Wait for it with `runAndWait` (or poll
 * `jobs.getStatus(jobId)`).
 */
export type ImageJobStarted = {
  jobId: string
  /** Parameters the server corrected for the chosen model (an aspect ratio it does not draw, …); the run used the corrected values. */
  adjustments?: RunNodeAdjustment[]
  [k: string]: unknown
}

/**
 * Typed request body for `nodes.run("image-to-image", …)` / `runAndWait` —
 * restyle or edit one image with a prompt (`POST /v1/image-to-image`). The
 * completed job writes `imageUrl`. (`modify-image` runs through this route.)
 *
 * Levers a model does not take are corrected to one it does, and reported in
 * the answer's `adjustments` — never rejected. Any other route field passes
 * through.
 */
export interface ImageToImageParams extends GenerationSessionParams {
  /** The source image — a public http(s) URL. */
  imageUrl: string
  prompt: string
  /** The prompt as your user typed it, when `prompt` is a version your app expanded. Stored on the job; never sent to the model. */
  userPrompt?: string
  /** Omitted: the platform's default edit model for the requested `aspectRatio`. */
  provider?: ModifyImageProvider
  /** Extra reference images, up to 13. On models priced per reference, `imageUrl` counts as one. */
  referenceImageUrls?: string[]
  resolution?: ImageResolution
  quality?: ImageQuality
  /** 0–1: how far the result may move from the source (taken by the models in `I2I_STRENGTH_SUPPORT`). */
  strength?: number
  /** `"auto"` on a model without a native auto keeps the source image's shape (the model's nearest ratio). */
  aspectRatio?: ImageAspectRatio
  /** Up to 5,000 characters. */
  negativePrompt?: string
  /** A whole number ≥ 0 (taken by the models in `SEED_SUPPORT`). */
  seed?: number
  /** Ideogram's speed tier (the models in `RENDERING_SPEED_SUPPORT`). */
  renderingSpeed?: ImageRenderingSpeed
  /** 0–30: prompt adherence (taken by the models in `GUIDANCE_SCALE_SUPPORT`). */
  guidanceScale?: number
  /**
   * Inpainting mask — white = the area to change, black = keep. Sent to the
   * model as its own mask, so only the mask-capable image-to-image models use
   * it (`I2I_MASK_SUPPORT`: `ideogram-edit`, `flux-fill`); others ignore it.
   * For a mask on any image model, see `GenerateImageParams.maskUrl`.
   */
  maskUrl?: string
  /** Character Studio: the asset's one-line description (up to 1,000 characters); drafted for you when omitted on the studio path. */
  description?: string
  /** Character Studio: real-life reference photos, up to 5. Used on the studio path only. */
  realLifeRefs?: string[]
  /** Character Studio: with `attachToColumn` and `attachName`, the result is added to this character (one of yours). */
  attachToCharacterId?: string
  attachToColumn?: ImageToImageAttachColumn
  /** 1–200 characters. */
  attachName?: string
  /** Append the character's identity description to the prompt (not on the studio path). Default `false`. */
  injectCharacterContext?: boolean
  [k: string]: unknown
}

/**
 * The fields both forms of an `edit-image` request take. See
 * {@link EditImageParams}.
 */
export interface EditImageCommonParams extends GenerationSessionParams {
  /**
   * The edit instruction. REQUIRED for `nano-banana-edit` and `grok-2-edit`
   * (a `400 validation_error` without one); the upscalers and background
   * removal take none.
   */
  prompt?: string
  /** The prompt as your user typed it. Stored on the job; never sent to the model. */
  userPrompt?: string
  /** `topaz-image-upscale`: the factor. Wins over `targetResolution`. */
  upscaleFactor?: TopazUpscaleFactor
  /** The upscalers' output tier. On `topaz-image-upscale` it maps to a factor (2K → 2, 4K and 8K → 4) when `upscaleFactor` is absent. */
  targetResolution?: ImageEditTargetResolution
  /** Corrected per model; dropped for the models that take none (the upscalers, background removal, the Grok task ops). */
  aspectRatio?: ImageAspectRatio
  /** Up to 5,000 characters. */
  negativePrompt?: string
  /** Up to 500 characters. */
  style?: string
  /** A whole number ≥ 0. */
  seed?: number
  /** Up to 13. */
  referenceImageUrls?: string[]
  /** Inpainting mask, passed to the model as its mask; a model that takes none ignores it. */
  maskUrl?: string
  [k: string]: unknown
}

/** An `edit-image` request on an image URL — every provider but the Grok task ops. */
export interface EditImageFromUrlParams extends EditImageCommonParams {
  /** The image to edit — a public http(s) URL. */
  imageUrl: string
  /** Default `recraft-upscale`. */
  provider?: Exclude<ImageEditProvider, TaskChainedEditProvider>
  taskId?: never
}

/**
 * An `edit-image` request on a prior Grok generation — `grok-upscale`,
 * `grok-2-edit`, `grok-2-segment` take that generation's task id instead of an
 * image URL (`TASK_CHAINED_EDIT_PROVIDER_IDS`).
 */
export interface EditImageFromTaskParams extends EditImageCommonParams {
  /** The prior Grok generation's task id — its job's `output_data.kieTaskId`. 1–200 characters. */
  taskId: string
  provider: TaskChainedEditProvider
  imageUrl?: never
  /**
   * `grok-2-edit` only: limit the edit to these segments — the `index` values
   * a `grok-2-segment` run returned, passed through as they are. 1–64 whole
   * numbers ≥ 0.
   */
  maskIndexes?: number[]
}

/**
 * Typed request body for `nodes.run("edit-image", …)` / `runAndWait` —
 * upscale, remove the background, or prompt-edit (`POST /v1/edit-image`).
 * Exactly one source: `imageUrl` for every provider except the Grok task ops,
 * which take `taskId` (and must name their `provider`). The provider defaults
 * to `recraft-upscale`. The completed job writes `imageUrl`.
 *
 * The union is checked when the body is typed as `EditImageParams`
 * (`const params: EditImageParams = …` or `{ … } satisfies EditImageParams`). A
 * body written inline that fails it falls through to the untyped
 * `run(type: string, …)` overload, compiles, and resolves `RunNodeResult`.
 */
export type EditImageParams = EditImageFromUrlParams | EditImageFromTaskParams

/**
 * Typed request body for `nodes.run("split-image", …)` — cut one image into a
 * grid of tiles (`POST /v1/split-image`). Free and SYNCHRONOUS: no job is
 * created, so `runAndWait` does not apply (it would throw: the answer has no
 * `jobId`) and there are no session fields; the answer is the tiles
 * themselves ({@link SplitImageResult}).
 */
export interface SplitImageParams {
  /** The image to cut — a public http(s) URL. */
  imageUrl: string
  /** Columns, 1–6. */
  gridCols: number
  /** Rows, 1–6. */
  gridRows: number
  /**
   * One name per tile, row by row (1–36). Must hold exactly
   * `gridCols × gridRows` entries (`gridCols` and `gridRows` each 1–6) — a
   * `400 validation_error` otherwise.
   */
  names: string[]
  [k: string]: unknown
}

/** One tile of a split — see {@link SplitImageResult}. */
export type SplitImageTile = { name: string; url: string }

/** What `nodes.run("split-image", …)` answers: every tile as a PNG, in `names` order. */
export type SplitImageResult = { images: SplitImageTile[] }

/**
 * Typed request body for `nodes.run("generate-mask", …)` / `runAndWait` — a
 * black-and-white mask of the subject a prompt names (`POST /v1/generate-mask`),
 * ready for `maskUrl` on the inpainting routes. The completed job writes
 * {@link GenerateMaskJobOutput}.
 */
export interface GenerateMaskParams extends GenerationSessionParams {
  /** The image to mask — a public http(s) URL. */
  imageUrl: string
  /** What to mask, in words ("the red car"), 1–500 characters. */
  prompt: string
  /** 0–1 detection confidence; lower takes in more. Default 0.3. */
  threshold?: number
  [k: string]: unknown
}

/** The completed `generate-mask` job's `output_data`. */
export interface GenerateMaskJobOutput extends NodeJobOutput {
  /** The source image, unchanged — so the pair travels together. */
  readonly imageUrl: string
  /** The mask, a black-and-white PNG: white = the subject, black = everything else. */
  readonly maskUrl: string
}
