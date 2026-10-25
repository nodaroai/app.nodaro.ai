import type { GenerateScene3DParams, EditScene3DParams, RenderScene3DParams, Scene3DJobOutput, Pro3DRenderRunParams, Pro3DRenderJobOutput } from "./scene3d-types.js"
import type { ImageToImageParams, EditImageParams, SplitImageParams, SplitImageResult, GenerateMaskParams, GenerateMaskJobOutput, ImageJobStarted } from "./nodes-image-params.js"
import type { VideoToVideoParams, NodeQuote } from "./nodes-video-params.js"
import type { NodaroClientCore } from "../core.js"
import type { JobStatusResult, JobsResource } from "./jobs.js"
import { JobAbortedError, JobFailedError, JobHeldError, JobTimeoutError, NodaroError, NotFoundError } from "../errors.js"
import { NODE_RUN_ROUTES, NODE_TYPES_WITHOUT_RUN_ROUTE, nodeRunRoute } from "@nodaro/shared/nodes"
import {
  SOCIAL_POST_NODE_PLATFORM,
  type SocialPost,
  type SocialPlatform,
  type SocialSearchMode,
  type SocialSearchParams
} from "@nodaro/shared/social"
import type { ConnectedReference, DescribedReference } from "@nodaro/shared/types"
import type { VideoCharacterReference } from "@nodaro/shared/video"
import type { ModelInputAdjustment } from "@nodaro/shared/model-catalog"
import type { VideoDepthProvider, VideoDepthModelSize, VideoDepthColormap, VideoDepthResolution } from "@nodaro/shared/media"
import type { DirectionFields, SubjectFields } from "@nodaro/prompts/prompt-builder"

export type NodeCategory =
  | "input"
  | "parameter"
  | "ai-image"
  | "ai-video"
  | "ai-audio"
  | "ai-text"
  | "processing"
  | "composition"
  | "trigger"
  | "output"
  | "control"
  | "entity"
  | "utility"

export type OutputType = "text" | "image" | "video" | "audio" | "data" | "none"

/**
 * Field shape inside a node's `inputSchema.fields[]`. Mirrors
 * `backend/src/lib/node-registry.ts`.
 */
export interface NodeInputField {
  key: string
  type: string
  required?: boolean
  options?: string[]
}

export interface NodeInputSchema {
  fields: NodeInputField[]
}

/**
 * A per-unit price on a node descriptor. A run of N units is charged
 * `ceil(N × creditsPerUnit)`, rounded up once — so `GET /v1/credits/model-cost`
 * for `identifier` (one unit, rounded up: the least a run pays) times N can come
 * to more. `<identifier>:<N>u` is the exact price of N units; for a whole run
 * use `POST /v1/credits/estimate-workflow`.
 */
export interface NodeCreditRate {
  /** The price id the rate is read from. */
  identifier: string
  /** What one unit is, as a token (`"1000-frames"`: one started block of 1,000 sampled frames). */
  unit: string
  /** The credits one unit adds to a run's total — exact, not rounded. */
  creditsPerUnit: number
  /** The fewest units a run is charged for. */
  minUnits: number
  /** `"ceil-run-total"`: the run's total is rounded up to a whole credit once, never per unit. */
  rounding: "ceil-run-total"
  /** The rule in words. */
  note: string
}

/**
 * Node descriptor returned by `GET /v1/nodes` and `GET /v1/nodes/:type`.
 * Mirrors `backend/src/lib/node-registry.ts#NodeDescriptor`.
 */
export interface NodeDescriptor {
  type: string
  label: string
  category: NodeCategory
  description: string
  outputType: OutputType
  /** The credits a run is charged, the figure on the node's Run button.
   *  Number when fixed, string range like "10-80" when model-dependent.
   *  Undefined when the node is free — or on editions
   *  without a credit system (community/business omit the field entirely;
   *  it is meaningful on Cloud only). */
  creditCost?: number | string
  /** `creditCost` is an ESTIMATE: a metered LLM node's typical call on its
   *  default model, charged its actual usage after the run (shown `≈N`).
   *  Absent for a fixed price, and under the tier-pricing rollback. A metered
   *  LLM node whose default model has no price yet lists `creditCost:
   *  "unpriced"` (a run on it is refused `llm_model_unpriced`). */
  estimate?: true
  /** A node charged per unit of its own measure (its `creditCost` is a word
   *  such as `"per-1000-frames"`): the charged price of one unit and how a run
   *  rounds. Cloud only, like `creditCost`. */
  creditRate?: NodeCreditRate
  /** Input fields the node exposes for user override (subset of full config). */
  inputSchema?: NodeInputSchema
  /** For AI nodes: list of provider IDs supported. */
  providers?: string[]
  /** Capability flags such as "supports-reference-image" or "supports-end-frame". */
  capabilities?: string[]
  /** Hard duration ceiling in seconds (e.g. Generate Video Pro's env-configured cap). */
  maxDurationSec?: number
  /** Providers whose segment-duration menu is sparse (off-menu values snap to the nearest entry). */
  sparseProviders?: string[]
  /** Per-provider resolution tiers, e.g. `{ "minimax-h3": ["2K", "768P"] }`. */
  providerResolutions?: Record<string, string[]>
  /** Per-provider map of display resolution → the literal wire value the API expects. */
  providerResolutionWire?: Record<string, Record<string, string>>
  /** Generate Video Pro: the deployed engine accepts the `soundtrack` input (original-audio replay). */
  soundtrack?: boolean
}

/**
 * Result of a direct node execution. Most node types return `{ jobId }` and
 * are processed asynchronously by a worker — the caller polls
 * `client.jobs.get(jobId)` until status is `completed`/`failed`.
 *
 * Some node types (`meta-ads-scrape`, for one) answer synchronously and
 * return their full result body. The shape is route-specific; consumers
 * should branch on the presence of `jobId`.
 */
/**
 * One parameter the server corrected because the chosen model does not accept
 * the value you sent (e.g. `gpt-image-2` has no 3:2 aspect ratio). The run
 * proceeds with the corrected value rather than failing — this is how you find
 * out what it actually used.
 *
 * Re-exports `@nodaro/shared`'s `ModelInputAdjustment` — the same shape the
 * server's `normalizeModelInput` / `resolveNormalizedImageGen` populate — under
 * the SDK's naming convention, rather than declaring a second copy of the
 * fields.
 */
export type RunNodeAdjustment = ModelInputAdjustment

/**
 * WHO is in the shot, as picker-catalog option ids — the `subject` field of
 * `generate-image` (and `text-to-video`). The platform writes the wording from
 * the ids you send; you never write prompt text for the subject. It composes
 * with `prompt`: the subject clauses are folded in right after your prompt and
 * ahead of any `direction`.
 *
 * A flat map of field → id(s):
 * - **Keys** are the platform's own picker field names — every Person field
 *   (`type`, `age`, `ethnicity`, `hairBase`, `lipState`, …), every Styling
 *   field (`makeup`, `jewelry`, `outerwear`, …), and the prop keys `heldProp`,
 *   `material` and `animal`. They and their ids come from the picker catalogs:
 *   `pickerCatalogs.get("person")` / `get("styling")` list each dimension's
 *   `field` with its `options[].id`; `get("held-prop")`, `get("material")` and
 *   `get("animal")` write their `options[].id` to the catalog's `valueField`.
 * - **Values** are one id or a list of ids. Ids past a dimension's own cap are
 *   dropped, not rejected.
 * - **One number:** `customAge` (years, rounded and clamped to 0–120), read only
 *   when `age` is `"age-custom"`. A number on any other key does nothing.
 * - **Bounds** (without `presetId`): at most 128 keys, 64 characters per key,
 *   8 ids per key and 100 characters per id — a map over any of them is a 400
 *   `validation_error`. Unknown keys and unknown ids within them are skipped,
 *   and the job's `input_data.subject` records the ids that were used.
 * - **With `presetId`** your `subject` replaces the preset's own and is folded
 *   into the preset's prompt, as `direction` and `structured` are: an over-long
 *   key, id or list is dropped rather than rejected, and `input_data` does not
 *   record the subject.
 *
 * Same type as `@nodaro/prompts`' `SubjectFields`, under the SDK's name.
 */
export type Subject = SubjectFields

/**
 * Something you asked for that the run did not send, with why — e.g.
 * `moodboard_images_not_sent`: some of a `moodboard:<id>` direction's images
 * did not fit the model's reference limit after your own references. The run
 * goes ahead; the same warnings are kept on the job's `input_data.warnings`.
 */
export interface RunNodeWarning {
  code: string
  message: string
}

export type RunNodeResult =
  | { jobId: string; usageLogId?: string; adjustments?: RunNodeAdjustment[]; warnings?: RunNodeWarning[]; [k: string]: unknown }
  | Record<string, unknown>

/**
 * Structured references — the editor's wired-reference shape — shared by
 * `generate-image` and `generate-video`. The route assembles them server-side
 * into per-ref `@image_N` directives and resolves `{image:N}` prompt tokens, so
 * a direct SDK run binds inline references exactly like the canvas. Pass the
 * same `ConnectedReference[]` the editor builds; the route dedupes + caps them
 * to the provider's image-reference limit.
 */
export interface StructuredReferenceParams {
  /** Wired references assembled server-side (deduped + capped per provider). */
  connectedReferences?: ConnectedReference[]
  /**
   * References you can NAME and DESCRIBE but have no media for — a cast role no
   * entity is bound to yet, a character that exists only in the script. They
   * carry no url, so nothing is attached and no `@image_N` seat is used: each
   * becomes a `<Name> — <description>.` line, and a name left in the prompt
   * prose reaches the model as a real, described subject. Up to 10.
   */
  describedReferences?: DescribedReference[]
  /** Reorder the assembled reference list by stable ref ids; renumbers `@image_N`. */
  referenceOrder?: string[]
}

/**
 * Captions for a node's video / audio rail references — INDEX-ALIGNED with
 * `referenceVideoUrls` / `referenceAudioUrls`, so `referenceVideoCaptions[0]`
 * describes `referenceVideoUrls[0]`. Each renders as `@video_N: <caption>.` /
 * `@audio_N: <caption>.` in the assembled prompt and is bounded by the number of
 * rail references that actually ship, so a caption can never bind a slot the
 * payload dropped. A blank entry is a hole in the alignment, not a line.
 */
export interface ReferenceCaptionParams {
  referenceVideoCaptions?: string[]
  referenceAudioCaptions?: string[]
}

/**
 * Typed request body for `nodes.run("text-to-speech", …)` / `runAndWait`.
 * Common fields are typed; any other route field passes through.
 */
export interface TextToSpeechParams extends GenerationSessionParams {
  text: string
  /** A premade voice NAME (Rachel, George, …) or a library / custom voice id. */
  voice?: string
  voiceType?: "premade" | "custom" | "library"
  /** `elevenlabs-v4` (the default), `elevenlabs-v3`, `elevenlabs-v4-turbo`, `elevenlabs-turbo`, `elevenlabs-multilingual`. */
  provider?: string
  stability?: number
  similarityBoost?: number
  style?: number
  speed?: number
  languageCode?: string
  /**
   * Continuity across clips: the line spoken just BEFORE this one in the finished piece
   * (the previous clip's text). Context, not spoken — a model that stitches (v4, Turbo, Multilingual; not v3) carries the
   * intonation across the cut; others ignore it. Up to 1,000 characters (a 400 above, on a model that stitches).
   */
  previousText?: string
  /** The line spoken just AFTER this one. Same rule as `previousText`. */
  nextText?: string
  [k: string]: unknown
}

/**
 * Fields every job-creating request accepts beside its own params, on any
 * route: the platform stamps them on the job it creates. Typed on every
 * generation params type.
 */
export interface GenerationSessionParams {
  /** A session from `client.sessions.create()` — the job is born in it and
   *  shows in its feed. Must be one of yours (404 otherwise). */
  sessionId?: string
  /** Your app's slug (`create-image`, …): stored on the job, and what
   *  `jobs.list({ origin })` filters on. Lowercase letters, digits, dashes. */
  origin?: string
}

/**
 * Typed request body for `nodes.run("generate-image", …)` / `runAndWait`.
 * Common fields are typed; any other route field passes through via the index
 * signature (the route Zod-validates the full body).
 *
 * `count` above 1 or `models` makes several jobs in one call: the answer is a
 * {@link GenerateImageBatchResult}, and {@link NodesResource.runBatchAndWait}
 * (not `runAndWait`) waits for it.
 */
export interface GenerateImageParams extends StructuredReferenceParams, GenerationSessionParams {
  prompt?: string
  /**
   * Apply a node preset (a factory id like `"generate-image/cinematic-still"`, from
   * `presets.listFactory("generate-image")`, or one of yours) exactly as the editor does:
   * its prompt and pre/post text, placeholder defaults, style, negative prompt and
   * levers. Fields you pass override it; your `prompt` is wrapped in its pre/post text.
   */
  presetId?: string
  /** Values for the preset's placeholders that have no default, e.g. `{ BRAND: "Acme" }`.
   *  Without them such a preset answers 400 `preset_variables_required`, naming them. */
  presetVariables?: Record<string, string>
  /** The prompt as your user typed it, when `prompt` is a version your app
   *  expanded (filled-in fields, resolved references). Stored on the job as
   *  `input_data.userPrompt` to show what the user wrote; never sent to the
   *  model. Defaults to `prompt`. */
  userPrompt?: string
  /** Pre & post text wrapped around `prompt` (a preset's words), joined the
   *  same way every AI prompt node joins them. */
  promptPrefix?: string
  promptSuffix?: string
  provider?: string
  /** How many images to make, 1–4 — each its own job, one image each, under
   *  its own Idempotency-Key (`<key>:<i>`). With `models`, per model. */
  count?: number
  /** 2–4 distinct image model ids: the same request runs on each, instead of
   *  `provider`. models × count is at most 8. With `presetId`, the preset is
   *  applied once per model. */
  models?: string[]
  /** With `count`, image i gets `seed + i` — one seed would draw the same image every time. */
  seed?: number
  /** Flat reference image URLs — appended after `connectedReferences`. */
  referenceImageUrls?: string[]
  negativePrompt?: string
  /**
   * Cinematic direction as catalog IDS — the route renders the wording. Two
   * keys also take one of YOUR saved resources:
   * - `colorLook: "palette:<id>"` (`paletteDirectionId(id)`) — the palette's
   *   colours, each by an everyday name and its hex, go into the prompt;
   * - `style: "moodboard:<id>"` (`moodboardDirectionId(id)`) — the moodboard's
   *   description goes into the prompt and its images go to the model as style
   *   references, after your own references and up to the model's reference
   *   limit (the answer's `warnings` says when some did not fit). Its images
   *   are references, so on models priced per reference the run costs what is
   *   sent.
   * A malformed one answers 400; one that is not yours (or was deleted) 404
   * `direction_not_found`. The job keeps the id, so a re-run resolves it again.
   * Not combinable with `presetId` yet (400 `validation_error`).
   */
  direction?: DirectionFields
  /**
   * WHO is in the shot — person, styling and props as picker-catalog ids
   * ({@link Subject}). The platform writes the wording and folds it in after
   * `prompt`, ahead of `direction`. With `presetId`, it replaces the preset's own
   * and is folded into the preset's prompt (over-long values dropped, not 400).
   */
  subject?: Subject
  /**
   * The image to edit. Alone, the run is image-to-image on it (a text-to-image
   * model runs as its image-to-image sibling); with `maskUrl`, an inpaint.
   */
  baseImageUrl?: string
  /**
   * Inpaint mask — white = the area to change, black = keep (what
   * `generate-mask` writes). Needs a base: `baseImageUrl`, else the first
   * `referenceImageUrls` entry. Works on EVERY image model: the result's masked
   * area is composited back over the base, so everything outside the mask is
   * the base's own pixels. On the models whose `IMAGE_MASK_MODE` is `"prompt"`
   * (`@nodaro/shared`) the masked area's position is also described in the
   * prompt; the rest rely on the composite alone. (A model that takes the mask
   * itself is on `image-to-image` — `I2I_MASK_SUPPORT`.)
   */
  maskUrl?: string
  /** 0–1: how far the result may move from the base (taken by the models in `I2I_STRENGTH_SUPPORT`). */
  strength?: number
  /** 0–20: prompt adherence (taken by the models in `GUIDANCE_SCALE_SUPPORT`). */
  guidanceScale?: number
  [k: string]: unknown
}

/** One model's share of a generate-image batch. */
export interface GenerateImageBatchGroup {
  /** The model id as requested. */
  model: string
  jobIds: string[]
  /** Credits held for this model's images; absent where nothing is charged. */
  credits?: number
  /** Parameters corrected for this model, as on a single call. */
  adjustments?: RunNodeAdjustment[]
  /** Something asked for that was not sent on this model (e.g. a moodboard past its reference limit), as on a single call. */
  warnings?: RunNodeWarning[]
}

/**
 * What `nodes.run("generate-image", …)` answers when `count` is above 1 or
 * `models` is set: every job, grouped by model. The whole batch was checked
 * against the balance and created, charged and queued together — or not at
 * all (`InsufficientCreditsError`'s `required` is then the batch's total).
 */
export interface GenerateImageBatchResult {
  /** The first job — so code reading the single-image answer keeps working. */
  jobId: string
  /** Every job: model by model, then image by image. */
  jobIds: string[]
  /** On every job of the batch as `input_data.batchId`; `jobs.list({ batchId })` lists them. */
  batchId: string
  groups: GenerateImageBatchGroup[]
  /** The groups' credits summed; absent where nothing is charged. */
  totalCredits?: number
  /** Every job already existed and this request charged nothing: a repeat of an earlier request with the same Idempotency-Key. */
  deduped?: true
}

/**
 * One job of a batch once {@link NodesResource.runBatchAndWait} stops waiting
 * for it: its output, or the typed error that ended the wait — a
 * `JobFailedError` (failed or cancelled), `JobHeldError` (held for review) or
 * `JobTimeoutError`. One job's error never discards the others' images.
 */
export type BatchJobOutcome =
  | { readonly jobId: string; readonly model: string; readonly status: "completed"; readonly output: NodeJobOutput }
  | { readonly jobId: string; readonly model: string; readonly status: "error"; readonly error: NodaroError }

/** What {@link NodesResource.runBatchAndWait} resolves. */
export interface GenerateImageBatchOutput {
  /** The submit's answer: the ids, the groups, the credits. */
  readonly batch: GenerateImageBatchResult
  /** Every job, in `batch.jobIds` order. */
  readonly results: readonly BatchJobOutcome[]
}

/**
 * Typed request body for `nodes.run("generate-video", …)` / `runAndWait`.
 * Common fields are typed; any other route field passes through.
 */
export interface GenerateVideoParams extends StructuredReferenceParams, ReferenceCaptionParams, GenerationSessionParams {
  prompt?: string
  provider?: string
  /** Start-frame image (image-to-video). */
  imageUrl?: string
  /** Closing frame, paired with `imageUrl` on models that support one. */
  endFrameUrl?: string
  referenceImageUrls?: string[]
  referenceVideoUrls?: string[]
  referenceAudioUrls?: string[]
  /**
   * Identity inputs that keep a real person's face — a portrait + description
   * per person. Only models with a dedicated character channel take them; any
   * other model answers `400`. Distinct from `referenceImageUrls`, which a
   * multimodal model treats as loose context. Adds no credit charge.
   *
   * - Gemini Omni (`gemini-omni-video`, `gemini-omni-flash`): up to 3. Cannot be
   *   combined with a start frame (`imageUrl`); each character uses 1 of the
   *   model's 7 input units (2 with a `bodyImageUrl`). Give a character a
   *   `voice` to pin one voice persona (a Gemini preset + optional description /
   *   example line) across clips — up to 3 distinct voices a request.
   * - Kling 4.0 (`kling-4`): up to 7 named subjects, written in the prompt as
   *   `@Name`. A subject takes 2–4 images — the portrait, then `bodyImageUrl` /
   *   `extraImageUrls`; one with a single image is sent as a reference image.
   *   Counts toward the model's 15 materials. No `voice` (send a recorded
   *   voice as `referenceAudioUrls`).
   */
  characterReferences?: VideoCharacterReference[]
  /** Kling 4.0 (`kling-4`): keep the reference videos' own sound instead of
   *  generating new sound. Ignored without a reference video and by every
   *  other model. */
  keepOriginalSound?: boolean
  /** How a start/end frame is reshaped before the model sees it. Default
   *  `"resolution"`: resize it to the pixel size that model actually renders,
   *  which is what stops the provider reshaping it mid-clip. `"ratio"` corrects
   *  only the aspect; `"original"` sends it untouched. */
  frameFit?: "original" | "ratio" | "resolution"
  /** Whether the frame travels as a real start frame or as a reference image
   *  bound in the prompt as the opening frame. Default `"auto"`, which picks per
   *  model. Ignored by models that take no reference images. */
  frameDelivery?: "auto" | "frame" | "reference"
  /** Seedance Draft (`seedance-2-5` only; ignored elsewhere): render a 480p
   *  DRAFT — it costs the same as a 480p run and any `resolution` is replaced
   *  by 480p. Finalize the take you like with `nodes.run("video-upscale",
   *  { provider: "seedance-2-5-hd", sourceJobId })`: the same take, frame for
   *  frame, at 1080p. Drafts are kept about 7 days. */
  draft?: boolean
  [k: string]: unknown
}

/**
 * Typed request body for `nodes.run("text-to-video", …)` / `runAndWait` — the
 * PROMPT-ONLY video lane (`POST /v1/text-to-video`).
 *
 * Which lane takes what: `text-to-video` renders from text (plus optional
 * references) and `prompt` is REQUIRED; frames belong to `generate-video`
 * alone, which is the image-to-video lane (`imageUrl` start frame, `endFrameUrl`
 * closing frame) and where a prompt is optional. A model with no text-to-video
 * mode answers this lane with a `400 image_required` naming itself.
 *
 * Common fields are typed; any other route field passes through.
 */
export interface TextToVideoParams extends StructuredReferenceParams, ReferenceCaptionParams, GenerationSessionParams {
  prompt: string
  provider?: string
  duration?: number
  /** Native audio toggle, on the models that render sound. */
  sound?: boolean
  negativePrompt?: string
  aspectRatio?: string
  resolution?: string
  seed?: number
  referenceImageUrls?: string[]
  referenceVideoUrls?: string[]
  referenceAudioUrls?: string[]
  /** Identity inputs that keep a real person's face — see {@link GenerateVideoParams.characterReferences}. */
  characterReferences?: VideoCharacterReference[]
  /** Kling 4.0 (`kling-4`): keep the reference videos' own sound — see {@link GenerateVideoParams.keepOriginalSound}. */
  keepOriginalSound?: boolean
  /** Cinematic direction as catalog IDS — the route renders the wording. */
  direction?: DirectionFields
  /** WHO is in the shot as picker-catalog ids ({@link Subject}), folded ahead of the direction clauses. */
  subject?: Subject
  /** Seedance Draft (`seedance-2-5` only; ignored elsewhere): render a 480p
   *  DRAFT — it costs the same as a 480p run and any `resolution` is replaced
   *  by 480p. Finalize the take you like with `nodes.run("video-upscale",
   *  { provider: "seedance-2-5-hd", sourceJobId })`: the same take, frame for
   *  frame, at 1080p. Drafts are kept about 7 days. */
  draft?: boolean
  /** Absent / `true`: a copyright refusal is retried once with a reworded
   *  prompt. `false` = a copyright refusal fails the job instead of retrying
   *  once with a reworded prompt. */
  contentPolicyRewrite?: boolean
  [k: string]: unknown
}

/**
 * Typed request body for `nodes.run("video-upscale", …)` / `runAndWait`.
 *
 * - `topaz` (default): upscale any `videoUrl` by `upscaleFactor`.
 * - `veo-1080p` / `veo-4k`: re-render a VEO generation by its `taskId`.
 * - `seedance-2-5-hd`: finalize a Seedance 2.5 DRAFT (a `draft: true` run) —
 *   the same take re-rendered at 1080p at the draft's own length. Name the
 *   draft by `sourceJobId` (its job id) or `taskId` (its providerTaskId). The
 *   price comes from the draft (its length, and whether it used a reference
 *   video), never from this body. A foreign, unfinished or non-draft source is
 *   refused with a 4xx before anything is charged.
 *
 * Any other route field passes through.
 */
export interface VideoUpscaleParams extends GenerationSessionParams {
  provider?: "topaz" | "veo-1080p" | "veo-4k" | "seedance-2-5-hd"
  videoUrl?: string
  upscaleFactor?: "1" | "2" | "4"
  taskId?: string
  sourceJobId?: string
  [k: string]: unknown
}

/**
 * Typed request body for `nodes.run("assemble-narrated-video", …)` / `runAndWait`.
 * Assembles blocks of video with audio narration into a single composed video.
 */
export interface AssembleNarratedVideoParams extends GenerationSessionParams {
  blocks: { videoUrl: string; audioUrl?: string }[]
  voiceVolume?: number
  clipAudioVolume?: number
  maxSlowdown?: number
  trimStartFrames?: number
  trimEndFrames?: number
  [k: string]: unknown
}

/**
 * Typed request body for `nodes.run("video-depth", …)` / `runAndWait` — turns a
 * video into a depth video (`POST /v1/video-depth`, near is bright, far is
 * dark). The completed job writes `videoUrl` (MP4) and `thumbnailUrl`.
 *
 * Two providers: `video-depth-anything` (the default, temporally consistent)
 * honours every lever below; `depth-anything-frames` (Depth Anything per
 * frame) takes `modelSize` and `colormap` only, and renders only `grayscale` /
 * `inferno`. A lever the chosen provider does not take is dropped and a
 * colormap it cannot render becomes `grayscale` — coerced, never rejected (a
 * value outside the vocabularies below is still a `400 validation_error`).
 *
 * The clip is measured before any credits are reserved. Too long answers
 * `400 video_too_long` (`video-depth-anything`: more than 2,400 frames or
 * 300 s; `depth-anything-frames`: more than 80 s); a clip that cannot be read
 * answers `400 video_unreadable`; a provider the deployment has turned off
 * answers `403 model_not_available`.
 *
 * Common fields are typed; any other route field passes through.
 */
export interface VideoDepthParams extends GenerationSessionParams {
  /** The source video — a public http(s) URL. */
  videoUrl: string
  /** Default `video-depth-anything`. */
  provider?: VideoDepthProvider
  /** `small` / `base` / `large` (the default) — larger is more detailed and slower. */
  modelSize?: VideoDepthModelSize
  /** Default `grayscale`. `depth-anything-frames` renders only `grayscale` / `inferno`. */
  colormap?: VideoDepthColormap
  /** `video-depth-anything` only. Default `auto`. */
  resolution?: VideoDepthResolution
  /** `video-depth-anything` only: render the original and the depth next to each other. */
  sideBySide?: boolean
  [k: string]: unknown
}

/**
 * The `output_data` shape a finalized generation job writes. Every async
 * generation node persists one (or more) of these media URLs to
 * `jobs.output_data` on completion — `generate-image` → `imageUrl`,
 * `generate-video` / `combine-videos` / `merge-video-audio` / `video-upscale` /
 * `video-depth` → `videoUrl` (+ `thumbnailUrl`), `text-to-speech` / `generate-music` →
 * `audioUrl` (a `text-to-speech` run with `withTimestamps: true` on a model
 * that returns timings, and every `text-to-dialogue` run on one, also carries
 * `transcript`). Resolved by {@link NodesResource.runAndWait}. Extra fields may be
 * present, so the index signature is open.
 */
/**
 * The completed `social-search` job's `output_data`: EVERY post the search
 * found, in the order it asked for (Social Search, Nodaro Cloud). Picking the
 * posts a workflow passes on is an editor step; a direct caller gets them all.
 */
export interface SocialSearchJobOutput extends NodeJobOutput {
  readonly json: readonly SocialPost[]
  readonly platform: SocialPlatform
  readonly mode: SocialSearchMode
  readonly query: string
  /** Non-fatal notes ("only part of the results could be loaded"). */
  readonly warnings?: readonly string[]
}

export interface NodeJobOutput {
  /** `text-to-speech` / `generate-music` / audio nodes write here. For
   *  `audio-separation` this is the primary stem (vocals). */
  readonly audioUrl?: string
  /** `audio-separation` (Demucs) per-stem URLs. `vocalUrl`/`instrumentalUrl`
   *  in vocal/instrumental mode; the rest in full-stems mode. */
  readonly vocalUrl?: string
  readonly instrumentalUrl?: string
  readonly drumsUrl?: string
  readonly bassUrl?: string
  readonly otherUrl?: string
  readonly guitarUrl?: string
  readonly pianoUrl?: string
  /** `generate-video` / `combine-videos` / `merge-video-audio` / `video-upscale` / `video-depth` write here. */
  readonly videoUrl?: string
  /** `generate-image` / `edit-image` / `extract-frame` write here. */
  readonly imageUrl?: string
  /** Every image, when the job made more than one; `imageUrl` is the first. */
  readonly imageUrls?: readonly string[]
  /**
   * The output's pixel size. On an image job: the size of `imageUrl` as it is
   * stored — what you download, a free-tier watermark included — with EXIF
   * orientation applied, so the size a browser shows. Lay a grid tile out
   * before the image loads, or show and sort by size.
   *
   * Present on image jobs completed after this release (and on the jobs that
   * always recorded it: image overlay, video overlay, video mask, mask
   * composite). Absent when the size could not be read — never half a size.
   */
  readonly width?: number
  readonly height?: number
  /**
   * Beside `imageUrls`: each image with its pixel size, index-aligned
   * (`images[i]` is `imageUrls[i]`). Present on image jobs completed after
   * this release when at least one size was read; an entry whose size could
   * not be read has its `url` and no `width` / `height`.
   */
  readonly images?: readonly JobOutputImage[]
  /** Poster frame for video outputs. */
  readonly thumbnailUrl?: string
  readonly [k: string]: unknown
}

/** One image of a job that made several — see {@link NodeJobOutput.images}. */
export interface JobOutputImage {
  readonly url: string
  /** Pixel size as stored, EXIF orientation applied. Absent when it could not be read. */
  readonly width?: number
  readonly height?: number
}

/** Options for {@link NodesResource.runAndWait} and {@link NodesResource.runMany}. */
export interface RunAndWaitOptions {
  /**
   * Abort the run/poll loop. Aborting (or passing an already-aborted signal)
   * stops polling and rejects with {@link JobAbortedError}, whose `jobId`
   * names the job once it was submitted. Aborting stops the WAITING only: the
   * job keeps running and is charged, unless {@link cancelOnAbort} is set.
   */
  readonly signal?: AbortSignal
  /**
   * Also cancel the job when `signal` aborts after it was submitted
   * (`POST /v1/jobs/:id/cancel`, which refunds its credit hold — except a
   * metered LLM job whose call has started: it answers `inFlight: true`,
   * finishes, and is charged what it used). Best effort:
   * a failed cancel still rejects with the {@link JobAbortedError}. Default
   * `false` — aborting only stops waiting.
   */
  readonly cancelOnAbort?: boolean
  /** Called with each lean status the poll loop observes (running → terminal). */
  readonly onProgress?: (status: JobStatusResult) => void
  /** Poll interval in ms. Default 2000. */
  readonly pollMs?: number
  /** Wall-clock cap before giving up, in ms. Default ~15 min (900_000). */
  readonly maxMs?: number
  /**
   * `Idempotency-Key` for the submit half. Reuse the same value when retrying a
   * call that timed out, so the run is not started or charged twice. Omitted →
   * no key, which is the historical behaviour for every node that does not
   * require one.
   */
  readonly idempotencyKey?: string
}

/** Per-call transport controls for {@link NodesResource.run}. */
export interface RunNodeOptions {
  /** `Idempotency-Key` header. See {@link RunAndWaitOptions.idempotencyKey}. */
  readonly idempotencyKey?: string
}

/** One settled result from {@link NodesResource.runMany}. */
export interface RunManyResult {
  readonly jobId: string
  readonly output: NodeJobOutput
}

// Terminal statuses (poll loop stops on these) are handled explicitly in
// `pollJob`: `completed` resolves output_data, `failed`/`cancelled` throw a
// JobFailedError — matching studio's `completed | failed | cancelled` set.
const DEFAULT_POLL_MS = 2000
/** Safety cap so a stuck job can't poll forever (~15 min at 2s). */
const DEFAULT_MAX_MS = 15 * 60 * 1000

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new JobAbortedError())
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    function onAbort() {
      clearTimeout(timer)
      reject(new JobAbortedError())
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })

/** The error for a node type that cannot be run on its own. */
function notRunnable(type: string, why: string): NodaroError {
  return new NodaroError(`Node type "${type}" has no route of its own to run it directly: ${why}.`, "node_not_runnable", 0)
}

/** A 404 for the route itself (the server has no such path), not for a missing resource. */
const isRouteNotFound = (err: unknown): boolean => err instanceof NotFoundError && /^Route\b.*\bnot found\b/i.test(err.message)

/** Pull a `{ jobId }` off a run result, or throw a labelled JobFailedError. */
function extractJobId(result: RunNodeResult, label: string): string {
  if (result && typeof result === "object" && "jobId" in result) {
    const jobId = (result as { jobId: unknown }).jobId
    if (typeof jobId === "string") return jobId
  }
  // No jobId means the node ran inline/synchronously (meta-ads-scrape, etc.) or
  // the route shape changed — runAndWait is for async jobs, so this is an error.
  throw new JobFailedError(`${label} did not return a jobId`, "")
}

/** Whether a generate-image request makes several jobs: `count` above 1, or `models`. */
function isImageBatchRequest(type: string, params: Record<string, unknown>): boolean {
  if (type !== "generate-image") return false
  return (typeof params.count === "number" && params.count > 1) || Array.isArray(params.models)
}

/** The job ids of a batch answer (several jobs from one call), or null for a single job. */
function batchJobIds(result: RunNodeResult): string[] | null {
  const ids = (result as { jobIds?: unknown } | null)?.jobIds
  return Array.isArray(ids) && ids.every((id) => typeof id === "string") ? (ids as string[]) : null
}

/** A wait-for-one-job method asked to wait for a batch. */
function batchRefusal(detail: string): NodaroError {
  return new NodaroError(
    `${detail}: this waits for one job — use nodes.runBatchAndWait() for a batch (count above 1, or models).`,
    "batch_requires_run_batch_and_wait",
    0,
  )
}

/** The batch answer of a generate-image call, checked, or null. */
function batchResultOf(result: RunNodeResult): GenerateImageBatchResult | null {
  const r = result as Partial<GenerateImageBatchResult> | null
  if (!r || typeof r.batchId !== "string" || !batchJobIds(result) || !Array.isArray(r.groups)) return null
  return r as GenerateImageBatchResult
}

export class NodesResource {
  /** Runs poll through `jobs`, so the client must carry that resource too. */
  constructor(private client: NodaroClientCore & { readonly jobs: JobsResource }) {}

  /** List all known node descriptors. Server caches publicly for 5 minutes. */
  list(): Promise<{ data: NodeDescriptor[] }> {
    return this.client.request("GET", "/v1/nodes")
  }

  /** Get a single node descriptor by type slug (e.g. "generate-image"). */
  get(type: string): Promise<{ data: NodeDescriptor }> {
    return this.client.request("GET", `/v1/nodes/${encodeURIComponent(type)}`)
  }

  /**
   * Run a single node directly without wrapping it in a workflow. Posts
   * `params` as the request body to the node's API route. Most use
   * `POST /v1/<type>`; the rest are listed in `NODE_RUN_ROUTES` (exported by
   * `@nodaro/shared`): scene authoring uses `/v1/3d-scene/generate|edit`,
   * `llm-chat` uses `/v1/llm-chat/generate`, the Suno nodes `/v1/suno/…`, the
   * social post nodes `/v1/social/publish` (a per-platform node fills in its
   * `platform` when you leave it out), and render-video with a planType uses
   * `/v1/render-video/plan`.
   *
   * A node type with no route of its own (`NODE_TYPES_WITHOUT_RUN_ROUTE`, e.g.
   * `modify-image`, which runs through `image-to-image`) rejects with a
   * {@link NodaroError} of code `node_not_runnable` naming what to run
   * instead, without calling the API. A type that runs only inside a workflow
   * (an input, trigger, utility or parameter node such as `upload-image`)
   * rejects the same way once the API answers that it has no such route; a
   * 404 about a missing resource stays a `NotFoundError`.
   *
   * This is the SDK equivalent of the MCP server's verb tools — and the
   * path the Nodaro CLI uses for `nodaro nodes run <type>`.
   *
   * Most node types are async: the response includes `{ jobId }` and the
   * actual generation runs on a worker. Poll `client.jobs.get(jobId)` until
   * completed. Synchronous node types (`meta-ads-scrape`, etc.) return their
   * full result without a `jobId` field.
   *
   * @param type    Node type slug — must match an entry in the registry
   *                returned by `list()` (e.g. "generate-image").
   * @param params  Request body. Field names must match the node's
   *                `inputSchema` (see `get(type).inputSchema`).
   */
  run(type: "generate-3d-scene", params: GenerateScene3DParams): Promise<RunNodeResult>
  run(type: "edit-3d-scene", params: EditScene3DParams): Promise<RunNodeResult>
  run(type: "render-video", params: RenderScene3DParams): Promise<RunNodeResult>
  run(type: "pro-3d-render", params: Pro3DRenderRunParams, options?: RunNodeOptions): Promise<RunNodeResult>
  run(type: "generate-image", params: GenerateImageParams & ({ count: 2 | 3 | 4 } | { models: string[] }), options?: RunNodeOptions): Promise<GenerateImageBatchResult>
  run(type: "generate-image", params?: GenerateImageParams, options?: RunNodeOptions): Promise<RunNodeResult>
  run(type: "text-to-speech", params: TextToSpeechParams): Promise<RunNodeResult>
  run(type: "generate-video", params?: GenerateVideoParams, options?: RunNodeOptions): Promise<RunNodeResult>
  run(type: "text-to-video", params: TextToVideoParams, options?: RunNodeOptions): Promise<RunNodeResult>
  run(type: "video-to-video", params: VideoToVideoParams, options?: RunNodeOptions): Promise<RunNodeResult>
  run(type: "video-upscale", params: VideoUpscaleParams, options?: RunNodeOptions): Promise<RunNodeResult>
  run(type: "assemble-narrated-video", params?: AssembleNarratedVideoParams, options?: RunNodeOptions): Promise<RunNodeResult>
  run(type: "social-search", params: SocialSearchParams, options?: RunNodeOptions): Promise<RunNodeResult>
  run(type: "video-depth", params: VideoDepthParams, options?: RunNodeOptions): Promise<RunNodeResult>
  run(type: "image-to-image", params: ImageToImageParams, options?: RunNodeOptions): Promise<ImageJobStarted>
  run(type: "edit-image", params: EditImageParams, options?: RunNodeOptions): Promise<ImageJobStarted>
  run(type: "generate-mask", params: GenerateMaskParams, options?: RunNodeOptions): Promise<ImageJobStarted>
  /** Synchronous and free: answers the tiles, no job. */
  run(type: "split-image", params: SplitImageParams, options?: RunNodeOptions): Promise<SplitImageResult>
  run(type: string, params?: Record<string, unknown>, options?: RunNodeOptions): Promise<RunNodeResult>
  run(type: string, params: Record<string, unknown> = {}, options: RunNodeOptions = {}): Promise<RunNodeResult | GenerateImageBatchResult> {
    // The route comes from the table the platform's workflow engine uses
    // too; only render-video's plan route depends on the body.
    const route = type === "render-video" && typeof params.planType === "string" ? "/v1/render-video/plan" : nodeRunRoute(type)
    if (!route) return Promise.reject(notRunnable(type, NODE_TYPES_WITHOUT_RUN_ROUTE[type]!))
    // A per-platform social node publishes through the shared route, which
    // needs the platform the node type stands for.
    const platform = SOCIAL_POST_NODE_PLATFORM[type]
    const body = platform && params.platform === undefined ? { ...params, platform } : params
    // Only a type on the `/v1/<type>` convention is relabelled: a listed
    // route that 404s means a platform that predates it, not a node that
    // cannot run.
    const conventional = !Object.prototype.hasOwnProperty.call(NODE_RUN_ROUTES, type)
    return this.client
      .request<RunNodeResult>("POST", route, {
        body,
        // Transport-level retry safety, opt-in per call. The platform reads the
        // standard header, so a caller that reuses a key on a retry gets the
        // same run back instead of a second charge.
        ...(options.idempotencyKey ? { headers: { "Idempotency-Key": options.idempotencyKey } } : {}),
      })
      .catch((err: unknown) => {
        if (conventional && isRouteNotFound(err)) throw notRunnable(type, "it runs only inside a workflow (client.workflows.run)")
        throw err
      })
  }

  /**
   * The price of a run before it starts (`POST /v1/quote`). Send exactly the
   * body you would send to {@link run}: the platform prices it with the same
   * code the run route reserves with — validation, measuring reference clips,
   * the price id and the credit amount — but starts nothing and charges
   * nothing.
   *
   * `reserve` is what the run will hold when it starts; `expected`, when
   * present, is what it should actually cost (a Seedance edit renders the
   * source clip's length). A run settles to what was generated, never above
   * `reserve`. Rejects with the same `400` the run would answer for an
   * invalid body. Typed for the video lanes; any other node type takes its
   * run body as-is.
   *
   * @param type    Node type slug, as for {@link run}.
   * @param params  The run body.
   */
  quote(type: "text-to-video", params: TextToVideoParams): Promise<NodeQuote>
  quote(type: "generate-video", params: GenerateVideoParams): Promise<NodeQuote>
  quote(type: "video-to-video", params: VideoToVideoParams): Promise<NodeQuote>
  /** A Seedance 2.5 draft's 1080p finalize (`seedance-2-5-hd`) is priced from
   *  the draft itself, including the clips it was made with. */
  quote(type: "video-upscale", params: VideoUpscaleParams): Promise<NodeQuote>
  quote(type: string, params?: Record<string, unknown>): Promise<NodeQuote>
  async quote(type: string, params: Record<string, unknown> = {}): Promise<NodeQuote> {
    const res = await this.client.request<{ data: NodeQuote }>("POST", "/v1/quote", { body: { type, params } })
    return res.data
  }

  /**
   * Run a single async node to completion: {@link run} it, extract the
   * `{ jobId }`, then client-poll `jobs.getStatus(jobId)` every `pollMs`
   * (default 2000) until a terminal status, up to `maxMs` (default ~15 min).
   *
   * Resolves the job's typed `output_data` ({@link NodeJobOutput}) on
   * `completed`. Throws (all typed, catchable by `instanceof`):
   * - {@link InsufficientCreditsError} / {@link StorageExceededError} etc. —
   *   surfaced by the underlying {@link run} on 402/413/… before any poll.
   * - {@link JobFailedError} — terminal `failed`/`cancelled` (carries the
   *   job's `error_message` + `jobId`).
   * - {@link JobTimeoutError} — `maxMs` deadline exceeded before terminal.
   * - {@link JobAbortedError} — `signal` fired (or was already aborted);
   *   polling stops immediately.
   * - {@link JobHeldError} — the job entered `pending_review` on a deployment
   *   that registers a job policy. Ends the poll on the FIRST held tick (that
   *   status waits on a human, not on the job) and does NOT cancel it.
   * - {@link JobBlockedError} — a 422 from {@link run} before any poll: the
   *   deployment's job policy refused the request outright.
   *
   * Polling is fully client-side (no server function blocks) — the same model
   * thin clients use, lifted out of their hand-rolled run→poll loops.
   *
   * @param type    Node type slug (e.g. "generate-video"). See {@link run}.
   * @param params  Request body — field names match the node's `inputSchema`.
   * @param opts    `signal` / `onProgress` / `pollMs` / `maxMs`.
   */
  runAndWait(type: "generate-3d-scene", params: GenerateScene3DParams, options?: RunAndWaitOptions): Promise<Scene3DJobOutput>
  runAndWait(type: "edit-3d-scene", params: EditScene3DParams, options?: RunAndWaitOptions): Promise<Scene3DJobOutput>
  runAndWait(type: "render-video", params: RenderScene3DParams, options?: RunAndWaitOptions): Promise<NodeJobOutput>
  runAndWait(type: "pro-3d-render", params: Pro3DRenderRunParams, options?: RunAndWaitOptions): Promise<Pro3DRenderJobOutput>
  runAndWait(type: "generate-image", params?: GenerateImageParams, opts?: RunAndWaitOptions): Promise<NodeJobOutput>
  runAndWait(type: "text-to-speech", params: TextToSpeechParams, opts?: RunAndWaitOptions): Promise<NodeJobOutput>
  runAndWait(type: "generate-video", params?: GenerateVideoParams, opts?: RunAndWaitOptions): Promise<NodeJobOutput>
  runAndWait(type: "text-to-video", params: TextToVideoParams, opts?: RunAndWaitOptions): Promise<NodeJobOutput>
  runAndWait(type: "video-to-video", params: VideoToVideoParams, opts?: RunAndWaitOptions): Promise<NodeJobOutput>
  runAndWait(type: "video-upscale", params: VideoUpscaleParams, opts?: RunAndWaitOptions): Promise<NodeJobOutput>
  runAndWait(type: "assemble-narrated-video", params?: AssembleNarratedVideoParams, opts?: RunAndWaitOptions): Promise<NodeJobOutput>
  runAndWait(type: "social-search", params: SocialSearchParams, opts?: RunAndWaitOptions): Promise<SocialSearchJobOutput>
  runAndWait(type: "video-depth", params: VideoDepthParams, opts?: RunAndWaitOptions): Promise<NodeJobOutput>
  runAndWait(type: "image-to-image", params: ImageToImageParams, opts?: RunAndWaitOptions): Promise<NodeJobOutput>
  runAndWait(type: "edit-image", params: EditImageParams, opts?: RunAndWaitOptions): Promise<NodeJobOutput>
  runAndWait(type: "generate-mask", params: GenerateMaskParams, opts?: RunAndWaitOptions): Promise<GenerateMaskJobOutput>
  runAndWait<T extends string>(type: T, params?: Record<string, unknown>, opts?: RunAndWaitOptions): Promise<T extends "pro-3d-render" ? Pro3DRenderJobOutput : T extends "generate-3d-scene" | "edit-3d-scene" ? Scene3DJobOutput : T extends "generate-mask" ? GenerateMaskJobOutput : NodeJobOutput>
  async runAndWait(
    type: string,
    params: Record<string, unknown> = {},
    opts: RunAndWaitOptions = {},
  ): Promise<NodeJobOutput> {
    if (opts.signal?.aborted) throw new JobAbortedError()
    // A batch would be waited on as its first job alone — refused before
    // anything is submitted or charged.
    if (isImageBatchRequest(type, params)) throw batchRefusal(`${type} with count above 1 or models makes several jobs`)
    const result = await this.run(type, params, { idempotencyKey: opts.idempotencyKey })
    const ids = batchJobIds(result)
    if (ids && ids.length > 1) throw batchRefusal(`${type} started ${ids.length} jobs (${ids.join(", ")}), which keep running`)
    const jobId = extractJobId(result, type)
    return this.pollJob(jobId, type, opts)
  }

  /**
   * Run a generate-image BATCH — `count` above 1 and/or `models` — to the end:
   * submit it once ({@link run}, with your `idempotencyKey` if any), then wait
   * for every job at once, each the way {@link runAndWait} waits.
   *
   * Resolves `{ batch, results }`: the submit's answer
   * ({@link GenerateImageBatchResult} — ids, groups by model, credits) and one
   * {@link BatchJobOutcome} per job, in `batch.jobIds` order — its output, or the
   * typed error that ended the wait for it. One image failing never discards the
   * others. Rejects only before any job exists (the submit's own errors, e.g.
   * `InsufficientCreditsError` with the batch total as `required`), and on
   * `signal` ({@link JobAbortedError}; `cancelOnAbort` cancels every job).
   *
   * A request for one image is refused before anything is sent (code
   * `not_a_batch`) — wait for it with {@link runAndWait}.
   */
  async runBatchAndWait(
    type: "generate-image",
    params: GenerateImageParams,
    opts: RunAndWaitOptions = {},
  ): Promise<GenerateImageBatchOutput> {
    if (opts.signal?.aborted) throw new JobAbortedError()
    if (!isImageBatchRequest(type, params)) {
      throw new NodaroError(
        "runBatchAndWait waits for a batch — count above 1, or models; wait for one image with nodes.runAndWait().",
        "not_a_batch",
        0,
      )
    }
    const result = await this.run(type, params, { idempotencyKey: opts.idempotencyKey })
    const batch = batchResultOf(result)
    if (!batch) throw new JobFailedError(`${type} did not answer with a batch`, "")
    const modelOf = new Map(batch.groups.flatMap((group) => group.jobIds.map((id) => [id, group.model] as const)))
    const results = await Promise.all(
      batch.jobIds.map(async (jobId): Promise<BatchJobOutcome> => {
        const model = modelOf.get(jobId) ?? ""
        try {
          return { jobId, model, status: "completed", output: await this.pollJob(jobId, type, opts) }
        } catch (err) {
          if (err instanceof JobAbortedError || !(err instanceof NodaroError)) throw err
          return { jobId, model, status: "error", error: err }
        }
      }),
    )
    return { batch, results }
  }

  /**
   * Fan out N async runs of the same node `type` to completion concurrently —
   * the candidate-grid path (generate N stills/clips in parallel). Each runs
   * via {@link runAndWait}; resolves once ALL settle, to an array of
   * `{ jobId, output }` in input order. Rejects (and the rejection wins) if any
   * single run rejects — same typed errors as {@link runAndWait}, including
   * {@link JobHeldError} when one candidate is held for review while the
   * others complete. A shared `signal` aborts the whole batch.
   *
   * @param type        Node type slug, applied to every entry.
   * @param paramsList  One request body per candidate.
   * @param opts        Shared `signal` / `cancelOnAbort` / `onProgress` / `pollMs` / `maxMs`.
   */
  async runMany(
    type: string,
    paramsList: Record<string, unknown>[],
    opts: RunAndWaitOptions = {},
  ): Promise<RunManyResult[]> {
    if (opts.signal?.aborted) throw new JobAbortedError()
    // Each entry is waited on as one job: a batch entry is refused up front.
    if (paramsList.some((params) => isImageBatchRequest(type, params))) {
      throw batchRefusal(`a ${type} entry with count above 1 or models makes several jobs`)
    }
    return Promise.all(
      paramsList.map(async (params) => {
        if (opts.signal?.aborted) throw new JobAbortedError()
        const result = await this.run(type, params)
        const jobId = extractJobId(result, type)
        const output = await this.pollJob(jobId, type, opts)
        return { jobId, output }
      }),
    )
  }

  /** {@link pollUntilSettled}, plus what an abort does to the job: it keeps
   *  running unless `cancelOnAbort` asks to cancel it too, and the rejection
   *  always names it (an abort landing mid-sleep carries no id of its own). */
  private async pollJob(
    jobId: string,
    label: string,
    opts: RunAndWaitOptions,
  ): Promise<NodeJobOutput> {
    try {
      return await this.pollUntilSettled(jobId, label, opts)
    } catch (err) {
      if (!(err instanceof JobAbortedError)) throw err
      if (opts.cancelOnAbort) await this.client.jobs.cancel(jobId).catch(() => undefined)
      throw err.jobId ? err : new JobAbortedError(err.message, jobId)
    }
  }

  /** Poll an already-kicked job id until it stops moving; resolve output_data
   *  or throw. Two non-terminal statuses end the loop: an abort, and
   *  `pending_review` (a job policy held the output for a human — see
   *  {@link JobHeldError}). */
  private async pollUntilSettled(
    jobId: string,
    label: string,
    opts: RunAndWaitOptions,
  ): Promise<NodeJobOutput> {
    const pollMs = opts.pollMs ?? DEFAULT_POLL_MS
    const maxMs = opts.maxMs ?? DEFAULT_MAX_MS
    const deadline = Date.now() + maxMs
    for (;;) {
      if (opts.signal?.aborted) throw new JobAbortedError(undefined, jobId)
      const { data } = await this.client.jobs.getStatus(jobId)
      opts.onProgress?.(data)
      if (data.status === "completed") {
        return (data.output_data ?? {}) as NodeJobOutput
      }
      if (data.status === "failed" || data.status === "cancelled") {
        throw new JobFailedError(
          data.error_message ?? `${label} ${data.status}`,
          jobId,
          data.status,
        )
      }
      // `pending_review` is in-flight but PARKED ON A HUMAN — it does not
      // progress on its own, so continuing the loop would burn `maxMs` (15 min
      // by default) and then report a `JobTimeoutError` that misdescribes what
      // happened. End here instead, without cancelling: the output exists, the
      // reservation stays reserved, and a reviewer resolves it.
      if (data.status === "pending_review") {
        throw new JobHeldError(`${label} is awaiting review`, jobId)
      }
      if (Date.now() > deadline) {
        throw new JobTimeoutError(`${label} timed out`, jobId, maxMs)
      }
      await sleep(pollMs, opts.signal)
    }
  }
}
