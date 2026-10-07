/**
 * yt-dlp run from an OPTIONS OBJECT, the way the audio lanes spell it
 * (`routes/youtube-audio.ts`, `workers/shared.ts :: downloadAudioToR2`) — round 4
 * of #1860, decided 2026-10-05.
 *
 * These lanes used `youtube-dl-exec`, which stops its child with Node's `signal`:
 * that reaches yt-dlp alone, so the ffmpeg it started (`-x --audio-format mp3`)
 * could outlive the 30-minute hold that reserves its memory. They now spawn
 * yt-dlp as its OWN PROCESS GROUP (`ytdlp-process.ts`) and, at the hold or an
 * abort, kill the GROUP — yt-dlp and its ffmpeg both — behind the same admission
 * as every other re-encoding run (`withYtDlpAdmission`: the quota's thread counts
 * in the argv, a reservation sized to the request).
 *
 * The failure keeps the shape `youtube-dl-exec` gave: an Error whose message is
 * stderr, with `stderr`, `stdout` and `exitCode` attached.
 */
import { ytDlpBin } from "./ytdlp-bin.js"
import { withYtDlpAdmission, type YtDlpAdmissionOptions } from "./ytdlp-admission.js"
import { runYtDlpToEndWith } from "./ytdlp-process.js"
import { ytDlpOptionsToArgs } from "./ytdlp-transcode.js"

export function runYtDlpOptions(
  url: string,
  options: Readonly<Record<string, unknown>>,
  opts: YtDlpAdmissionOptions & {
    /** The yt-dlp to run; the platform's own when omitted (a seam for tests that run a real process). */
    readonly bin?: string
  } = {},
): Promise<void> {
  const args = [url, ...ytDlpOptionsToArgs(options)]
  return withYtDlpAdmission(
    args,
    // A run that holds nothing spawns its own argv; a held one spawns the pinned one, dying by the hold.
    (hold) => runYtDlpToEndWith(opts.bin ?? ytDlpBin(), hold?.args ?? args, { ...(hold ? { totalTimeoutMs: hold.holdMs } : {}), signal: opts.signal }),
    opts,
  )
}
