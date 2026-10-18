/**
 * Speaker Map's step ceilings and liveness budget (decided 2026-10-17) — PURE
 * (imports only the dependency-free ceiling leaf), like audio-sync-budget.ts,
 * so the orchestrator and the video worker's heartbeat can size a run without
 * loading the ffmpeg runtime. Each source is charged its proxy steps (the same
 * ones Audio Sync charges: the original's fetch + probe + proxy encode, the
 * proxy fetch, the duration probe) and ONE whole-source decode — no windows,
 * unlike Audio Sync. A hung-detector bound, not an estimate.
 */
import {
  DEFAULT_FFMPEG_TIMEOUT_MS,
  DOWNLOAD_MAX_MS,
  DOWNLOAD_TIMEOUT_MS,
  FFPROBE_TIMEOUT_MS,
  MEDIA_PROXY_FFMPEG_TIMEOUT_MS,
} from "../video/ffmpeg-timeouts.js"

/** The most sources one job reads (the published contract's limit; the node's
 *  route refuses more, so the budget is never sized past it). */
export const SPEAKER_MAP_BUDGET_MAX_SOURCES = 6
/** One whole-source decode at 8 kHz mono (a 3-hour source decodes well inside it). */
export const SPEAKER_MAP_DECODE_TIMEOUT_MS = 30 * 60_000
/** One source: its proxy steps and its decode. */
export const SPEAKER_MAP_PER_SOURCE_BUDGET_MS =
  DOWNLOAD_MAX_MS + FFPROBE_TIMEOUT_MS + MEDIA_PROXY_FFMPEG_TIMEOUT_MS + DOWNLOAD_TIMEOUT_MS + FFPROBE_TIMEOUT_MS
  + SPEAKER_MAP_DECODE_TIMEOUT_MS

/** The budget of ONE speaker-map job, read off its queue payload (the source count clamped to the limit); undefined (every reader keeps its default) when it names no sources. */
export function speakerMapJobBudgetMs(data: unknown): number | undefined {
  if (!data || typeof data !== "object") return undefined
  const { sources } = data as { sources?: unknown }
  if (!Array.isArray(sources) || sources.length === 0) return undefined
  return Math.min(SPEAKER_MAP_BUDGET_MAX_SOURCES, sources.length) * SPEAKER_MAP_PER_SOURCE_BUDGET_MS + DEFAULT_FFMPEG_TIMEOUT_MS
}
