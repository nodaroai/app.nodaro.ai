import type { NodaroClientCore } from "../core.js"
import { readSseStream } from "../sse.js"
import type { OverlayAnchor, VideoMaskRequest, MaskCompositeRequest } from "@nodaro/shared/media"
import type { CaptionStyle, CaptionLookId, SupportedFontName } from "@nodaro/shared/captions"
import type { CaptionTranscribeLane } from "@nodaro/shared/models"
import type { VideoOverlayRequest } from "@nodaro/shared/video"
import type { GenerationSessionParams, RunNodeOptions } from "./nodes.js"

/** One word-timed caption entry (one per WORD for the kinetic styles). */
export interface CaptionEntry {
  text: string
  startMs: number
  endMs: number
  timestampMs?: number | null
  confidence?: number | null
}

/** Look + motion levers — see {@link MediaResource.addCaptions}. `look` is a
 *  named preset the explicit levers override; an unset look renders as `outline`
 *  (the default). The STYLING levers (`look`, `fontFamily`, `fontWeight`,
 *  `strokeColor`/`strokeWidth`, `uppercase`, `positionY`, `maxWordsPerLine`) now
 *  apply to the static `subtitle` style too — a subtitle carrying any of them
 *  renders via Remotion. Only `highlightColor` (no spoken-word cursor to colour)
 *  and `animate` (no motion to freeze) stay kinetic-only and are rejected (400)
 *  on `subtitle`. */
export interface CaptionLookInput {
  look?: CaptionLookId
  fontFamily?: SupportedFontName
  fontWeight?: number
  strokeColor?: string
  strokeWidth?: number
  highlightColor?: string
  uppercase?: boolean
  positionY?: number
  /** Cap on how many words one caption LINE (or `tiktok-words` page) may hold,
   *  1-20, on TOP of the frame-width budget, sentence ends and pauses that
   *  already close a line — 1-2 gives the punchy CapCut read, unset fits the
   *  width. Applies to `word-highlight` / `karaoke` / `bouncy` / `tiktok-words`
   *  and to a Remotion-rendered `subtitle`; inert on `word-pop` (always one
   *  word). */
  maxWordsPerLine?: number
  /** Kinetic styles only. `false` freezes the per-word MOTION — the grouping,
   *  line-holding and spoken-word highlight stay, only the movement stops;
   *  default `true`. Rejected (400) on the static `subtitle` style. */
  animate?: boolean
}

/** One caption SEGMENT: a time range with optional style/look overrides and its
 *  own words (`text`/`captions`, else the shared transcript filtered to range).
 *  A segmented render is entirely Remotion, so any `style` is valid here. */
export interface CaptionSegmentInput extends CaptionLookInput {
  startMs: number
  endMs: number
  style?: CaptionStyle
  position?: "bottom" | "top" | "center"
  fontSize?: number
  color?: string
  backgroundColor?: string
  text?: string
  captions?: CaptionEntry[]
}

/** {@link MediaResource.addCaptions} input. */
export interface AddCaptionsInput extends CaptionLookInput {
  videoUrl: string
  text?: string
  captions?: CaptionEntry[]
  /** Transcribe the video's audio when no text/captions are given (default true). */
  autoTranscribe?: boolean
  /**
   * The engine the render transcribes on — Add Captions' own lanes. On
   * `nemotron-3-5-transcribe` the run is one charge, the render plus the video's
   * started minutes: the video (an https link, up to 60 minutes) is measured
   * before anything is held, and the run is charged for the length the model
   * decoded.
   */
  transcribeProvider?: CaptionTranscribeLane
  style?: CaptionStyle
  position?: "bottom" | "top" | "center"
  fontSize?: number
  color?: string
  backgroundColor?: string
  /** Apply different treatments to time ranges in one call (non-overlapping). */
  segments?: CaptionSegmentInput[]
}

/**
 * Media ingestion + trimming — the source-preparation steps a Voice Changer Pro
 * flow (or any pipeline) needs before it has a clip to work on: pull a social
 * video into storage, copy a remote URL into storage, trim a video/audio to a
 * range, and probe a video's metadata. Each generation-style op returns a job id
 * to poll (`jobs.get(jobId)`); `videoMetadata` is a direct read.
 */
/**
 * Where one overlay layer should go, in {@link MediaResource.imageOverlay}'s
 * percent units — the answer from {@link MediaResource.suggestOverlayPlacement}.
 */
export interface OverlayPlacement {
  /** The point on the base image the layer attaches to. */
  anchor: OverlayAnchor
  /** Offset from the anchor in % of the base width (negative on a right anchor = inward). */
  x: number
  /** Offset from the anchor in % of the base height (negative on a bottom anchor = inward). */
  y: number
  /** The layer's width in % of the base width. */
  width: number
  /** One sentence, plain language, on why this spot. */
  reason: string
}

export class MediaResource {
  constructor(private client: NodaroClientCore) {}

  /**
   * Download the video behind a link (the video's page, or a direct video file
   * link) into your storage (`POST /v1/download-video`). `maxHeight` caps the resolution
   * (default "best"); `sectionStartSec` + `sectionEndSec` (both-or-neither) fetch
   * ONLY that time range instead of the whole video. A download that arrives
   * with no audio stream FAILS by default (it is usually a degraded source
   * response, and is retried through other routes first); pass
   * `requireAudio: false` to accept a clip that really has no sound. Returns a
   * `downloadId`; progress streams from
   * `GET /v1/download-video/progress/:downloadId` (server-sent events) and the
   * finished file lands in your library. A section is fetched with ±3 s of
   * padding for the caller to trim; `exactSection: true` cuts it exactly at
   * `sectionStartSec`–`sectionEndSec` instead. `confirmationId` is the content
   * rights confirmation the import is made under (`contentRights.confirm`):
   * checked and consumed before the download starts, written on the stored
   * file; a download without one is refused (`403 rights_confirmation_required`)
   * once the deployment requires it, so a client always sends one.
   */
  downloadVideo(input: {
    url: string
    maxHeight?: number
    sectionStartSec?: number
    sectionEndSec?: number
    exactSection?: boolean
    requireAudio?: boolean
    confirmationId?: string
  }): Promise<{ downloadId: string }> {
    return this.client.request<{ downloadId: string }>("POST", "/v1/download-video", { body: input })
  }

  /**
   * Stream the live progress of a {@link MediaResource.downloadVideo} import
   * (`GET /v1/download-video/progress/:downloadId`, server-sent events) as an
   * async iterable. Yields a {@link DownloadVideoProgress} roughly every 500ms
   * until the download reaches `completed` (its event carries the stored
   * `videoUrl`) or `failed` (its event carries `error`), then ends. The progress
   * state expires server-side shortly after the download starts existing, so
   * start iterating promptly after `downloadVideo` returns.
   *
   * No request timeout is applied (a large import legitimately takes minutes) —
   * pass an `AbortSignal` to cancel from the caller.
   */
  async *downloadVideoProgress(
    downloadId: string,
    opts: { signal?: AbortSignal } = {},
  ): AsyncGenerator<DownloadVideoProgress, void, undefined> {
    const url = `${this.client.baseUrl}/v1/download-video/progress/${encodeURIComponent(downloadId)}`
    const token = await this.client.auth.getToken()
    const res = await this.client.fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: opts.signal,
    })
    // The shared reader owns the non-OK throw, the empty-body guard, the frame
    // parse and the cancel-on-early-exit — this route emits the same
    // `data: <json>` frames every other stream here does.
    yield* readSseStream<DownloadVideoProgress>(res, { label: "progress stream" })
  }

  /**
   * Copy an external media URL into your Nodaro storage (`POST /v1/save-to-storage`)
   * — a server-side fetch, so nothing round-trips through the client. Poll
   * `jobs.get(jobId)`.
   */
  saveToStorage(input: { mediaUrl: string; filename?: string; mediaType?: "image" | "video" | "audio" }): Promise<{ jobId: string }> {
    return this.client.request<{ jobId: string }>("POST", "/v1/save-to-storage", { body: input })
  }

  /**
   * Composite 2–30 images into ONE large 2K/4K collage (`POST /v1/image-collage`).
   * `layout` `"smart"` (default — justified rows at each image's exact aspect
   * ratio, no cropping; the output height floats) or `"grid"` (uniform,
   * letterboxed cells). `imageSizes` is index-aligned with `imageUrls` and
   * gives per-image RELATIVE size hints for the smart layout: `0` auto
   * ("don't care", default), `1` big (~2× linear vs medium), `2` medium,
   * `3` small (~½ linear). All-equal hints change nothing; grid ignores them.
   * For storyboards, set `numbered` to stamp a 1-based sequence badge at each
   * image's corner (top-left by default; `badgePosition: "top-right"` moves it;
   * in `imageUrls` order) and pass `imageLabels`
   * (index-aligned with `imageUrls`; `null`/`""`/omitted = no caption for that
   * image) to caption images after the number, e.g. `3 · Close-up`. Badges are
   * an overlay only — they never change the layout, the output size or the
   * credit cost. Poll `jobs.get(jobId)` for the finished image.
   */
  imageCollage(input: {
    imageUrls: string[]
    imageSizes?: Array<0 | 1 | 2 | 3>
    numbered?: boolean
    imageLabels?: Array<string | null>
    /** Corner the badges sit in — `"top-left"` (default, storyboard convention) or `"top-right"`. */
    badgePosition?: "top-left" | "top-right"
    layout?: "smart" | "grid"
    resolution?: "2K" | "4K"
    aspectRatio?: string
    gap?: number
    backgroundColor?: string
  }): Promise<{ jobId: string }> {
    return this.client.request<{ jobId: string }>("POST", "/v1/image-collage", { body: input })
  }

  /**
   * Place 1–12 layers — pictures, real text, QR codes, shapes — on a base image,
   * pixel-exactly (`POST /v1/image-overlay`) — local, deterministic, no AI.
   * Every layer position/size is a PERCENT of the base image: `anchor` (nine
   * positions, default `"center"`), `x`/`y` (offset from the anchor in % of
   * the base width/height; negative on a right/bottom anchor moves inward),
   * `width` (% of the base width, default 25 — height follows the layer's
   * aspect unless `height` is set). Plus `opacity` (0..1), `rotation`
   * (degrees), `blend` (`"over"` | `"multiply"` | `"screen"`), `fit`,
   * `shadow` and `roundedCorners`. The output keeps the base's pixel size
   * unless `canvas` is set. Flat credit cost. Poll `jobs.get(jobId)` for the
   * finished image.
   */
  imageOverlay(input: {
    imageUrl: string
    layers: Array<{
      imageUrl: string
      anchor?: OverlayAnchor
      x?: number
      y?: number
      width?: number
      height?: number
      opacity?: number
      rotation?: number
      blend?: "over" | "multiply" | "screen"
      fit?: "contain" | "cover" | "stretch"
      shadow?: { blur: number; offsetX: number; offsetY: number; color: string; opacity: number }
      roundedCorners?: number
      zIndex?: number
      /** "image" (default, needs imageUrl) | "text" | "qr" | "shape" — see @nodaro/shared image-overlay-layers. */
      kind?: "image" | "text" | "qr" | "shape"
      text?: Record<string, unknown>
      qr?: Record<string, unknown>
      shape?: Record<string, unknown>
      effects?: Record<string, unknown>
    }>
    canvas?: { width: number; height: number; backgroundColor?: string }
    baseFit?: "contain" | "cover"
    outputFormat?: "png" | "jpg" | "webp"
    /** Extra platform renders (see OVERLAY_PLATFORMS in @nodaro/shared); returned as output `variants[]`. */
    variants?: string[]
    /** The mask the job also emits as output `maskUrl` (white = may change). Default "around". */
    maskMode?: "none" | "layers" | "around" | "outside"
    maskSpread?: number
    /** Fills every QR layer whose `qr.fromInput` is true — the node's QR link handle. */
    qrText?: string
  }): Promise<{ jobId: string }> {
    // The finished job's output: { imageUrl, width, height, maskUrl?, variants?: [{ id, label, width, height, url }] }.
    return this.client.request<{ jobId: string }>("POST", "/v1/image-overlay", { body: input })
  }

  /**
   * Ask a vision model WHERE one overlay layer should sit on a base image
   * (`POST /v1/image-overlay/suggest-placement`) — it reads the picture and
   * keeps the element off the faces, the subject and the busiest texture.
   * The answer comes back in {@link MediaResource.imageOverlay}'s own percent
   * units — `anchor`, `x`/`y` offsets, `width` — so it drops straight onto a
   * layer (`const { reason, ...box } = placement`), plus a one-sentence
   * `reason` you can show a user. Nothing is composited here: apply the
   * placement yourself.
   *
   * `layerAspect` is the element's width / height (1 = square, the default) so
   * the proposed box stays in proportion; `intent` says what the element is
   * ("a logo", "a price badge"); `safeArea` is the always-visible region as
   * fractions of the canvas (a platform preset's safe area), which the
   * placement is kept inside. Unlike the other media calls this one answers
   * synchronously — there is nothing to poll; `jobId` is the billing record
   * (one image-to-text call).
   */
  suggestOverlayPlacement(input: {
    imageUrl: string
    layerAspect?: number
    intent?: string
    safeArea?: { x: number; y: number; w: number; h: number }
    llmModel?: string
  }): Promise<{ jobId: string; placement: OverlayPlacement }> {
    return this.client.request<{ jobId: string; placement: OverlayPlacement }>(
      "POST",
      "/v1/image-overlay/suggest-placement",
      { body: input },
    )
  }

  /**
   * Trim a video to a range (`POST /v1/trim-video`). Give the range in whichever
   * unit fits: `startTime`/`endTime` seconds, `trim*Frames`, `trim*Seconds`, or
   * `keepFirst`/`keepLastSeconds`. Poll `jobs.get(jobId)`.
   */
  trimVideo(input: {
    videoUrl: string
    startTime?: number
    endTime?: number
    trimStartFrames?: number
    trimEndFrames?: number
    trimStartSeconds?: number
    trimEndSeconds?: number
    keepFirstSeconds?: number
    keepLastSeconds?: number
  }): Promise<{ jobId: string }> {
    return this.client.request<{ jobId: string }>("POST", "/v1/trim-video", { body: input })
  }

  /**
   * Burn captions into a video (`POST /v1/add-captions`). Give the words as
   * `text`, word-timed `captions[]`, or let it transcribe (`autoTranscribe`,
   * the default when neither is set).
   *
   * `style: "subtitle"` renders statically (FFmpeg) UNLESS it carries a styling
   * lever, in which case it — like the KINETIC styles (`word-highlight` /
   * `karaoke` / `tiktok-words` / `word-pop` / `bouncy`) — renders via Remotion.
   * `look` picks a preset — `outline` (Montserrat 900, UPPERCASE, black outline,
   * yellow spoken word — the TikTok/Reels read) or `clean`; an UNSET look renders
   * as `outline`. The explicit STYLING levers (`fontFamily`, `fontWeight`,
   * `strokeColor`/`strokeWidth`, `uppercase`, `positionY`, `maxWordsPerLine`)
   * override individual fields of it and now apply to `subtitle` too. Only
   * `highlightColor` (the spoken-word cursor) and `animate` stay kinetic-only
   * and are REJECTED on `subtitle`.
   *
   * `animate` (default true) freezes the per-word MOTION on the kinetic styles
   * when set to false — the grouping, line-holding and spoken-word highlight
   * stay; only the movement stops.
   *
   * `maxWordsPerLine` (1-20) caps how many words a line — or a `tiktok-words`
   * page — may hold, on top of the width budget / sentence ends / pauses that
   * already close one; it is inert on `word-pop`, which is always one word.
   * Like every lever here it exists top-level AND per segment, and a segment
   * that does not name its own inherits the top-level value.
   *
   * `segments[]` applies DIFFERENT treatments to non-overlapping time ranges in
   * one call (e.g. a large top intro, then a small bottom body); a segment that
   * names its own `look` starts fresh from that preset and does not inherit the
   * top-level explicit levers. Poll `jobs.get(jobId)`.
   *
   * `word-highlight` shows ONE held line at a time and a word's
   * `startMs`/`endMs` is its SPOKEN window (what times the highlight, not how
   * long the text is on screen) — so `captions[]` can be handed over verbatim
   * from an `audio.transcribe()` job's `output_data.words`, with
   * `autoTranscribe: false`.
   */
  addCaptions(input: AddCaptionsInput): Promise<{ jobId: string }> {
    const { autoTranscribe, transcribeProvider, ...rest } = input
    // The route body is camelCase except these two flags (worker snake_case);
    // omit each when unset so an absent flag stays absent on the wire.
    const body: Record<string, unknown> = {
      ...rest,
      ...(autoTranscribe !== undefined ? { auto_transcribe: autoTranscribe } : {}),
      ...(transcribeProvider !== undefined ? { transcribe_provider: transcribeProvider } : {}),
    }
    return this.client.request<{ jobId: string }>("POST", "/v1/add-captions", { body })
  }

  /**
   * Trim (and extract) audio from a video or audio source
   * (`POST /v1/trim-audio`) to `[startTime, endTime]` seconds, in `audioFormat`
   * (`mp3` default / `wav` / `aac`). Poll `jobs.get(jobId)`.
   */
  trimAudio(input: {
    videoUrl?: string
    audioUrl?: string
    audioFormat?: "mp3" | "wav" | "aac"
    startTime?: number
    endTime?: number
  }): Promise<{ jobId: string }> {
    return this.client.request<{ jobId: string }>("POST", "/v1/trim-audio", { body: input })
  }

  /**
   * Cut a video and/or an audio file into consecutive parts
   * (`POST /v1/split-media`). Every part is at most `chunkDuration` seconds and
   * at least `minPartDuration` (default 4, never above `chunkDuration`) — a
   * short leftover is evened out with the parts before it. Video is cut on
   * whole frames with each part's sound matching its picture; audio parts are
   * sample-exact, in `audioFormat` (`mp3` default / `wav` / `aac`). With both
   * sources each is split on its own. At most 200 parts per input. With
   * `mode: "shots"` a video is instead cut into one part per shot, at the cuts
   * measured from the file (no part length; a video only, up to 30 minutes and
   * 200 shots; each part keeps the video's own sound). Poll `jobs.get(jobId)`;
   * the parts are on the completed job's `output_data` — see
   * {@link SplitMediaOutput}.
   */
  splitMedia(input: SplitMediaInput): Promise<{ jobId: string }> {
    return this.client.request<{ jobId: string }>("POST", "/v1/split-media", { body: input })
  }

  /**
   * Where every shot of a video starts and ends (`POST /v1/shot-cuts`),
   * measured from the file: every decoded frame is scored and each hard cut
   * starts a new shot (dissolves and fades are not cuts). Videos up to 30
   * minutes. `frames: true` also saves each shot's exact first and last frame
   * as PNG images (up to 1,000 shots; same price). Poll `jobs.get(jobId)`; the
   * completed job's `output_data.json` is a {@link ShotCutsResult} — see
   * {@link ShotCutsOutput}.
   */
  shotCuts(input: ShotCutsInput): Promise<{ jobId: string }> {
    return this.client.request<{ jobId: string }>("POST", "/v1/shot-cuts", { body: input })
  }

  /**
   * Split one image into a base picture and separate layers
   * (`POST /v1/split-into-layers`): each element on its own transparent PNG,
   * with its name, description, stacking order and the box it sits in on the
   * base. `maxLayers` (1–99, default 9) caps the layers — more elements than
   * that merge into fewer layers, none is dropped; `size` is each image's
   * pixel budget (`1K` default, `auto` keeps the picture's own size between 1K
   * and 2K); `prompt` names what to separate. A run holds the price of the
   * most images it may return (`maxLayers` + 1, the base included) and is
   * charged only for the images it returns: ask that price first with
   * `client.nodes.quote("split-into-layers", input)` (nothing is started).
   * Poll `jobs.get(jobId)`; the completed job's `output_data` is a
   * {@link SplitIntoLayersOutput}. `sessionId` files the job in one of your
   * sessions; `origin` tags it with your app's slug.
   *
   * With `options.idempotencyKey` (sent as the `Idempotency-Key` header, at
   * least 8 characters) a retry of the same request answers the job it
   * already started (`deduped: true`) instead of starting and charging a
   * second one.
   */
  splitIntoLayers(input: SplitIntoLayersInput, options: MediaRunOptions = {}): Promise<MediaJobStarted> {
    return this.client.request<MediaJobStarted>("POST", "/v1/split-into-layers", {
      body: input,
      ...(options.idempotencyKey ? { headers: { "Idempotency-Key": options.idempotencyKey } } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    })
  }

  /**
   * Turn one still image + one audio track into an MP4
   * (`POST /v1/still-to-video`) — locally rendered (FFmpeg), no AI model,
   * zero credits. The output duration IS the audio's duration; there is no
   * duration field. Optional `motion` animates the still (zoom / pan /
   * ken-burns) at `intensity` 1–10. `fit: "contain"` letterboxes with
   * `padColor` instead of cropping. Poll `jobs.get(jobId)`.
   */
  stillToVideo(input: {
    imageUrl: string
    audioUrl: string
    motion?: "none" | "zoom-in" | "zoom-out" | "pan-left" | "pan-right" | "ken-burns"
    intensity?: number
    resolution?: "720p" | "1080p" | "4K"
    aspectRatio?: "16:9" | "9:16" | "1:1" | "4:3"
    fps?: 24 | 30
    fit?: "cover" | "contain"
    padColor?: string
  }): Promise<{ jobId: string }> {
    return this.client.request<{ jobId: string }>("POST", "/v1/still-to-video", { body: input })
  }

  /**
   * Turn 2–100 images + one optional audio track into an MP4 slideshow
   * (`POST /v1/slideshow`) — locally rendered (FFmpeg), zero credits. With
   * audio, the output duration IS the audio's duration (equal split unless
   * `imageDurations` pins rows — null entries = auto; mismatched pinned sums
   * scale proportionally and the factor is disclosed in the job output).
   * Without audio: N × `perImageDuration`, silent output. Transitions
   * consume the outgoing slide, so totals stay exact. For a single image use
   * `stillToVideo`. Poll `jobs.get(jobId)`.
   */
  slideshow(input: {
    imageUrls: string[]
    audioUrl?: string
    imageDurations?: Array<number | null>
    perImageDuration?: number
    transition?: string
    transitionDuration?: number
    motion?: "none" | "zoom-in" | "zoom-out" | "ken-burns" | "alternate"
    intensity?: number
    resolution?: "720p" | "1080p" | "4K"
    aspectRatio?: "16:9" | "9:16" | "1:1" | "4:3"
    fps?: 24 | 30
    fit?: "cover" | "contain"
    padColor?: string
  }): Promise<{ jobId: string }> {
    return this.client.request<{ jobId: string }>("POST", "/v1/slideshow", { body: input })
  }

  /**
   * Place 1–20 timed image or video layers over a video
   * (`POST /v1/video-overlay`) — rendered locally (FFmpeg) in one pass, no AI.
   * Each layer has exactly one source, `imageUrl` or `videoUrl` (at most 2
   * video layers), a `start` and an optional `end` in seconds (no `end` = to
   * the end of the video) and a placement: a `preset` (`"card"`,
   * `"corner-badge"` with a `corner`, `"full-frame"`) or an explicit box in
   * {@link MediaResource.imageOverlay}'s percent vocabulary (`anchor`, `x`,
   * `y`, `width`, `height`, `fit`) — an explicit box field overrides the
   * preset, and a layer with neither is a corner badge (bottom-right, or the
   * `corner` it names). `animate` (a short fade in and out) defaults on for an
   * image and off for a video.
   *
   * A video layer plays from its first frame at its `start`, stops at its
   * `end` (or the base's end) and holds its last frame if it runs out first.
   * It is silent unless it has `sound: { volume }` (0–1): its audio is then
   * mixed with the base's during its window, under a limiter, as AAC. With no
   * layer's sound on, the base audio is kept untouched.
   *
   * `outputAspect` renders onto a 16:9 / 9:16 / 1:1 / 4:5 canvas (`baseFit`
   * cover by default; `backgroundColor` pads `contain`). `baseBox` places the
   * base itself in a layer's box vocabulary (needs `outputAspect`; `anchor`
   * and `width` are required, `x` and `y` default to 0 and `fit` to
   * contain); the canvas it leaves uncovered shows `backgroundColor`. `layout` writes the boxes:
   * `"video-bottom"` / `"video-top"` (the base whole, full width, against that
   * edge), `"stack-whole"` / `"stack-filled"` (the base above the first video
   * layer, both whole or each cropped to half the frame; no `baseBox`) and
   * `"pip"` (the first video layer 30 % wide in its `corner`, default
   * bottom-right). Every layout but `"pip"` needs `outputAspect`; the stacks
   * and `"pip"` need a video layer.
   *
   * A run with a video layer takes a base of up to 60 s and is priced per
   * started 5 s of it; an image-only run is one flat price. Poll
   * `jobs.get(jobId)`: the output carries `videoUrl`, `thumbnailUrl`,
   * `width`, `height`, `durationSec` and `warnings[]` (a layer clipped or
   * skipped at the video's end, an animated image's first frame, re-encoded
   * audio, a video layer with sound on but no audio track).
   */
  videoOverlay(input: VideoOverlayRequest): Promise<{ jobId: string }> {
    return this.client.request<{ jobId: string }>("POST", "/v1/video-overlay", { body: input })
  }

  /**
   * Track a subject described in plain text through a video and get a
   * black-and-white MASK VIDEO back (`POST /v1/video-mask`, SAM 3.1 by default,
   * or `provider: "sam-3"` at half the price) — white = the subject. Clips up
   * to 5 minutes at 30 fps (a faster clip counts
   * proportionally longer), priced by the clip's length. Poll
   * `jobs.get(jobId)`: the output carries `videoUrl` (the mask), `width`,
   * `height`, `frames`, `coverage` (the fraction of pixels selected, rounded
   * to 4 decimals) and `kept` (any region left on any frame: false only when
   * the size / zone filters left an empty mask — read it rather than
   * `coverage`, which a few pixels round to 0), and `recipe` (the version of
   * the masking algorithm that made it, `VIDEO_MASK_RECIPE`: it changes
   * whenever the same clip and settings would give a different mask). Feed the mask to
   * {@link MediaResource.maskComposite}.
   *
   * `holdLastMask: true` keeps the last mask on frames where the subject is
   * lost (a mask covering under 0.002 % of the frame, e.g. a face behind a
   * hand): each such frame after the first detection repeats the most recent
   * non-empty one, for at most 1 s of frames (`VIDEO_MASK_LIMITS.HOLD_MAX_SEC`;
   * longer gaps stay empty after that); the output then also carries `heldFrames`.
   * `minSubjectHeightPct` (0–100, default 0 = off) drops every connected
   * region whose bounding box is shorter than that % of the frame height
   * (extras' small faces behind the main subject); it runs before
   * `holdLastMask`, and the output then carries `droppedRegions`.
   * `maxSubjectHeightPct` (0–100, default 0 = off) is its mirror: it drops
   * regions TALLER than that % (keep only the small background faces). With
   * both set a region is kept when min ≤ height ≤ max; min > max is a 400.
   * `zone` (`{ leftPct, rightPct, topPct, bottomPct }`, each 0–49 % of the
   * frame, a margin left out = 0; default null = off) keeps only the regions
   * whose bounding-box centre lies inside the frame minus those margins (after
   * the size cuts, before `holdLastMask`). `perShot: true` finds the clip's
   * scene cuts first and segments each shot on its own: the subject is
   * detected again after every cut, `holdLastMask` never crosses a cut, and
   * each shot's mask is fitted to that shot's exact frame count; on a clip
   * with no cut it gives the same mask, fitted to the clip's exact frame
   * count. The output carries `shots` (1 when off). `redetectEverySec` (0 =
   * off, the default, or 1–10) also detects the subject again every that
   * many seconds — the clip (each shot, with `perShot`) is sent to the model
   * in pieces of at most that length, a last piece under 8 frames joining the
   * one before — so someone who walks in or turns to the camera mid-shot is
   * masked from the next boundary on. These boundaries are not cuts:
   * `holdLastMask` holds across them. Each piece is one more model request
   * (three run at a time), so it is slower; the price does not change. The
   * output's `chunks` counts the requests.
   */
  videoMask(input: VideoMaskRequest): Promise<{ jobId: string }> {
    return this.client.request<{ jobId: string }>("POST", "/v1/video-mask", { body: input })
  }

  /**
   * Place a foreground video over a background video through a mask video
   * (`POST /v1/mask-composite`; white = foreground) — local FFmpeg, no AI.
   * The result follows the foreground's size, frame rate and length; the
   * background is fitted (`backgroundFit`, default cover) and loops when
   * shorter; the mask holds its last frame when shorter. Optional
   * `invertMask`, `feather` (0–20 px), `grow` (−10–10 px), `opacity` (0–1,
   * default 1: how strongly the foreground covers the background inside the
   * mask) and `audioSource` (foreground / background / mix / none). Priced per started 5 seconds of
   * the result (the video it follows up to 300 s). Poll `jobs.get(jobId)` for `videoUrl`.
   *
   * `fill` picks what fills the masked area: `video` (default — the
   * foreground, required then), `pixelate` (the background itself in
   * blocks of `pixelSizePct` % of the frame width, 0.2–10, default 1.25) or
   * `blur` (the background blurred, sigma `blurStrengthPct` % of the frame
   * width, 0.1–5, default 2). Pixelate and blur take no
   * `foregroundUrl` (one sent is ignored): the result follows the background
   * and is priced on its length, and it always carries the background's sound
   * (`audioSource` is ignored).
   */
  maskComposite(input: MaskCompositeRequest): Promise<{ jobId: string }> {
    return this.client.request<{ jobId: string }>("POST", "/v1/mask-composite", { body: input })
  }

  /**
   * Probe a social video's metadata (`POST /v1/video-metadata`) — duration,
   * dimensions, title, live status — WITHOUT downloading it. A direct read, not a
   * job. Use it to decide whether to trim before importing.
   */
  videoMetadata(input: { url: string }): Promise<VideoMetadata> {
    return this.client.request<VideoMetadata>("POST", "/v1/video-metadata", { body: input })
  }

  /**
   * Cut or crop a stored file (`POST /v1/media/process`) — synchronous and
   * free, the source-preparation sibling of the priced `trimVideo` node.
   * `trim` is `[startTime, endTime]` in seconds; `deleteSource: true` removes
   * the source object afterwards when it is yours and nothing else references
   * it ("the cut replaces the original"). Answers the stored file. The
   * platform may take up to 300 s on a long file: pass `timeoutMs` to wait
   * longer than the client's default.
   */
  process(
    input: MediaProcessInput,
    options: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<{ data: MediaProcessResult }> {
    return this.client.request<{ data: MediaProcessResult }>("POST", "/v1/media/process", { body: input, ...options })
  }

  /**
   * Throw away a file you just made and no longer need (`POST /v1/media/discard`):
   * a link download replaced before use, a cut superseded by a newer one, a
   * picture imported then cancelled. Not a general delete. The file goes only
   * when it is your own, was made by a link download (`downloadVideo`), a cut
   * (`process`) or a URL import, is under 24 hours old, and no job of yours
   * uses it (as an output or as an input such as a run's `videoUrl`);
   * otherwise it is left untouched and the call fails with 409
   * `not_discardable`. `discarded: false` means there was nothing of yours at
   * that address (already gone, or not yours).
   */
  discard(input: { url: string }): Promise<{ data: MediaDiscardResult }> {
    return this.client.request<{ data: MediaDiscardResult }>("POST", "/v1/media/discard", { body: input })
  }
}

/**
 * One event from {@link MediaResource.downloadVideoProgress}. The stream ends
 * after a `completed` event (which carries the stored `videoUrl` + an optional
 * `thumbnailUrl`) or a `failed` event (which carries `error`).
 */
export interface DownloadVideoProgress {
  phase: "downloading" | "processing" | "uploading" | "completed" | "failed"
  /** Download percent (0–100). Section fetches report jumpy percents — display, don't sum. */
  percent: number
  /** The imported video's storage URL — set on the `completed` event. */
  videoUrl?: string
  /** Thumbnail storage URL — set on the `completed` event when one was captured. */
  thumbnailUrl?: string
  /** What went wrong — set on the `failed` event. */
  error?: string
}

/** Result of {@link MediaResource.videoMetadata}. Fields are best-effort — a probe may omit some. */
export interface VideoMetadata {
  durationSec?: number | null
  width?: number | null
  height?: number | null
  title?: string | null
  isLive?: boolean
  [key: string]: unknown
}

/** Body of {@link MediaResource.splitMedia} (`POST /v1/split-media`): parts of a set length, or one part per shot of a video. */
export type SplitMediaInput = SplitMediaByDurationInput | SplitMediaByShotsInput

/** {@link SplitMediaInput} cutting parts of at most `chunkDuration` seconds. At least one of `videoUrl` / `audioUrl`. */
export interface SplitMediaByDurationInput {
  /** Video to split. */
  videoUrl?: string
  /** Audio file to split (split on its own when a video is given too). */
  audioUrl?: string
  /** The default: parts of a set length. */
  mode?: "duration"
  /** The longest a part may be, in seconds (at least 1). Every part is at most this long. */
  chunkDuration: number
  /** The shortest a part may be, in seconds (0 or more, default 4). Must not exceed `chunkDuration` (400 otherwise). */
  minPartDuration?: number
  /** Format of the audio parts. Default `mp3`. */
  audioFormat?: "mp3" | "wav" | "aac"
}

/** {@link SplitMediaInput} cutting a video into one part per shot, at its measured cuts. */
export interface SplitMediaByShotsInput {
  /** The video to split (up to 30 minutes). A separate audio file is refused (each part keeps the video's own sound). */
  videoUrl: string
  mode: "shots"
}

/** One part's shot in a shots-mode split: its place on the video, seconds to the millisecond. */
export interface SplitMediaShot {
  index: number
  startSec: number
  endSec: number
  durationSec: number
}

/** A completed split-media job's `output_data`. */
export interface SplitMediaOutput {
  /** The video parts, in order (when a video was split). */
  videoUrls?: string[]
  /** The audio parts, in order (when an audio file was split). */
  audioUrls?: string[]
  /** The number of parts — the larger of the two lists. */
  chunkCount: number
  /** Each part's exact length in seconds: the video parts' when a video was split, else the audio parts'. */
  partDurationsSec?: number[]
  /** The audio parts' lengths, only when BOTH a video and an audio file were split. */
  audioPartDurationsSec?: number[]
  /** Shots mode: the number of shots (= parts). */
  shotCount?: number
  /** Shots mode: each part's shot, in part order. */
  shots?: SplitMediaShot[]
}

/** Body of {@link MediaResource.shotCuts} (`POST /v1/shot-cuts`). */
export interface ShotCutsInput {
  /** The video to measure: MP4, MOV, MKV or WebM, up to 30 minutes. */
  videoUrl: string
  /** Also save each shot's first and last frame as images (up to 1,000 shots). Default false. */
  frames?: boolean
}

/** One shot of a {@link ShotCutsResult}: seconds from the video's first frame, to the millisecond. */
export interface ShotCutsShot {
  index: number
  startSec: number
  /** Where the next shot starts, or the video's end. */
  endSec: number
  durationSec: number
  /** With `frames`: the shot's first decoded frame (PNG). */
  firstFrameUrl?: string
  /** With `frames`: its last decoded frame — the one before the next cut, or the video's last. */
  lastFrameUrl?: string
}

/** What a Shot Cuts run measured (`output_data.json`). */
export interface ShotCutsResult {
  shotCount: number
  /** Where each new shot starts: ascending, never 0; `[]` for a single shot. */
  cutsSec: number[]
  /** The video's length. */
  durationSec: number
  shots: ShotCutsShot[]
}

/** A completed shot-cuts job's `output_data`. */
export interface ShotCutsOutput {
  json: ShotCutsResult
  /** With `frames`: each shot's first frame, in shot order. */
  firstFrames?: string[]
  /** With `frames`: each shot's last frame, in shot order. */
  lastFrames?: string[]
}

/** A layer split's pixel budget per image: about one megapixel at `1K`; `auto` keeps the picture's own size (between 1K and 2K). */
export type SplitIntoLayersSize = "1K" | "1.5K" | "2K" | "auto"

/** Per-call options of a media request that starts a job ({@link MediaResource.splitIntoLayers}). */
export interface MediaRunOptions extends RunNodeOptions {
  /** Abort the request. */
  readonly signal?: AbortSignal
  /** This request's timeout in ms, in place of the client's `timeoutMs`. */
  readonly timeoutMs?: number
}

/** A media job started: its id, and `deduped: true` when an `Idempotency-Key` retry found the job already started. */
export interface MediaJobStarted {
  jobId: string
  deduped?: true
}

/** Body of {@link MediaResource.splitIntoLayers} (`POST /v1/split-into-layers`), and of its quote (`nodes.quote("split-into-layers", …)`). */
export interface SplitIntoLayersInput extends GenerationSessionParams {
  /** The picture to split (an http or https URL). */
  imageUrl: string
  /** "Max layers", 1–99 (default 9): more elements than this merge into fewer layers; none is dropped. */
  maxLayers?: number
  /** Default `1K`. `1K` and `1.5K` are priced alike, as are `2K` and `auto`. */
  size?: SplitIntoLayersSize
  /** What to separate (up to 2,000 characters): the elements to split out; `<bbox>x1 y1 x2 y2</bbox>` marks (0–1000) may be typed in it. Empty: the main elements are found automatically. */
  prompt?: string
}

/** A box on the base picture: `x1`/`y1` its top-left corner, `x2`/`y2` its bottom-right. */
export interface SplitLayerBox { x1: number; y1: number; x2: number; y2: number }

/**
 * One layer of a {@link SplitIntoLayersOutput}. A layer is NOT in the base's
 * pixels: it is a transparent PNG cropped to its element, at about the size
 * setting's pixel budget and the element's own shape. To put it back in place,
 * scale it to its `box`.
 */
export interface SplitLayer {
  name?: string
  description?: string
  /** Stacking order: 1 sits on the base, higher is drawn above. */
  zIndex: number
  /** The layer file's own pixels (not the base's). */
  width?: number
  height?: number
  /** Where the layer sits on the base picture, in the base's pixels. */
  box?: SplitLayerBox
  /** The same box on a 0–1000 scale of the base's width and height. */
  boxNormalized?: SplitLayerBox
  /** The layer's stored file. */
  url: string
  /** The stored base picture this layer was cut from: the job's own `imageUrl`. */
  baseUrl?: string
}

/** A completed split-into-layers job's `output_data`. A run that finds no element returns the base only (`layers` empty). */
export interface SplitIntoLayersOutput {
  /** The base picture: an opaque PNG. */
  imageUrl: string
  /** Each layer's stored file, bottom to top. */
  layers: string[]
  /** One entry per layer, in the same order. */
  layerData: SplitLayer[]
  /** The number of layers saved. */
  layerCount: number
  /** Layers the model returned that could not be saved (each is tried a few times first); 0 when every layer was saved. The run is charged only for the images saved. */
  layersNotSaved?: number
  /** Each layer as it was filed in the Library, under its name. */
  libraryImages?: Array<{ url: string; name?: string }>
}

export interface MediaProcessInput {
  sourceUrl: string
  type: "video" | "audio"
  trim?: { startTime: number; endTime: number }
  crop?: { x: number; y: number; width: number; height: number }
  format?: "mp4" | "webm" | "mp3" | "wav" | "m4a" | "aac"
  deleteSource?: boolean
}

/** Result of {@link MediaResource.discard}. */
export interface MediaDiscardResult {
  /** True when the file was deleted; false when there was nothing of yours at that address. */
  discarded: boolean
}

export interface MediaProcessResult {
  url: string
  thumbnailUrl: string | null
  assetId: string | null
  sizeBytes: number
  mimeType: string
  metadata: Record<string, unknown>
}
