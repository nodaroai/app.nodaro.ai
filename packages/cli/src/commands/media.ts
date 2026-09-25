import { Command } from "commander"
import { readFileSync } from "node:fs"
import { buildClient, handleError } from "../client.js"
import { emit, success, dim, detail, info, warn, type OutputOpts } from "../output.js"
import { collectVariadic, reportQueuedJob } from "../util.js"
import {
  OVERLAY_ANCHORS,
  OVERLAY_PLATFORM_IDS,
  ALL_CAPTION_STYLES,
  CAPTION_LOOK_IDS,
  DEFAULT_CAPTION_LOOK,
  SUPPORTED_FONT_NAMES,
  CAPTION_MAX_WORDS_PER_LINE_MIN,
  CAPTION_MAX_WORDS_PER_LINE_MAX,
  TRANSCRIBE_LANES,
  VIDEO_OVERLAY_CORNERS,
  VIDEO_OVERLAY_FITS,
  VIDEO_OVERLAY_OUTPUT_ASPECTS,
  VIDEO_OVERLAY_PRESET_IDS,
  isVideoOverlayCorner,
  isVideoOverlayOutputAspect,
  isVideoOverlayPresetId,
  type OverlayAnchor,
  type OverlayPlatformId,
  type CaptionStyle,
  type CaptionLookId,
  type SupportedFontName,
  type TranscribeLane,
  type VideoOverlayCorner,
  type VideoOverlayFit,
  type VideoOverlayLayerSpec,
  type VideoOverlayOutputAspect,
  type VideoOverlayPresetId,
} from "@nodaro/shared"
import type { DownloadVideoProgress, CaptionEntry, CaptionSegmentInput } from "@nodaro/sdk"

interface GlobalOpts extends OutputOpts {
  profile?: string
}

interface WatchOpts extends GlobalOpts {
  watch?: boolean
  pollInterval: number
}

/** Parse `--section a-b` (seconds, floats allowed) into a start/end pair. */
function parseSection(raw: string): { sectionStartSec: number; sectionEndSec: number } {
  const m = raw.match(/^([0-9]+(?:\.[0-9]+)?)-([0-9]+(?:\.[0-9]+)?)$/)
  const start = m ? parseFloat(m[1]) : NaN
  const end = m ? parseFloat(m[2]) : NaN
  if (!m || !(start < end)) {
    warn(`--section must be "<start>-<end>" in seconds with start < end (got "${raw}")`)
    process.exit(1)
  }
  return { sectionStartSec: start, sectionEndSec: end }
}

/**
 * Parse one `--at <start[-end]>` (seconds, floats allowed): `3` = from 3 s to
 * the end of the video, `1.2-2.6` = that window. Same refusal shape as
 * `--section`: a message naming the flag, then exit 1.
 */
function parseAt(raw: string): { start: number; end?: number } {
  const m = raw.match(/^([0-9]+(?:\.[0-9]+)?)(?:-([0-9]+(?:\.[0-9]+)?))?$/)
  const start = m ? parseFloat(m[1]) : NaN
  const end = m && m[2] !== undefined ? parseFloat(m[2]) : undefined
  if (!m || (end !== undefined && !(end > start))) {
    warn(`--at must be "<start>" or "<start>-<end>" in seconds with start < end (got "${raw}")`)
    process.exit(1)
  }
  return end === undefined ? { start } : { start, end }
}

/** Parse `--max-words-per-line n` — a whole number inside the shared bounds.
 *  Kept a string until here so the refusal can quote what was actually typed
 *  (`--max-words-per-line 2.5` is a mistake worth naming, not a silent 2). */
function parseMaxWordsPerLine(raw: string): number {
  const n = Number(raw)
  if (!Number.isInteger(n) || n < CAPTION_MAX_WORDS_PER_LINE_MIN || n > CAPTION_MAX_WORDS_PER_LINE_MAX) {
    warn(
      `--max-words-per-line must be a whole number ${CAPTION_MAX_WORDS_PER_LINE_MIN}-${CAPTION_MAX_WORDS_PER_LINE_MAX} (got "${raw}")`,
    )
    process.exit(1)
  }
  return n
}

/** Parse `--canvas WxH` (px) into the route's canvas object. */
function parseCanvas(raw: string): { width: number; height: number } {
  const m = raw.match(/^([0-9]{2,4})x([0-9]{2,4})$/i)
  if (!m) {
    warn(`--canvas must be "<width>x<height>" in px, e.g. 1920x1080 (got "${raw}")`)
    process.exit(1)
  }
  return { width: parseInt(m[1], 10), height: parseInt(m[2], 10) }
}

/**
 * Read + JSON-parse a file that must hold a NON-EMPTY top-level array (a word
 * list for `--captions-file`, a segment list for `--segments-file`). Same guard
 * shape as `edit plan --sources-file`: a friendly message naming the flag, then
 * exit 1 — never a stack trace and never a request with a malformed body.
 */
function readJsonArrayFile<T>(path: string, flag: string): T[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"))
  } catch (err) {
    warn(`${flag} ${path} could not be read as JSON: ${(err as Error).message}`)
    process.exit(1)
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    warn(`${flag} must contain a non-empty JSON array (${path})`)
    process.exit(1)
  }
  return parsed as T[]
}

/** Parse `--safe-area x,y,w,h` (fractions 0..1) into the route's safeArea. */
function parseSafeArea(raw: string): { x: number; y: number; w: number; h: number } {
  const parts = raw.split(",").map((n) => parseFloat(n.trim()))
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n) || n < 0 || n > 1)) {
    warn(`--safe-area must be "x,y,w,h" as fractions 0..1, e.g. 0.05,0.05,0.9,0.9 (got "${raw}")`)
    process.exit(1)
  }
  const [x, y, w, h] = parts
  return { x, y, w, h }
}

export function mediaCommand(): Command {
  const cmd = new Command("media").description(
    "media ingestion + compositing — pull a social video into storage, trim video/audio, burn captions, still-to-video, slideshow, collage images, overlay layers on an image or timed images on a video, save a URL to storage, probe metadata",
  )

  cmd
    .command("download <url>")
    .description("download a social video (YouTube / TikTok / Instagram / X / Facebook) into your storage")
    .option("--max-height <px>", "cap the resolution (e.g. 720); omit for best available", (v) => parseInt(v, 10))
    .option("--section <a-b>", 'fetch ONLY this time range in seconds (e.g. "30-90"); the cut lands on keyframes, so pad and trim after')
    .option("--watch", "stream the download's live progress until it completes")
    .option("--profile <name>")
    .option("--json")
    .addHelpText("after", `
Examples:
  $ nodaro media download https://youtu.be/dQw4w9WgXcQ --max-height 720 --watch
  $ nodaro media download https://youtu.be/dQw4w9WgXcQ --section 30-90 --watch

The finished file lands in your library. Without --watch, the progress state
expires shortly after completion — there is no job to poll later.`)
    .action(
      async (
        url: string,
        opts: { maxHeight?: number; section?: string; watch?: boolean } & GlobalOpts,
      ) => {
        try {
          const section = opts.section !== undefined ? parseSection(opts.section) : undefined
          const client = buildClient(opts.profile)
          const result = await client.media.downloadVideo({
            url,
            ...(opts.maxHeight !== undefined ? { maxHeight: opts.maxHeight } : {}),
            ...(section ?? {}),
          })

          if (opts.json && !opts.watch) {
            emit(result, opts)
            return
          }
          success(`download ${result.downloadId} started`)
          if (!opts.watch) {
            dim("re-run with --watch to stream progress (the progress state expires — start watching promptly)")
            return
          }

          // Downloads report over SSE, not the jobs API — consume the stream
          // and mirror watchUntilTerminal's shape: transitions in human mode,
          // the terminal event in --json mode, exit 2 on failure.
          const start = Date.now()
          let lastPhase = ""
          let lastLoggedPercent = -1
          let terminal: DownloadVideoProgress | undefined
          for await (const ev of client.media.downloadVideoProgress(result.downloadId)) {
            terminal = ev
            if (opts.json) continue
            const secs = ((Date.now() - start) / 1000).toFixed(1)
            if (ev.phase !== lastPhase) {
              info(`[${secs}s] ${result.downloadId} → ${ev.phase}`)
              lastPhase = ev.phase
              lastLoggedPercent = -1
            }
            // Log percent milestones every 25 points within the downloading phase.
            if (ev.phase === "downloading" && ev.percent - lastLoggedPercent >= 25) {
              info(`[${secs}s]   ${Math.floor(ev.percent)}%`)
              lastLoggedPercent = ev.percent
            }
          }

          if (opts.json) {
            emit(terminal ?? { phase: "failed", percent: 0, error: "progress stream ended without a terminal event" }, opts)
            if (terminal?.phase !== "completed") process.exit(2)
            return
          }
          if (terminal?.phase === "completed") {
            success(`downloaded in ${((Date.now() - start) / 1000).toFixed(1)}s`)
            if (terminal.videoUrl) info(`video: ${terminal.videoUrl}`)
            if (terminal.thumbnailUrl) dim(`thumbnail: ${terminal.thumbnailUrl}`)
          } else {
            warn(`download failed: ${terminal?.error ?? "progress stream ended unexpectedly"}`)
            process.exit(2)
          }
        } catch (err) {
          handleError(err)
        }
      },
    )

  cmd
    .command("metadata <url>")
    .description("probe a social video's metadata (duration, dimensions, title, live status) WITHOUT downloading it")
    .option("--profile <name>")
    .option("--json")
    .action(async (url: string, opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const meta = await client.media.videoMetadata({ url })
        if (opts.json) emit(meta, opts)
        else detail(meta)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("trim-video")
    .description("trim a video to a range")
    .requiredOption("--video <url>", "video URL to trim")
    .option("--start <sec>", "range start in seconds", parseFloat)
    .option("--end <sec>", "range end in seconds", parseFloat)
    .option("--keep-first <sec>", "keep only the first N seconds", parseFloat)
    .option("--keep-last <sec>", "keep only the last N seconds", parseFloat)
    .option("--watch", "poll until the job completes")
    .option("--poll-interval <ms>", "watch poll interval in ms", (v) => parseInt(v, 10), 2000)
    .option("--profile <name>")
    .option("--json")
    .addHelpText("after", `
Examples:
  $ nodaro media trim-video --video https://.../clip.mp4 --start 12 --end 48 --watch
  $ nodaro media trim-video --video https://.../clip.mp4 --keep-first 60 --watch`)
    .action(
      async (
        opts: { video: string; start?: number; end?: number; keepFirst?: number; keepLast?: number } & WatchOpts,
      ) => {
        try {
          if (opts.start === undefined && opts.end === undefined && opts.keepFirst === undefined && opts.keepLast === undefined) {
            warn("Provide a range: --start/--end, --keep-first, or --keep-last")
            process.exit(1)
          }
          const client = buildClient(opts.profile)
          const result = await client.media.trimVideo({
            videoUrl: opts.video,
            ...(opts.start !== undefined ? { startTime: opts.start } : {}),
            ...(opts.end !== undefined ? { endTime: opts.end } : {}),
            ...(opts.keepFirst !== undefined ? { keepFirstSeconds: opts.keepFirst } : {}),
            ...(opts.keepLast !== undefined ? { keepLastSeconds: opts.keepLast } : {}),
          })
          await reportQueuedJob(result, () => client.jobs.get(result.jobId), { ...opts, note: "trim video" })
        } catch (err) {
          handleError(err)
        }
      },
    )

  cmd
    .command("still-to-video")
    .description("one still image + one audio track -> MP4 (local FFmpeg, zero credits; length = the audio's length)")
    .requiredOption("--image <url>", "still image URL")
    .requiredOption("--audio <url>", "audio URL - sets the output length (no duration option by design)")
    .option("--motion <preset>", "none|zoom-in|zoom-out|pan-left|pan-right|ken-burns", "none")
    .option("--intensity <1-10>", "motion strength (ignored for none)", (v) => parseInt(v, 10))
    .option("--resolution <res>", "720p|1080p|4K", "1080p")
    .option("--aspect-ratio <ratio>", "16:9|9:16|1:1|4:3", "16:9")
    .option("--fps <fps>", "24|30", (v) => parseInt(v, 10))
    .option("--fit <mode>", "cover (crop to fill) | contain (letterbox)", "cover")
    .option("--pad-color <hex>", "letterbox color when --fit contain (#RRGGBB)")
    .option("--watch", "poll until the job completes")
    .option("--poll-interval <ms>", "watch poll interval in ms", (v) => parseInt(v, 10), 2000)
    .option("--profile <name>")
    .option("--json")
    .addHelpText("after", `
Examples:
  $ nodaro media still-to-video --image https://.../cover.png --audio https://.../track.mp3 --watch
  $ nodaro media still-to-video --image https://.../photo.png --audio https://.../vo.wav --motion ken-burns --intensity 4 --watch`)
    .action(
      async (
        opts: { image: string; audio: string; motion?: string; intensity?: number; resolution?: string; aspectRatio?: string; fps?: number; fit?: string; padColor?: string } & WatchOpts,
      ) => {
        try {
          const client = buildClient(opts.profile)
          const result = await client.media.stillToVideo({
            imageUrl: opts.image,
            audioUrl: opts.audio,
            ...(opts.motion !== undefined ? { motion: opts.motion as "none" } : {}),
            ...(opts.intensity !== undefined ? { intensity: opts.intensity } : {}),
            ...(opts.resolution !== undefined ? { resolution: opts.resolution as "1080p" } : {}),
            ...(opts.aspectRatio !== undefined ? { aspectRatio: opts.aspectRatio as "16:9" } : {}),
            ...(opts.fps !== undefined ? { fps: opts.fps as 30 } : {}),
            ...(opts.fit !== undefined ? { fit: opts.fit as "cover" } : {}),
            ...(opts.padColor !== undefined ? { padColor: opts.padColor } : {}),
          })
          await reportQueuedJob(result, () => client.jobs.get(result.jobId), { ...opts, note: "still to video" })
        } catch (err) {
          handleError(err)
        }
      },
    )

  cmd
    .command("slideshow")
    .description("2-100 images + one optional audio track -> MP4 slideshow (local FFmpeg, zero credits)")
    .requiredOption("--images <urls...>", "2-100 image URLs, in slide order")
    .option("--audio <url>", "audio URL - wired, it sets the output length (never cropped)")
    .option("--durations <secs>", 'comma-separated per-slide seconds; use "auto" for unpinned rows (e.g. "10,4,auto,auto")')
    .option("--per-image <sec>", "seconds per slide when NO audio is wired (default 3)", parseFloat)
    .option("--transition <id>", "xfade id or transition-picker id (cut, fade, dissolve, dip-to-black, ...); unknown -> cut", "cut")
    .option("--transition-duration <sec>", "seconds (default 0.5)", parseFloat)
    .option("--motion <preset>", "none|zoom-in|zoom-out|ken-burns|alternate", "none")
    .option("--intensity <1-10>", "motion strength", (v) => parseInt(v, 10))
    .option("--resolution <res>", "720p|1080p|4K", "1080p")
    .option("--aspect-ratio <ratio>", "16:9|9:16|1:1|4:3", "16:9")
    .option("--fps <fps>", "24|30", (v) => parseInt(v, 10))
    .option("--fit <mode>", "cover|contain", "cover")
    .option("--pad-color <hex>", "letterbox color when --fit contain (#RRGGBB)")
    .option("--watch", "poll until the job completes")
    .option("--poll-interval <ms>", "watch poll interval in ms", (v) => parseInt(v, 10), 2000)
    .option("--profile <name>")
    .option("--json")
    .addHelpText("after", `
Examples:
  $ nodaro media slideshow --images https://.../a.png https://.../b.png https://.../c.png --audio https://.../track.mp3 --transition dissolve --watch
  $ nodaro media slideshow --images https://.../a.png https://.../b.png --per-image 2.5 --motion alternate --watch`)
    .action(
      async (
        opts: { images: string[]; audio?: string; durations?: string; perImage?: number; transition?: string; transitionDuration?: number; motion?: string; intensity?: number; resolution?: string; aspectRatio?: string; fps?: number; fit?: string; padColor?: string } & WatchOpts,
      ) => {
        try {
          if (opts.images.length < 2) {
            warn("Slideshow needs at least 2 images. For a single still, use: nodaro media still-to-video")
            process.exit(1)
          }
          const imageDurations = opts.durations
            ? opts.durations.split(",").map((d) => {
                const t = d.trim().toLowerCase()
                return t === "auto" || t === "" ? null : parseFloat(t)
              })
            : undefined
          const client = buildClient(opts.profile)
          const result = await client.media.slideshow({
            imageUrls: opts.images,
            ...(opts.audio !== undefined ? { audioUrl: opts.audio } : {}),
            ...(imageDurations !== undefined ? { imageDurations } : {}),
            ...(opts.perImage !== undefined ? { perImageDuration: opts.perImage } : {}),
            ...(opts.transition !== undefined ? { transition: opts.transition } : {}),
            ...(opts.transitionDuration !== undefined ? { transitionDuration: opts.transitionDuration } : {}),
            ...(opts.motion !== undefined ? { motion: opts.motion as "none" } : {}),
            ...(opts.intensity !== undefined ? { intensity: opts.intensity } : {}),
            ...(opts.resolution !== undefined ? { resolution: opts.resolution as "1080p" } : {}),
            ...(opts.aspectRatio !== undefined ? { aspectRatio: opts.aspectRatio as "16:9" } : {}),
            ...(opts.fps !== undefined ? { fps: opts.fps as 30 } : {}),
            ...(opts.fit !== undefined ? { fit: opts.fit as "cover" } : {}),
            ...(opts.padColor !== undefined ? { padColor: opts.padColor } : {}),
          })
          await reportQueuedJob(result, () => client.jobs.get(result.jobId), { ...opts, note: "slideshow" })
        } catch (err) {
          handleError(err)
        }
      },
    )

  cmd
    .command("trim-audio")
    .description("trim (and extract) audio from a video or audio source")
    .option("--video <url>", "video URL to extract + trim audio from")
    .option("--audio <url>", "audio URL to trim")
    .option("--start <sec>", "range start in seconds", parseFloat)
    .option("--end <sec>", "range end in seconds", parseFloat)
    .option("--format <fmt>", "output format: mp3 (default), wav, or aac")
    .option("--watch", "poll until the job completes")
    .option("--poll-interval <ms>", "watch poll interval in ms", (v) => parseInt(v, 10), 2000)
    .option("--profile <name>")
    .option("--json")
    .addHelpText("after", `
Example:
  $ nodaro media trim-audio --video https://.../clip.mp4 --start 0 --end 30 --format wav --watch`)
    .action(
      async (
        opts: { video?: string; audio?: string; start?: number; end?: number; format?: string } & WatchOpts,
      ) => {
        try {
          if (!opts.video && !opts.audio) {
            warn("Provide --video <url> or --audio <url> (one is required)")
            process.exit(1)
          }
          if (opts.format && !["mp3", "wav", "aac"].includes(opts.format)) {
            warn(`--format must be mp3, wav, or aac (got "${opts.format}")`)
            process.exit(1)
          }
          const client = buildClient(opts.profile)
          const result = await client.media.trimAudio({
            ...(opts.video ? { videoUrl: opts.video } : {}),
            ...(opts.audio ? { audioUrl: opts.audio } : {}),
            ...(opts.start !== undefined ? { startTime: opts.start } : {}),
            ...(opts.end !== undefined ? { endTime: opts.end } : {}),
            ...(opts.format ? { audioFormat: opts.format as "mp3" | "wav" | "aac" } : {}),
          })
          await reportQueuedJob(result, () => client.jobs.get(result.jobId), { ...opts, note: "trim audio" })
        } catch (err) {
          handleError(err)
        }
      },
    )

  cmd
    .command("add-captions <videoUrl>")
    .description(
      "burn captions into a video — static subtitles, or a kinetic word-highlight / karaoke / tiktok-words / word-pop / bouncy render",
    )
    .option("--text <text>", "the caption text — spaced evenly across the video when no word timings are given")
    .option(
      "--captions-file <path>",
      "JSON array of word-timed entries [{ text, startMs, endMs }] — one per WORD for the kinetic styles; a transcribe job's output_data.words drops in verbatim",
    )
    .option("--style <style>", `caption style: ${ALL_CAPTION_STYLES.join(" | ")} (default subtitle)`)
    .option(
      "--look <look>",
      `kinetic look preset: ${CAPTION_LOOK_IDS.join(" | ")} — an unset look renders as ${DEFAULT_CAPTION_LOOK}; the levers below override its individual fields`,
    )
    .option("--position <pos>", "bottom (default) | top | center")
    .option("--position-y <pct>", "the caption block's CENTRE as % of height (0-100) — overrides --position", parseFloat)
    .option("--font-size <px>", "font size in px (12-200)", parseFloat)
    .option("--font-family <name>", "font face — see the list below")
    .option("--font-weight <n>", "CSS font weight, 100-900 in 100s", (v) => parseInt(v, 10))
    .option("--color <color>", "caption text colour")
    .option("--background-color <color>", "caption background colour")
    .option("--stroke-color <color>", "outline colour")
    .option("--stroke-width <px>", "outline width in px, 0-40", parseFloat)
    .option("--highlight-color <color>", "colour of the word being spoken (kinetic styles only)")
    .option("--uppercase", "force UPPERCASE captions")
    .option("--no-uppercase", "keep mixed case (the default outline look is UPPERCASE)")
    .option(
      "--max-words-per-line <n>",
      `cap the words on one caption line (or tiktok-words page), ${CAPTION_MAX_WORDS_PER_LINE_MIN}-${CAPTION_MAX_WORDS_PER_LINE_MAX} — unset fits the frame width`,
    )
    .option("--animate", "animate per-word motion on the kinetic styles (the default)")
    .option(
      "--no-animate",
      "freeze per-word motion on the kinetic styles — keeps grouping, line-holding and the spoken-word highlight (kinetic styles only)",
    )
    .option("--no-auto-transcribe", "do NOT transcribe the video's audio when no --text / --captions-file is given")
    .option("--transcribe-provider <name>", `engine for the auto-transcription: ${TRANSCRIBE_LANES.join(" | ")}`)
    .option(
      "--segments-file <path>",
      "JSON array of caption SEGMENTS — non-overlapping { startMs, endMs } ranges, each with its own style/look/position overrides and optional own words",
    )
    .option("--watch", "poll until the job completes")
    .option("--poll-interval <ms>", "watch poll interval in ms", (v) => parseInt(v, 10), 2000)
    .option("--profile <name>")
    .option("--json")
    .addHelpText("after", `
Fonts: ${SUPPORTED_FONT_NAMES.join(", ")}

The styling levers (--look, --font-family, --font-weight, --stroke-*, --uppercase,
--position-y, --max-words-per-line) now apply to the static subtitle style too — a
subtitle carrying any of them renders via Remotion. Only --highlight-color and
--animate are kinetic-only; the subtitle style rejects them with a 400.

--animate is on by default; --no-animate freezes the per-word motion on the kinetic
styles (the grouping, line-holding and spoken-word highlight stay).

--max-words-per-line caps a line (or a tiktok-words page) ON TOP of the width budget,
sentence ends and pauses that already close one — 1-2 gives the punchy CapCut read.
It is inert on word-pop, which is always one word, and a --segments-file entry that
names its own overrides it for that range.

Examples:
  $ nodaro media add-captions https://.../clip.mp4 --style word-highlight --look outline --watch
  $ nodaro media add-captions https://.../clip.mp4 --captions-file words.json --style karaoke \\
      --no-auto-transcribe --highlight-color '#FFE600' --watch`)
    .action(
      async (
        videoUrl: string,
        opts: {
          text?: string
          captionsFile?: string
          style?: string
          look?: string
          position?: string
          positionY?: number
          fontSize?: number
          fontFamily?: string
          fontWeight?: number
          color?: string
          backgroundColor?: string
          strokeColor?: string
          strokeWidth?: number
          highlightColor?: string
          uppercase?: boolean
          maxWordsPerLine?: string
          animate?: boolean
          autoTranscribe?: boolean
          transcribeProvider?: string
          segmentsFile?: string
        } & WatchOpts,
      ) => {
        try {
          if (opts.style && !(ALL_CAPTION_STYLES as readonly string[]).includes(opts.style)) {
            warn(`--style must be one of ${ALL_CAPTION_STYLES.join(", ")} (got "${opts.style}")`)
            process.exit(1)
          }
          if (opts.look && !(CAPTION_LOOK_IDS as readonly string[]).includes(opts.look)) {
            warn(`--look must be one of ${CAPTION_LOOK_IDS.join(", ")} (got "${opts.look}")`)
            process.exit(1)
          }
          if (opts.position && !["bottom", "top", "center"].includes(opts.position)) {
            warn(`--position must be bottom, top, or center (got "${opts.position}")`)
            process.exit(1)
          }
          if (opts.fontFamily && !(SUPPORTED_FONT_NAMES as readonly string[]).includes(opts.fontFamily)) {
            warn(`--font-family must be one of ${SUPPORTED_FONT_NAMES.join(", ")} (got "${opts.fontFamily}")`)
            process.exit(1)
          }
          if (
            opts.fontWeight !== undefined &&
            (!Number.isInteger(opts.fontWeight) || opts.fontWeight < 100 || opts.fontWeight > 900 || opts.fontWeight % 100 !== 0)
          ) {
            warn(`--font-weight must be 100-900 in steps of 100 (got "${opts.fontWeight}")`)
            process.exit(1)
          }
          if (opts.transcribeProvider && !(TRANSCRIBE_LANES as readonly string[]).includes(opts.transcribeProvider)) {
            warn(`--transcribe-provider must be one of ${TRANSCRIBE_LANES.join(", ")} (got "${opts.transcribeProvider}")`)
            process.exit(1)
          }
          const maxWordsPerLine =
            opts.maxWordsPerLine !== undefined ? parseMaxWordsPerLine(opts.maxWordsPerLine) : undefined
          const captions = opts.captionsFile
            ? readJsonArrayFile<CaptionEntry>(opts.captionsFile, "--captions-file")
            : undefined
          const segments = opts.segmentsFile
            ? readJsonArrayFile<CaptionSegmentInput>(opts.segmentsFile, "--segments-file")
            : undefined
          const client = buildClient(opts.profile)
          const result = await client.media.addCaptions({
            videoUrl,
            ...(opts.text !== undefined ? { text: opts.text } : {}),
            ...(captions ? { captions } : {}),
            ...(segments ? { segments } : {}),
            ...(opts.style ? { style: opts.style as CaptionStyle } : {}),
            ...(opts.look ? { look: opts.look as CaptionLookId } : {}),
            ...(opts.position ? { position: opts.position as "bottom" | "top" | "center" } : {}),
            ...(opts.positionY !== undefined ? { positionY: opts.positionY } : {}),
            ...(opts.fontSize !== undefined ? { fontSize: opts.fontSize } : {}),
            ...(opts.fontFamily ? { fontFamily: opts.fontFamily as SupportedFontName } : {}),
            ...(opts.fontWeight !== undefined ? { fontWeight: opts.fontWeight } : {}),
            ...(opts.color ? { color: opts.color } : {}),
            ...(opts.backgroundColor ? { backgroundColor: opts.backgroundColor } : {}),
            ...(opts.strokeColor ? { strokeColor: opts.strokeColor } : {}),
            ...(opts.strokeWidth !== undefined ? { strokeWidth: opts.strokeWidth } : {}),
            ...(opts.highlightColor ? { highlightColor: opts.highlightColor } : {}),
            ...(maxWordsPerLine !== undefined ? { maxWordsPerLine } : {}),
            // Tri-state: commander leaves it undefined unless --uppercase / --no-uppercase
            // was passed, so an untouched flag keeps the look's own casing.
            ...(opts.uppercase !== undefined ? { uppercase: opts.uppercase } : {}),
            // Same tri-state as --uppercase: undefined unless --animate / --no-animate
            // was passed, so an untouched flag keeps the server default (animate: true).
            ...(opts.animate !== undefined ? { animate: opts.animate } : {}),
            // Commander defaults a lone `--no-x` flag to TRUE, so only an
            // explicit `--no-auto-transcribe` may reach the wire — otherwise
            // every call would pin auto_transcribe and the route could never
            // see an absent flag.
            ...(opts.autoTranscribe === false ? { autoTranscribe: false } : {}),
            ...(opts.transcribeProvider ? { transcribeProvider: opts.transcribeProvider as TranscribeLane } : {}),
          })
          await reportQueuedJob(result, () => client.jobs.get(result.jobId), {
            ...opts,
            note: opts.style ?? "subtitle",
          })
        } catch (err) {
          handleError(err)
        }
      },
    )

  cmd
    .command("collage <imageUrls...>")
    .description("composite 2–30 images into ONE large 2K/4K collage (smart justified layout — no cropping — or uniform grid)")
    .option(
      "--sizes <list>",
      "comma-separated per-image size hints aligned with the images: 0 auto (default), 1 big (~2× linear), 2 medium, 3 small (~½). Relative — smart layout only",
    )
    .option("--numbered", "stamp 1-based sequence numbers at each image's corner (storyboard mode)")
    .option("--badge-position <corner>", "where the number/label badges sit: top-left (default) or top-right")
    .option(
      "--label <text>",
      'per-image caption shown after the number; repeat once per image, in order (pass "" to skip one)',
      collectVariadic,
    )
    .option("--layout <layout>", "smart (default — justified rows, output height floats) or grid (uniform letterboxed cells)")
    .option("--resolution <res>", "long-edge resolution: 2K or 4K (default 4K)")
    .option("--aspect-ratio <W:H>", 'output canvas ratio, e.g. "4:3" (exact in grid; a target shape in smart)')
    .option("--gap <px>", "gap between images + outer margin in px (default 24)", (v) => parseInt(v, 10))
    .option("--background-color <hex>", "background shown in the gaps, #RRGGBB")
    .option("--watch", "poll until the job completes")
    .option("--poll-interval <ms>", "watch poll interval in ms", (v) => parseInt(v, 10), 2000)
    .option("--profile <name>")
    .option("--json")
    .addHelpText("after", `
Examples:
  $ nodaro media collage https://x/a.png https://x/b.png https://x/c.png --watch
  $ nodaro media collage https://x/hero.png https://x/b.png https://x/c.png --sizes 1,3,3 --aspect-ratio 16:9 --watch
  $ nodaro media collage https://x/a.png https://x/b.png https://x/c.png --numbered --label Wide --label "" --label Close-up --watch

--sizes aligns by position: "1,3,3" renders the first image big and the other
two small. Hints are relative — all-equal hints change nothing, and the grid
layout ignores them.

--numbered stamps 1, 2, 3… at each image's top-left corner, in the order the
images are passed (--badge-position top-right moves the badges). Repeat --label once per image (in the same order) to caption it
after the number ("3 · Close-up"); pass "" to skip a label for one image.`)
    .action(
      async (
        imageUrls: string[],
        opts: {
          sizes?: string
          numbered?: boolean
          badgePosition?: string
          label?: string[]
          layout?: string
          resolution?: string
          aspectRatio?: string
          gap?: number
          backgroundColor?: string
        } & WatchOpts,
      ) => {
        try {
          if (imageUrls.length < 2) {
            warn(`Provide at least 2 image URLs (got ${imageUrls.length})`)
            process.exit(1)
          }
          if (opts.layout && !["smart", "grid"].includes(opts.layout)) {
            warn(`--layout must be smart or grid (got "${opts.layout}")`)
            process.exit(1)
          }
          if (opts.resolution && !["2K", "4K"].includes(opts.resolution)) {
            warn(`--resolution must be 2K or 4K (got "${opts.resolution}")`)
            process.exit(1)
          }
          if (opts.badgePosition && !["top-left", "top-right"].includes(opts.badgePosition)) {
            warn(`--badge-position must be top-left or top-right (got "${opts.badgePosition}")`)
            process.exit(1)
          }
          let imageSizes: Array<0 | 1 | 2 | 3> | undefined
          if (opts.sizes !== undefined) {
            const parsed = opts.sizes.split(",").map((s) => parseInt(s.trim(), 10))
            if (parsed.some((n) => !Number.isInteger(n) || n < 0 || n > 3) || parsed.length > imageUrls.length) {
              warn(`--sizes must be comma-separated 0–3 hints, at most one per image (got "${opts.sizes}")`)
              process.exit(1)
            }
            imageSizes = parsed as Array<0 | 1 | 2 | 3>
          }
          // --label is repeatable and index-aligned with the image args; a
          // trimmed-empty label ('' to skip) becomes null so numbering stays
          // aligned. All-blank → omit the field (no captions).
          let imageLabels: Array<string | null> | undefined
          if (opts.label && opts.label.length > 0) {
            if (opts.label.length > imageUrls.length) {
              warn(`Too many --label values: ${opts.label.length} for ${imageUrls.length} images (one per image, in order)`)
              process.exit(1)
            }
            if (opts.label.some((s) => s.length > 80)) {
              warn("Each --label must be at most 80 characters")
              process.exit(1)
            }
            const mapped = opts.label.map((s) => s.trim() || null)
            if (mapped.some((l) => l !== null)) {
              imageLabels = mapped
            }
          }
          const client = buildClient(opts.profile)
          const result = await client.media.imageCollage({
            imageUrls,
            ...(imageSizes ? { imageSizes } : {}),
            ...(opts.numbered ? { numbered: true } : {}),
            ...(imageLabels ? { imageLabels } : {}),
            ...(opts.badgePosition ? { badgePosition: opts.badgePosition as "top-left" | "top-right" } : {}),
            ...(opts.layout ? { layout: opts.layout as "smart" | "grid" } : {}),
            ...(opts.resolution ? { resolution: opts.resolution as "2K" | "4K" } : {}),
            ...(opts.aspectRatio ? { aspectRatio: opts.aspectRatio } : {}),
            ...(opts.gap !== undefined ? { gap: opts.gap } : {}),
            ...(opts.backgroundColor ? { backgroundColor: opts.backgroundColor } : {}),
          })
          await reportQueuedJob(result, () => client.jobs.get(result.jobId), { ...opts, note: "image collage" })
        } catch (err) {
          handleError(err)
        }
      },
    )

  cmd
    .command("overlay <imageUrl> [layerUrls...]")
    .description("place layers on a base image, pixel-exactly (local compositor, no AI) — positional URLs are image layers; --layers-file for text/QR/shape layers")
    .option("--layers-file <path>", "JSON file with the full layers array (every kind and per-layer option; mutually exclusive with positional layer URLs)")
    .option("--anchor <anchor>", `the point each positional layer attaches to: ${OVERLAY_ANCHORS.join(" | ")} (default center)`)
    .option("--x <percent>", "offset from the anchor in % of the base width (negative on a right anchor moves inward)", parseFloat)
    .option("--y <percent>", "offset from the anchor in % of the base height (negative on a bottom anchor moves inward)", parseFloat)
    .option("--width <percent>", "layer width in % of the base width (default 25; height follows the layer's aspect)", parseFloat)
    .option("--opacity <0-1>", "layer opacity (default 1)", parseFloat)
    .option("--platform <id>", `also render the composite at a platform's size; repeat for more (${OVERLAY_PLATFORM_IDS.length} available, e.g. youtube-thumbnail)`, collectVariadic)
    .option("--qr-text <text>", "fills every QR layer that reads its link from the workflow (qr.fromInput)")
    .option("--mask-mode <mode>", "mask the job also emits (white = may change): none | layers | around (default — the ring an AI finish repaints) | outside")
    .option("--mask-spread <px>", "ring width in px for --mask-mode around (default 48)", (v) => parseInt(v, 10))
    .option("--canvas <WxH>", "output canvas in px (the base is placed into it); omit to keep the base's pixel size")
    .option("--base-fit <fit>", "how the base fills --canvas: contain or cover")
    .option("--background-color <hex>", "canvas background behind the base, #RRGGBB (with --canvas)")
    .option("--output-format <fmt>", "png (default, keeps transparency), jpg or webp")
    .option("--watch", "poll until the job completes")
    .option("--poll-interval <ms>", "watch poll interval in ms", (v) => parseInt(v, 10), 2000)
    .option("--profile <name>")
    .option("--json")
    .addHelpText("after", `
Examples:
  $ nodaro media overlay https://x/base.png https://x/logo.svg --anchor bottom-right --x -4 --y -6 --width 12 --watch
  $ nodaro media overlay https://x/base.png https://x/logo.png --platform youtube-thumbnail --platform x-header --watch
  $ cat > layers.json <<'JSON'
  [{"kind":"text","text":{"content":"50% OFF","fontId":"anton","fontSize":9,"color":"#ffffff"},"anchor":"top-left","x":5,"y":5},
   {"kind":"qr","qr":{"text":"https://nodaro.ai"},"anchor":"bottom-right","x":-4,"y":-4,"width":14}]
  JSON
  $ nodaro media overlay https://x/base.png --layers-file layers.json --watch

Placement is in PERCENT of the base image, so the same call works on a 1K
preview and a 4K render. --anchor/--x/--y/--width/--opacity apply to EVERY
positional layer (the watermark case); per-layer control — and the text, QR and
shape kinds — goes through --layers-file.

Not sure where a layer should sit? \`nodaro media overlay-placement\` asks a
vision model and answers in these same units.`)
    .action(
      async (
        imageUrl: string,
        layerUrls: string[],
        opts: {
          layersFile?: string
          anchor?: string
          x?: number
          y?: number
          width?: number
          opacity?: number
          platform?: string[]
          qrText?: string
          maskMode?: string
          maskSpread?: number
          canvas?: string
          baseFit?: string
          backgroundColor?: string
          outputFormat?: string
        } & WatchOpts,
      ) => {
        try {
          if (opts.layersFile && layerUrls.length > 0) {
            warn("Pass layers EITHER as positional URLs OR with --layers-file, not both")
            process.exit(1)
          }
          if (!opts.layersFile && layerUrls.length === 0) {
            warn("Give at least one layer: a positional image URL, or --layers-file with the layers array")
            process.exit(1)
          }
          if (opts.anchor && !(OVERLAY_ANCHORS as readonly string[]).includes(opts.anchor)) {
            warn(`--anchor must be one of ${OVERLAY_ANCHORS.join(", ")} (got "${opts.anchor}")`)
            process.exit(1)
          }
          if (opts.maskMode && !["none", "layers", "around", "outside"].includes(opts.maskMode)) {
            warn(`--mask-mode must be none, layers, around or outside (got "${opts.maskMode}")`)
            process.exit(1)
          }
          if (opts.baseFit && !["contain", "cover"].includes(opts.baseFit)) {
            warn(`--base-fit must be contain or cover (got "${opts.baseFit}")`)
            process.exit(1)
          }
          if (opts.outputFormat && !["png", "jpg", "webp"].includes(opts.outputFormat)) {
            warn(`--output-format must be png, jpg or webp (got "${opts.outputFormat}")`)
            process.exit(1)
          }
          const unknownPlatforms = (opts.platform ?? []).filter(
            (p) => !(OVERLAY_PLATFORM_IDS as readonly string[]).includes(p),
          )
          if (unknownPlatforms.length > 0) {
            warn(`Unknown --platform: ${unknownPlatforms.join(", ")}. Available: ${OVERLAY_PLATFORM_IDS.join(", ")}`)
            process.exit(1)
          }

          // Positional URLs are image layers sharing the flag placement; a
          // layers file carries whatever the route accepts, verbatim.
          let layers: Array<Record<string, unknown>>
          if (opts.layersFile) {
            const parsed = JSON.parse(readFileSync(opts.layersFile, "utf8")) as unknown
            if (!Array.isArray(parsed) || parsed.length === 0) {
              warn(`--layers-file must contain a non-empty JSON array of layers (${opts.layersFile})`)
              process.exit(1)
            }
            layers = parsed as Array<Record<string, unknown>>
          } else {
            const placement = {
              ...(opts.anchor ? { anchor: opts.anchor as OverlayAnchor } : {}),
              ...(opts.x !== undefined ? { x: opts.x } : {}),
              ...(opts.y !== undefined ? { y: opts.y } : {}),
              ...(opts.width !== undefined ? { width: opts.width } : {}),
              ...(opts.opacity !== undefined ? { opacity: opts.opacity } : {}),
            }
            layers = layerUrls.map((url) => ({ imageUrl: url, ...placement }))
          }

          const canvas = opts.canvas ? parseCanvas(opts.canvas) : undefined
          const client = buildClient(opts.profile)
          const result = await client.media.imageOverlay({
            imageUrl,
            layers: layers as Parameters<typeof client.media.imageOverlay>[0]["layers"],
            ...(canvas
              ? { canvas: { ...canvas, ...(opts.backgroundColor ? { backgroundColor: opts.backgroundColor } : {}) } }
              : {}),
            ...(opts.baseFit ? { baseFit: opts.baseFit as "contain" | "cover" } : {}),
            ...(opts.outputFormat ? { outputFormat: opts.outputFormat as "png" | "jpg" | "webp" } : {}),
            ...(opts.platform?.length ? { variants: opts.platform as OverlayPlatformId[] } : {}),
            ...(opts.qrText ? { qrText: opts.qrText } : {}),
            ...(opts.maskMode ? { maskMode: opts.maskMode as "none" | "layers" | "around" | "outside" } : {}),
            ...(opts.maskSpread !== undefined ? { maskSpread: opts.maskSpread } : {}),
          })
          await reportQueuedJob(result, () => client.jobs.get(result.jobId), { ...opts, note: "image overlay" })
        } catch (err) {
          handleError(err)
        }
      },
    )

  cmd
    .command("video-overlay <videoUrl> [layerUrls...]")
    .description("place timed image layers over a video (local compositor, no AI; the audio is kept) — positional URLs are layers, one --at each")
    .option("--at <start[-end]>", 'a positional layer\'s window in seconds ("3" = from 3 s to the end, "1.2-2.6"); repeat once per layer, in order', collectVariadic)
    .option("--preset <id>", `placement for every positional layer: ${VIDEO_OVERLAY_PRESET_IDS.join(" | ")} (default: a corner badge — bottom-right, or the --corner given)`)
    .option("--corner <corner>", `with --preset corner-badge: ${VIDEO_OVERLAY_CORNERS.join(" | ")} (default bottom-right)`)
    .option("--layers-file <path>", "JSON file with the full layers array (custom boxes, opacity, animate, zIndex; mutually exclusive with positional layer URLs)")
    .option("--aspect <ratio>", `render onto a ${VIDEO_OVERLAY_OUTPUT_ASPECTS.join(" | ")} canvas instead of the video's own size`)
    .option("--base-fit <fit>", "with --aspect: how the video fills the canvas, cover (default) or contain")
    .option("--background-color <hex>", "with --aspect: the padding colour under --base-fit contain, #RRGGBB")
    .option("--watch", "poll until the job completes")
    .option("--poll-interval <ms>", "watch poll interval in ms", (v) => parseInt(v, 10), 2000)
    .option("--profile <name>")
    .option("--json")
    .addHelpText("after", `
Examples:
  $ nodaro media video-overlay https://x/clip.mp4 https://x/shot1.png https://x/shot2.png --at 1.2-2.6 --at 3-4.4 --preset card --watch
  $ nodaro media video-overlay https://x/clip.mp4 https://x/logo.png --at 0 --preset corner-badge --corner top-right --watch
  $ nodaro media video-overlay https://x/clip.mp4 --layers-file layers.json --aspect 9:16 --watch

A layers file holds the API's layers array, e.g.
  [{"imageUrl":"https://x/logo.png","start":0,"anchor":"top-left","x":4,"y":4,"width":12,"opacity":0.9}]
Placement is in PERCENT of the output frame. An explicit box field overrides a
preset; a layer with neither is a corner badge (bottom-right, or the corner it
names).`)
    .action(
      async (
        videoUrl: string,
        layerUrls: string[],
        opts: {
          at?: string[]
          preset?: string
          corner?: string
          layersFile?: string
          aspect?: string
          baseFit?: string
          backgroundColor?: string
        } & WatchOpts,
      ) => {
        try {
          if (opts.layersFile && layerUrls.length > 0) {
            warn("Pass layers EITHER as positional URLs OR with --layers-file, not both")
            process.exit(1)
          }
          if (!opts.layersFile && layerUrls.length === 0) {
            warn("Give at least one layer: a positional image URL (with its --at), or --layers-file with the layers array")
            process.exit(1)
          }
          if (opts.layersFile && (opts.at?.length || opts.preset || opts.corner)) {
            warn("--at, --preset and --corner apply to positional layers — put them inside the --layers-file entries instead")
            process.exit(1)
          }
          if (opts.preset && !isVideoOverlayPresetId(opts.preset)) {
            warn(`--preset must be one of ${VIDEO_OVERLAY_PRESET_IDS.join(", ")} (got "${opts.preset}")`)
            process.exit(1)
          }
          if (opts.corner && !isVideoOverlayCorner(opts.corner)) {
            warn(`--corner must be one of ${VIDEO_OVERLAY_CORNERS.join(", ")} (got "${opts.corner}")`)
            process.exit(1)
          }
          if (opts.aspect && !isVideoOverlayOutputAspect(opts.aspect)) {
            warn(`--aspect must be one of ${VIDEO_OVERLAY_OUTPUT_ASPECTS.join(", ")} (got "${opts.aspect}")`)
            process.exit(1)
          }
          if (opts.baseFit && !(VIDEO_OVERLAY_FITS as readonly string[]).includes(opts.baseFit)) {
            warn(`--base-fit must be cover or contain (got "${opts.baseFit}")`)
            process.exit(1)
          }
          if ((opts.baseFit || opts.backgroundColor) && !opts.aspect) {
            warn("--base-fit and --background-color need --aspect")
            process.exit(1)
          }

          // Positional URLs pair with their --at windows and share the preset;
          // a layers file carries whatever the route accepts, verbatim.
          let layers: VideoOverlayLayerSpec[]
          if (opts.layersFile) {
            layers = readJsonArrayFile<VideoOverlayLayerSpec>(opts.layersFile, "--layers-file")
          } else {
            const at = opts.at ?? []
            if (at.length !== layerUrls.length) {
              warn(`Give one --at per layer URL, in order (${layerUrls.length} layer URL(s), ${at.length} --at)`)
              process.exit(1)
            }
            layers = layerUrls.map((imageUrl, i) => ({
              imageUrl,
              ...parseAt(at[i]),
              ...(opts.preset ? { preset: opts.preset as VideoOverlayPresetId } : {}),
              ...(opts.corner ? { corner: opts.corner as VideoOverlayCorner } : {}),
            }))
          }

          const client = buildClient(opts.profile)
          const result = await client.media.videoOverlay({
            videoUrl,
            layers,
            ...(opts.aspect ? { outputAspect: opts.aspect as VideoOverlayOutputAspect } : {}),
            ...(opts.baseFit ? { baseFit: opts.baseFit as VideoOverlayFit } : {}),
            ...(opts.backgroundColor ? { backgroundColor: opts.backgroundColor } : {}),
          })
          await reportQueuedJob(result, () => client.jobs.get(result.jobId), { ...opts, note: "video overlay" })
        } catch (err) {
          handleError(err)
        }
      },
    )

  cmd
    .command("overlay-placement <imageUrl>")
    .description("ask a vision model WHERE one overlay layer should sit — answers in `media overlay`'s own percent units")
    .option("--intent <text>", 'what the layer is, in words — "a logo", "a price badge" (default a logo)')
    .option("--aspect <ratio>", "the layer's width / height (1 = square, the default)", parseFloat)
    .option("--safe-area <x,y,w,h>", "always-visible region as fractions 0..1; the placement is kept inside it")
    .option("--profile <name>")
    .option("--json")
    .addHelpText("after", `
Example:
  $ nodaro media overlay-placement https://x/base.png --intent "a logo" --aspect 2.5

Answers synchronously (no job to poll) with anchor, x, y and width — feed them
straight to \`nodaro media overlay --anchor … --x … --y … --width …\`. Billed as
one image-to-text call.`)
    .action(
      async (
        imageUrl: string,
        opts: { intent?: string; aspect?: number; safeArea?: string } & GlobalOpts,
      ) => {
        try {
          const safeArea = opts.safeArea ? parseSafeArea(opts.safeArea) : undefined
          const client = buildClient(opts.profile)
          const { placement } = await client.media.suggestOverlayPlacement({
            imageUrl,
            ...(opts.intent ? { intent: opts.intent } : {}),
            ...(opts.aspect !== undefined ? { layerAspect: opts.aspect } : {}),
            ...(safeArea ? { safeArea } : {}),
          })
          if (opts.json) {
            emit(placement, opts)
            return
          }
          success(`anchor ${placement.anchor}, x ${placement.x}%, y ${placement.y}%, width ${placement.width}%`)
          dim(placement.reason)
          info(
            `apply: nodaro media overlay ${imageUrl} <layerUrl> --anchor ${placement.anchor} ` +
              `--x ${placement.x} --y ${placement.y} --width ${placement.width} --watch`,
          )
        } catch (err) {
          handleError(err)
        }
      },
    )

  cmd
    .command("save <url>")
    .description("copy an external media URL into your Nodaro storage (server-side fetch)")
    .option("--filename <name>", "filename to store it under")
    .option("--type <type>", "media type hint: image, video, or audio")
    .option("--watch", "poll until the job completes")
    .option("--poll-interval <ms>", "watch poll interval in ms", (v) => parseInt(v, 10), 2000)
    .option("--profile <name>")
    .option("--json")
    .action(
      async (
        url: string,
        opts: { filename?: string; type?: string } & WatchOpts,
      ) => {
        try {
          if (opts.type && !["image", "video", "audio"].includes(opts.type)) {
            warn(`--type must be image, video, or audio (got "${opts.type}")`)
            process.exit(1)
          }
          const client = buildClient(opts.profile)
          const result = await client.media.saveToStorage({
            mediaUrl: url,
            ...(opts.filename ? { filename: opts.filename } : {}),
            ...(opts.type ? { mediaType: opts.type as "image" | "video" | "audio" } : {}),
          })
          await reportQueuedJob(result, () => client.jobs.get(result.jobId), { ...opts, note: "save to storage" })
        } catch (err) {
          handleError(err)
        }
      },
    )

  return cmd
}
