import type { GenerateScene3DParams, EditScene3DParams, RenderScene3DParams, Scene3DJobOutput, Pro3DRenderRunParams, Pro3DRenderJobOutput } from "./scene3d-types.js"
import type { NodaroClient } from "../client.js"
import type { JobStatusResult } from "./jobs.js"
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

export type RunNodeResult =
  | { jobId: string; usageLogId?: string; adjustments?: RunNodeAdjustment[]; [k: string]: unknown }
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
export interface TextToSpeechParams {
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
 * Typed request body for `nodes.run("generate-image", …)` / `runAndWait`.
 * Common fields are typed; any other route field passes through via the index
 * signature (the route Zod-validates the full body).
 */
export interface GenerateImageParams extends StructuredReferenceParams {
  prompt?: string
  provider?: string
  /** Flat reference image URLs — appended after `connectedReferences`. */
  referenceImageUrls?: string[]
  negativePrompt?: string
  [k: string]: unknown
}

/**
 * Typed request body for `nodes.run("generate-video", …)` / `runAndWait`.
 * Common fields are typed; any other route field passes through.
 */
export interface GenerateVideoParams extends StructuredReferenceParams, ReferenceCaptionParams {
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
   * per person, up to 3. Only models with a dedicated character channel take
   * them (Gemini Omni: `gemini-omni-video`, `gemini-omni-flash`); any other
   * model answers `400`. Distinct from `referenceImageUrls`, which a multimodal
   * model treats as loose context. Cannot be combined with a start frame
   * (`imageUrl`); each character uses 1 of the model's 7 input units (2 with a
   * `bodyImageUrl`). Adds no credit charge. Give a character a `voice` to pin one
   * voice persona (a Gemini preset + optional description / example line) across
   * clips — up to 3 distinct voices a request.
   */
  characterReferences?: VideoCharacterReference[]
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
export interface TextToVideoParams extends StructuredReferenceParams, ReferenceCaptionParams {
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
  /** Cinematic direction as catalog IDS — the route renders the wording. */
  direction?: DirectionFields
  /** SUBJECT ids (who is in the shot), folded ahead of the direction clauses. */
  subject?: SubjectFields
  /** Seedance Draft (`seedance-2-5` only; ignored elsewhere): render a 480p
   *  DRAFT — it costs the same as a 480p run and any `resolution` is replaced
   *  by 480p. Finalize the take you like with `nodes.run("video-upscale",
   *  { provider: "seedance-2-5-hd", sourceJobId })`: the same take, frame for
   *  frame, at 1080p. Drafts are kept about 7 days. */
  draft?: boolean
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
export interface VideoUpscaleParams {
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
export interface AssembleNarratedVideoParams {
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
export interface VideoDepthParams {
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
  /** Poster frame for video outputs. */
  readonly thumbnailUrl?: string
  readonly [k: string]: unknown
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
   * (`POST /v1/jobs/:id/cancel`, which refunds its credit hold). Best effort:
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

export class NodesResource {
  constructor(private client: NodaroClient) {}

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
  run(type: "generate-image", params?: GenerateImageParams): Promise<RunNodeResult>
  run(type: "text-to-speech", params: TextToSpeechParams): Promise<RunNodeResult>
  run(type: "generate-video", params?: GenerateVideoParams): Promise<RunNodeResult>
  run(type: "text-to-video", params: TextToVideoParams): Promise<RunNodeResult>
  run(type: "video-upscale", params: VideoUpscaleParams): Promise<RunNodeResult>
  run(type: "assemble-narrated-video", params?: AssembleNarratedVideoParams): Promise<RunNodeResult>
  run(type: "social-search", params: SocialSearchParams, options?: RunNodeOptions): Promise<RunNodeResult>
  run(type: "video-depth", params: VideoDepthParams, options?: RunNodeOptions): Promise<RunNodeResult>
  run(type: string, params?: Record<string, unknown>, options?: RunNodeOptions): Promise<RunNodeResult>
  run(type: string, params: Record<string, unknown> = {}, options: RunNodeOptions = {}): Promise<RunNodeResult> {
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
  runAndWait(type: "video-upscale", params: VideoUpscaleParams, opts?: RunAndWaitOptions): Promise<NodeJobOutput>
  runAndWait(type: "assemble-narrated-video", params?: AssembleNarratedVideoParams, opts?: RunAndWaitOptions): Promise<NodeJobOutput>
  runAndWait(type: "social-search", params: SocialSearchParams, opts?: RunAndWaitOptions): Promise<SocialSearchJobOutput>
  runAndWait(type: "video-depth", params: VideoDepthParams, opts?: RunAndWaitOptions): Promise<NodeJobOutput>
  runAndWait<T extends string>(type: T, params?: Record<string, unknown>, opts?: RunAndWaitOptions): Promise<T extends "pro-3d-render" ? Pro3DRenderJobOutput : T extends "generate-3d-scene" | "edit-3d-scene" ? Scene3DJobOutput : NodeJobOutput>
  async runAndWait(
    type: string,
    params: Record<string, unknown> = {},
    opts: RunAndWaitOptions = {},
  ): Promise<NodeJobOutput> {
    if (opts.signal?.aborted) throw new JobAbortedError()
    const result = await this.run(type, params, { idempotencyKey: opts.idempotencyKey })
    const jobId = extractJobId(result, type)
    return this.pollJob(jobId, type, opts)
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
