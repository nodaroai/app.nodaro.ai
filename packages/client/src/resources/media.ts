import type { NodaroClient } from "../client.js"
import { readSseStream } from "../sse.js"
import type { OverlayAnchor, CaptionStyle, CaptionLookId, SupportedFontName, TranscribeLane, VideoOverlayRequest } from "@nodaro/shared"

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
  transcribeProvider?: TranscribeLane
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
  constructor(private client: NodaroClient) {}

  /**
   * Download a social video (YouTube / TikTok / Instagram / X / Facebook) into
   * your storage (`POST /v1/download-video`). `maxHeight` caps the resolution
   * (default "best"); `sectionStartSec` + `sectionEndSec` (both-or-neither) fetch
   * ONLY that time range instead of the whole video. A download that arrives
   * with no audio stream FAILS by default (it is usually a degraded source
   * response, and is retried through other routes first); pass
   * `requireAudio: false` to accept a clip that really has no sound. Returns a
   * `downloadId`; progress streams from
   * `GET /v1/download-video/progress/:downloadId` (server-sent events) and the
   * finished file lands in your library.
   */
  downloadVideo(input: {
    url: string
    maxHeight?: number
    sectionStartSec?: number
    sectionEndSec?: number
    requireAudio?: boolean
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
   * Place 1–20 timed image layers over a video (`POST /v1/video-overlay`) —
   * rendered locally (FFmpeg) in one pass, no AI; the base audio is kept
   * untouched. Each layer has an `imageUrl`, a `start` and an optional `end`
   * in seconds (no `end` = to the end of the video) and a placement: a
   * `preset` (`"card"`, `"corner-badge"` with a `corner`, `"full-frame"`) or
   * an explicit box in {@link MediaResource.imageOverlay}'s percent vocabulary
   * (`anchor`, `x`, `y`, `width`, `height`, `fit`) — an explicit box field
   * overrides the preset, and a layer with neither is a corner badge
   * (bottom-right, or the `corner` it names). `outputAspect` renders onto a
   * 16:9 / 9:16 / 1:1 / 4:5 canvas
   * (`baseFit` cover by default; `backgroundColor` pads `contain`). Poll
   * `jobs.get(jobId)`: the output carries `videoUrl`, `thumbnailUrl`, `width`,
   * `height`, `durationSec` and `warnings[]` (a layer clipped or skipped at the
   * video's end, an animated image's first frame, re-encoded audio).
   */
  videoOverlay(input: VideoOverlayRequest): Promise<{ jobId: string }> {
    return this.client.request<{ jobId: string }>("POST", "/v1/video-overlay", { body: input })
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
   * it ("the cut replaces the original"). Answers the stored file.
   */
  process(input: MediaProcessInput): Promise<{ data: MediaProcessResult }> {
    return this.client.request<{ data: MediaProcessResult }>("POST", "/v1/media/process", { body: input })
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

export interface MediaProcessInput {
  sourceUrl: string
  type: "video" | "audio"
  trim?: { startTime: number; endTime: number }
  crop?: { x: number; y: number; width: number; height: number }
  format?: "mp4" | "webm" | "mp3" | "wav" | "m4a" | "aac"
  deleteSource?: boolean
}

export interface MediaProcessResult {
  url: string
  thumbnailUrl: string | null
  assetId: string | null
  sizeBytes: number
  mimeType: string
  metadata: Record<string, unknown>
}
