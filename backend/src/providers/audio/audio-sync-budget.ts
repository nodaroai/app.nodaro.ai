/**
 * audio-sync's step ceilings and liveness budget — PURE (imports only the
 * dependency-free ceiling leaf), so the workflow orchestrator and the video
 * worker's heartbeat can size an audio-sync job without loading the ffmpeg
 * runtime (the same arrangement as `apply-edl-budget.ts`).
 *
 * The node does not know how long its sources are until it has fetched them,
 * so every step is charged at its own fixed ceiling — never a guess from a
 * duration it cannot see yet. The sum is a hung-detector bound, not an estimate:
 * a real run on cached proxies takes seconds per source.
 */
import {
  DEFAULT_FFMPEG_TIMEOUT_MS,
  DOWNLOAD_MAX_MS,
  DOWNLOAD_TIMEOUT_MS,
  FFPROBE_TIMEOUT_MS,
  MEDIA_PROXY_FFMPEG_TIMEOUT_MS,
} from "../video/ffmpeg-timeouts.js"

export const AUDIO_SYNC_MIN_SOURCES = 2
export const AUDIO_SYNC_MAX_SOURCES = 6

/** Ceiling of one full-length decode to the 8 kHz onset envelope. Decoding the
 *  16 kHz mono proxy runs far faster than real time (hours of audio in
 *  minutes); this is a backstop for a hung ffmpeg. */
export const AUDIO_SYNC_ENVELOPE_DECODE_TIMEOUT_MS = 30 * 60_000

/** Ceiling of one fine-pass window decode (≤ ~31 s of audio after a seek). */
export const AUDIO_SYNC_WINDOW_DECODE_TIMEOUT_MS = 2 * 60_000

/** Fine-pass windows per source (start / middle / end of the overlap). */
export const AUDIO_SYNC_FINE_WINDOWS = 3

/** Ceiling of everything one source costs, in the order the node runs it: its
 *  audio proxy on a cache miss (`ensureMediaProxy` fetches the source under the
 *  big-media download ceiling, checks it has an audio track — one ffprobe — then
 *  encodes it), the proxy fetch (the flat 120 s: a 16 kHz mono proxy is small),
 *  the duration probe, the envelope decode, and —
 *  for each fine window — a reference window and a source window decode.
 *  Correlation itself is in-process arithmetic well inside the per-source slack.
 *  Not counted, as for every storage call: the proxy's R2 upload (the R2 client
 *  has no request timeout — Track 0.12). */
export const AUDIO_SYNC_PER_SOURCE_BUDGET_MS =
  DOWNLOAD_MAX_MS + FFPROBE_TIMEOUT_MS + MEDIA_PROXY_FFMPEG_TIMEOUT_MS + DOWNLOAD_TIMEOUT_MS + FFPROBE_TIMEOUT_MS
  + AUDIO_SYNC_ENVELOPE_DECODE_TIMEOUT_MS
  + AUDIO_SYNC_FINE_WINDOWS * 2 * AUDIO_SYNC_WINDOW_DECODE_TIMEOUT_MS

/** The handler's liveness budget for `sourceCount` sources (clamped to the
 *  node's 2..6), plus one default ffmpeg ceiling of slack for the run itself. */
export function audioSyncRenderBudgetMs(sourceCount: number): number {
  const n = Math.min(AUDIO_SYNC_MAX_SOURCES, Math.max(AUDIO_SYNC_MIN_SOURCES, Math.floor(sourceCount)))
  return n * AUDIO_SYNC_PER_SOURCE_BUDGET_MS + DEFAULT_FFMPEG_TIMEOUT_MS
}

/** The budget of ONE audio-sync job, read off its queue payload; `undefined`
 *  (every reader keeps its default) when the payload names no usable sources. */
export function audioSyncJobBudgetMs(data: unknown): number | undefined {
  if (!data || typeof data !== "object") return undefined
  const { sources } = data as { sources?: unknown }
  if (!Array.isArray(sources) || sources.length < AUDIO_SYNC_MIN_SOURCES) return undefined
  return audioSyncRenderBudgetMs(sources.length)
}
