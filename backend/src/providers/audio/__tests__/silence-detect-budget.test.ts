// silence-detect's declared budget is the sum of its steps' ceilings, each named
// here — so a step added without its ceiling is a visible edit, not a silent
// undercount (the media proxy's source fetch now runs up to an hour, Track 0.19).
import { describe, it, expect } from "vitest"
import { SILENCE_DETECT_BUDGET_MS, silenceDetectJobBudgetMs } from "../silence-detect-budget.js"
import { DEFAULT_FFMPEG_TIMEOUT_MS, DOWNLOAD_MAX_MS, DOWNLOAD_TIMEOUT_MS, FFPROBE_TIMEOUT_MS, MEDIA_PROXY_FFMPEG_TIMEOUT_MS } from "../../video/ffmpeg-timeouts.js"
import { NODE_TIMEOUT_MS } from "../../../services/workflow-engine/types.js"

describe("silence-detect liveness budget", () => {
  it("the source fetch (big-media ceiling) + audio-track probe + proxy encode, the proxy fetch, one silencedetect pass, one duration probe", () => {
    expect(SILENCE_DETECT_BUDGET_MS).toBe(
      DOWNLOAD_MAX_MS + FFPROBE_TIMEOUT_MS + MEDIA_PROXY_FFMPEG_TIMEOUT_MS
      + DOWNLOAD_TIMEOUT_MS + DEFAULT_FFMPEG_TIMEOUT_MS + FFPROBE_TIMEOUT_MS,
    )
  })
  it("exceeds the 90-minute default — the reason it declares one at all", () => {
    expect(SILENCE_DETECT_BUDGET_MS).toBeGreaterThan(NODE_TIMEOUT_MS)
  })
  it("reads the job payload; no source → no declared budget", () => {
    expect(silenceDetectJobBudgetMs({ audioUrl: "https://x.test/a.m4a" })).toBe(SILENCE_DETECT_BUDGET_MS)
    expect(silenceDetectJobBudgetMs({})).toBeUndefined()
    expect(silenceDetectJobBudgetMs(null)).toBeUndefined()
  })
})
