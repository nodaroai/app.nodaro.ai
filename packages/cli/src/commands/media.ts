import { Command } from "commander"
import { buildClient, handleError } from "../client.js"
import { emit, success, dim, detail, info, warn, type OutputOpts } from "../output.js"
import { reportQueuedJob } from "../util.js"
import type { DownloadVideoProgress } from "@nodaro/sdk"

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

export function mediaCommand(): Command {
  const cmd = new Command("media").description(
    "media ingestion — pull a social video into storage, trim video/audio, save a URL to storage, probe metadata",
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
