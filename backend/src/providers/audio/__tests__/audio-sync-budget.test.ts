// audio-sync's liveness budget is the sum of the ceilings of the steps it runs
// per source, in order — each named here, so a step added to the node without
// its ceiling (the source fetch inside `ensureMediaProxy` was once missed) is a
// visible edit to this list, not a silent undercount.
import { describe, it, expect } from "vitest"
import {
  AUDIO_SYNC_ENVELOPE_DECODE_TIMEOUT_MS,
  AUDIO_SYNC_FINE_WINDOWS,
  AUDIO_SYNC_PER_SOURCE_BUDGET_MS,
  AUDIO_SYNC_WINDOW_DECODE_TIMEOUT_MS,
  audioSyncJobBudgetMs,
  audioSyncRenderBudgetMs,
} from "../audio-sync-budget.js"
import { DEFAULT_FFMPEG_TIMEOUT_MS, DOWNLOAD_TIMEOUT_MS, FFPROBE_TIMEOUT_MS, MEDIA_PROXY_FFMPEG_TIMEOUT_MS } from "../../video/ffmpeg-timeouts.js"

describe("audio-sync liveness budget", () => {
  it("per source: the source fetch + audio-track probe + proxy encode (cache miss), the proxy fetch, the probe, the envelope decode, two decodes per fine window", () => {
    expect(AUDIO_SYNC_PER_SOURCE_BUDGET_MS).toBe(
      DOWNLOAD_TIMEOUT_MS + FFPROBE_TIMEOUT_MS + MEDIA_PROXY_FFMPEG_TIMEOUT_MS
      + DOWNLOAD_TIMEOUT_MS
      + FFPROBE_TIMEOUT_MS
      + AUDIO_SYNC_ENVELOPE_DECODE_TIMEOUT_MS
      + AUDIO_SYNC_FINE_WINDOWS * 2 * AUDIO_SYNC_WINDOW_DECODE_TIMEOUT_MS,
    )
  })
  it("scales with the source count, clamped to the node's 2..6, plus one default ceiling", () => {
    expect(audioSyncRenderBudgetMs(3)).toBe(3 * AUDIO_SYNC_PER_SOURCE_BUDGET_MS + DEFAULT_FFMPEG_TIMEOUT_MS)
    expect(audioSyncRenderBudgetMs(1)).toBe(audioSyncRenderBudgetMs(2))
    expect(audioSyncRenderBudgetMs(9)).toBe(audioSyncRenderBudgetMs(6))
  })
  it("reads the job payload; no usable sources → no declared budget (readers keep their defaults)", () => {
    expect(audioSyncJobBudgetMs({ sources: [{}, {}, {}, {}] })).toBe(audioSyncRenderBudgetMs(4))
    expect(audioSyncJobBudgetMs({ sources: [{}] })).toBeUndefined()
    expect(audioSyncJobBudgetMs({})).toBeUndefined()
    expect(audioSyncJobBudgetMs(null)).toBeUndefined()
  })
})
