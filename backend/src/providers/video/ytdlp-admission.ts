/**
 * The admission around a yt-dlp run (rounds 3 and 4 of #1860, decided 2026-10-05).
 *
 * yt-dlp's own ffmpeg is invisible to the launcher (`ytdlp-transcode.ts`). A run
 * that may RE-ENCODE — a section cut at keyframes, an audio conversion — holds
 * one ffmpeg slot and reserves memory for the whole download, through the same
 * admission as every other ffmpeg: it waits when the box is full, never fails
 * for it, and the wait is a slot wait to the job's slot-wait ledger. A run that
 * only copies streams is not delayed at all.
 *
 *  - The child is TOLD its threads and the reservation is SIZED to the request
 *    (`ytdlp-ffmpeg-limits.ts`): the argv the run spawns carries the quota's
 *    thread counts (`YtDlpHold.args`), and the reservation is the measured canvas
 *    model at the requested format's resolution — the audio estimate for an audio
 *    extraction — at the threads it will run with. A caller spawns `hold.args`,
 *    never its own argv, so a new transcoding lane is pinned by construction.
 *  - It spans the download, network time included: nothing can say when yt-dlp's
 *    ffmpeg is busy, so the hold is the whole run.
 *  - The hold's ceiling is `YTDLP_TRANSCODE_HOLD_MS`. A yt-dlp download has no
 *    total cap of its own (only an idle watchdog and, in the hardened lane, the
 *    fetch's deadline), and a hold must be bounded or a stuck run would hold the
 *    slot — and its memory — forever. The ceiling is ALSO the process's own: the
 *    run is handed the hold (`YtDlpHold`) and its process GROUP must die by it
 *    (yt-dlp and the ffmpeg it started — `ytdlp-process.ts`), so the reservation
 *    never outlives the ffmpeg it stands for. A run that still has not settled
 *    past the ceiling plus the kill grace and the backstop releases its slot and
 *    reservation, and is reported as a HALT (`out_of_time`): no client rung or
 *    proxy attempt may start a second yt-dlp ffmpeg beside a first that may still
 *    be alive.
 *  - A fetch's deadline (`FetchDeadline`) is excused for the wait, like every
 *    other caller of the admission.
 *  - `youtube-dl-exec` cannot be held: it stops its child by Node's `signal`,
 *    which reaches yt-dlp and not the ffmpeg under it. Its one caller (trim-audio)
 *    only merges, and `withYtDlpOptionsAdmission` refuses a library run that
 *    would encode — those go through `runYtDlpOptions` (`ytdlp-options-run.ts`).
 */
import { withFfmpegSlot, type WaitExcusedDeadline } from "./ffmpeg-utils.js"
import { ffmpegEffectiveThreads, ffmpegThreads } from "./ffmpeg-threads.js"
import { ytDlpPeakMemoryMiB, ytDlpThreadArgs } from "./ytdlp-ffmpeg-limits.js"
import { YtDlpHaltError } from "./ytdlp-process.js"
import { ytDlpOptionsToArgs, ytDlpTranscodeReason } from "./ytdlp-transcode.js"

/** The longest a re-encoding yt-dlp run holds its slot: a very slow section of a long video fits, a hang does not live forever. */
export const YTDLP_TRANSCODE_HOLD_MS = 30 * 60 * 1000

export interface YtDlpAdmissionOptions {
  /** The hold's ceiling; `YTDLP_TRANSCODE_HOLD_MS` when omitted (a seam for tests that run a real process). */
  readonly holdMs?: number
  readonly signal?: AbortSignal
  /** The fetch's deadline, when held to one: the admission wait is excused from it. */
  readonly deadline?: WaitExcusedDeadline
}

/** What a re-encoding run is held to: it must be over by `holdMs` after admission, or killed by `signal`. */
export interface YtDlpHold {
  /** The argv to spawn: the run's own flags plus the quota's thread counts for the ffmpeg yt-dlp starts. */
  readonly args: readonly string[]
  readonly holdMs: number
  /** Aborts when the hold's ceiling is reached; a run that cannot be killed by it is cut off by the slot's backstop. */
  readonly signal: AbortSignal
}

/**
 * Run `run` (one yt-dlp invocation with `args`) — behind the ffmpeg admission
 * when the flags make it re-encode, at once when they do not. `run` is called
 * AFTER admission, so it may read what is left of a deadline then; it gets the
 * hold it must end by and the argv to spawn (`undefined` for a run that holds
 * nothing and spawns its own `args`).
 */
export async function withYtDlpAdmission<T>(
  args: readonly string[],
  run: (hold?: YtDlpHold) => Promise<T>,
  opts: YtDlpAdmissionOptions = {},
): Promise<T> {
  const why = ytDlpTranscodeReason(args)
  if (why === undefined) return run()
  if (opts.signal?.aborted) throw new YtDlpHaltError("yt-dlp aborted", "aborted")
  const holdMs = opts.holdMs ?? YTDLP_TRANSCODE_HOLD_MS
  // What the run's ffmpeg will be told, and what it is reserved: the quota's counts (none when no quota
  // sits below the cores ffmpeg counts) and the memory those counts and the requested format predict.
  const pinned = [...args, ...ytDlpThreadArgs(ffmpegThreads())]
  const peakMemoryMiB = ytDlpPeakMemoryMiB(args, ffmpegEffectiveThreads())
  const hold = new AbortController()
  let settled = false
  try {
    return await withFfmpegSlot(
      () => {
        // Started once the run is admitted, like the slot's own clock.
        const ceiling = setTimeout(() => hold.abort(), holdMs)
        return run({ args: pinned, holdMs, signal: hold.signal }).finally(() => {
          settled = true
          clearTimeout(ceiling)
        })
      },
      {
        timeoutMs: holdMs,
        signal: opts.signal,
        deadline: opts.deadline,
        label: `yt-dlp (${why})`,
        peakMemoryMiB,
      },
    )
  } catch (error) {
    // The abort that ended the wait is the halt yt-dlp itself raises.
    if (opts.signal?.aborted && !(error instanceof YtDlpHaltError)) throw new YtDlpHaltError("yt-dlp aborted", "aborted")
    if (error instanceof YtDlpHaltError) throw error
    // Over the hold: whatever the process threw as it was stopped — or the backstop's
    // timeout for a run that never settled — is a HALT. An ordinary failure would start the next rung.
    if (hold.signal.aborted || !settled) {
      throw new YtDlpHaltError(
        `yt-dlp held its ffmpeg slot past ${Math.round(holdMs / 1000)} s; the run was stopped`,
        "out_of_time",
      )
    }
    throw error
  }
}

/**
 * {@link withYtDlpAdmission} for a `youtube-dl-exec` call: its options object,
 * classified as the flags it becomes. The library stops its child by Node's
 * `signal`, which cannot reach the ffmpeg under yt-dlp, so a run that would
 * ENCODE is refused here — it goes through `runYtDlpOptions`, which owns the
 * process group.
 */
export async function withYtDlpOptionsAdmission<T>(options: Readonly<Record<string, unknown>>, run: () => Promise<T>): Promise<T> {
  const why = ytDlpTranscodeReason(ytDlpOptionsToArgs(options))
  if (why !== undefined) {
    throw new Error(`youtube-dl-exec cannot hold a yt-dlp run that encodes (${why}): use runYtDlpOptions`)
  }
  return run()
}
