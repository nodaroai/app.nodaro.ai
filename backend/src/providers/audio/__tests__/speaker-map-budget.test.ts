// Speaker Map's liveness budget is the sum of the ceilings of the steps it runs
// per source, in order — each named here, so a step added to the job without its
// ceiling is a visible edit to this list, not a silent undercount.
import { describe, it, expect } from "vitest"
import { SPEAKER_MAP_BUDGET_MAX_SOURCES, SPEAKER_MAP_DECODE_TIMEOUT_MS, SPEAKER_MAP_PER_SOURCE_BUDGET_MS, speakerMapJobBudgetMs } from "../speaker-map-budget.js"
import { DEFAULT_FFMPEG_TIMEOUT_MS, DOWNLOAD_MAX_MS, DOWNLOAD_TIMEOUT_MS, FFPROBE_TIMEOUT_MS, MEDIA_PROXY_FFMPEG_TIMEOUT_MS } from "../../video/ffmpeg-timeouts.js"

describe("Speaker Map liveness budget", () => {
  it("per source: the source fetch + audio-track probe + proxy encode (cache miss), the proxy fetch, the probe, ONE whole-source decode", () => {
    expect(SPEAKER_MAP_PER_SOURCE_BUDGET_MS).toBe(
      DOWNLOAD_MAX_MS + FFPROBE_TIMEOUT_MS + MEDIA_PROXY_FFMPEG_TIMEOUT_MS
      + DOWNLOAD_TIMEOUT_MS
      + FFPROBE_TIMEOUT_MS
      + SPEAKER_MAP_DECODE_TIMEOUT_MS,
    )
    expect(SPEAKER_MAP_DECODE_TIMEOUT_MS).toBe(30 * 60_000)
  })
  it("a job's budget scales with its sources, plus one default ceiling", () => {
    expect(speakerMapJobBudgetMs({ sources: [{ id: "a" }, { id: "b" }] })).toBe(2 * SPEAKER_MAP_PER_SOURCE_BUDGET_MS + DEFAULT_FFMPEG_TIMEOUT_MS)
  })
  it("the source count is clamped to the limit (6), like audio-sync's", () => {
    expect(SPEAKER_MAP_BUDGET_MAX_SOURCES).toBe(6)
    const many = { sources: Array.from({ length: 9 }, (_, i) => ({ id: `s${i}` })) }
    expect(speakerMapJobBudgetMs(many)).toBe(6 * SPEAKER_MAP_PER_SOURCE_BUDGET_MS + DEFAULT_FFMPEG_TIMEOUT_MS)
  })
  it("a payload that names no sources keeps every reader's default", () => {
    expect(speakerMapJobBudgetMs(null)).toBeUndefined()
    expect(speakerMapJobBudgetMs({})).toBeUndefined()
    expect(speakerMapJobBudgetMs({ sources: [] })).toBeUndefined()
  })
})
