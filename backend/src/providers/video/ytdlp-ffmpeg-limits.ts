/**
 * What a re-encoding yt-dlp run tells its OWN ffmpeg, and what it reserves for it
 * (round 4 of #1860, decided 2026-10-05).
 *
 * yt-dlp starts ffmpeg itself — as the downloader of a section cut and as the
 * post-processor of an audio conversion, a recode, a cut by chapter — so that
 * child is not the backend's launcher: left alone it counts the host's cores for
 * its decoders, filter graph and x264 frame threads, the 4K OOM again. A run the
 * classifier says may ENCODE (`ytdlp-transcode.ts`) therefore gets:
 *
 *  1. THE QUOTA'S THREAD COUNTS (`ytDlpThreadArgs`) — the same values every
 *     ffmpeg the backend starts is given (`ffmpegThreads()`, #1813/#1841), in
 *     the places ffmpeg binds them: `-threads` before each `-i` (the decoders),
 *     `-filter_threads`/`-filter_complex_threads` and `-threads` before the
 *     output (the filter graph, the encoder). Nothing when no quota sits below the
 *     cores ffmpeg counts — its own detection is then already the budget.
 *  2. A RESERVATION SIZED BY WHAT IT WAS ASKED FOR (`ytDlpPeakMemoryMiB`) — the
 *     measured canvas model at the requested format's resolution, one segment, at
 *     the threads the child will run with; the audio estimate for an audio
 *     extraction or an audio-only format.
 *
 * HOW yt-dlp ROUTES THE ARGUMENTS (probed against the release's source and a
 * logging ffmpeg shim, 2026.08.19 — the key rules have been stable for years):
 *  - `--downloader-args ffmpeg_i:ARGS` / `ffmpeg_o:ARGS` reach the ffmpeg
 *    DOWNLOADER (a section cut): `_i` before each `-i`, `_o` before the output.
 *  - `--postprocessor-args NAME+ffmpeg_i:ARGS` / `NAME+ffmpeg_o:ARGS` reach the
 *    ffmpeg a POST-PROCESSOR runs. The post-processor's own name is REQUIRED:
 *    a bare `ffmpeg_i:` / `ffmpeg_o:` key matches only the downloader, and a bare
 *    `ffmpeg:` only the output side of one — a pin spelled that way leaves the
 *    decoders of an `-x` or `--recode-video` run on the host's core count.
 *  - The post-processors that can encode are the ones the classifier names:
 *    ExtractAudio (`-x --audio-format mp3`), VideoConvertor (`--recode-video`),
 *    ModifyChapters and SplitChapters (a cut at forced keyframes). Merging,
 *    remuxing, embedding and fixups copy streams, and a thumbnail is one still.
 *
 * Pure.
 */
import { canvasPeakMemoryMiB, audioPeakMemoryMiB, UHD_CANVAS } from "./ffmpeg-memory-model.js"
import type { FfmpegThreads } from "./ffmpeg-threads.js"
import { CUTS, parseFlags } from "./ytdlp-transcode.js"

/** The yt-dlp post-processors whose ffmpeg may ENCODE (their `--postprocessor-args` names). */
export const YTDLP_ENCODING_POSTPROCESSORS = ["ExtractAudio", "VideoConvertor", "ModifyChapters", "SplitChapters"] as const

/**
 * The flags that hand `threads` to every ffmpeg a transcoding yt-dlp run starts:
 * appended to the run's argv. `[]` when `threads` is undefined (no quota below
 * the cores ffmpeg counts).
 */
export function ytDlpThreadArgs(threads: FfmpegThreads | undefined): string[] {
  if (!threads) return []
  const decode = `-threads ${threads.decode}`
  const encode = `-filter_threads ${threads.filter} -filter_complex_threads ${threads.filter} -threads ${threads.encode}`
  return [
    "--downloader-args", `ffmpeg_i:${decode}`,
    "--downloader-args", `ffmpeg_o:${encode}`,
    ...YTDLP_ENCODING_POSTPROCESSORS.flatMap((pp) => [
      "--postprocessor-args", `${pp}+ffmpeg_i:${decode}`,
      "--postprocessor-args", `${pp}+ffmpeg_o:${encode}`,
    ]),
  ]
}

/** An audio-only `--format` selector: every `/` branch is `ba`/`bestaudio`/`wa`/`worstaudio` (with filters), never `ba*` (which may carry a picture) or a `+` merge. */
const AUDIO_ONLY_BRANCH = /^(?:ba|bestaudio|wa|worstaudio)(?:\[[^\]]*\])*$/

function isAudioOnlySelector(selector: string): boolean {
  return selector.split("/").every((branch) => AUDIO_ONLY_BRANCH.test(branch.trim()))
}

/** The tallest `height<=N` / `height<N` / `height=N` a selector asks for: the cap the lane requests. */
function requestedHeight(selector: string): number | undefined {
  const heights = [...selector.matchAll(/\bheight\s*(?:<=?|=)\s*\??\s*(\d+)/g)].map((m) => Number(m[1])).filter((h) => h > 0)
  return heights.length > 0 ? Math.max(...heights) : undefined
}

/** The canvas of a capped format: 16:9 at the cap (yt-dlp states a height, never a width). */
function cappedCanvas(height: number): { width: number; height: number } {
  return { width: Math.round((height * 16) / 9), height }
}

/**
 * What a transcoding run's ffmpeg is predicted to need at its peak, in MiB —
 * read from the flags (so the library lanes, spelled as options objects, size
 * the same way):
 *  - an audio extraction (`-x`) with no video encode, or an audio-only `--format`
 *    (the audio half of an HD section): the audio estimate;
 *  - otherwise the canvas model for ONE segment at the picture the format asks for:
 *    its `height<=N` cap at 16:9, or — a lane that asks for none, a resolution the
 *    flags cannot give — 4K;
 *  at `threads`, the counts the child runs with (`ffmpegEffectiveThreads()`).
 */
export function ytDlpPeakMemoryMiB(args: readonly string[], threads: FfmpegThreads): number {
  const flags = parseFlags(args)
  const encodesVideo = flags.has("--recode-video") || (flags.has("--force-keyframes-at-cuts") && CUTS.some((cut) => flags.has(cut)))
  const format = flags.get("--format")
  const selector = typeof format === "string" ? format : undefined
  if ((flags.has("--extract-audio") && !encodesVideo) || (selector !== undefined && isAudioOnlySelector(selector))) {
    return audioPeakMemoryMiB()
  }
  const height = selector === undefined ? undefined : requestedHeight(selector)
  return canvasPeakMemoryMiB(height === undefined ? UHD_CANVAS : cappedCanvas(height), 1, threads)
}
