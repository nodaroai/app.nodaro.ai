import { describe, expect, it } from "vitest"
import { DRIVING_AUDIO_SEND_MARGIN_SEC, drivingAudioMaxSec, drivingAudioQuoteId, drivingAudioRun, isDrivingAudioRun, takesDrivingAudio } from "../driving-audio.js"
import { freeVideoLock, freeVideoModelLock } from "../free-video-limits.js"
import { MODEL_CATALOG } from "../model-catalog.js"

/** Audio-to-video on LTX 2.5 Fast (decided 2026-11-23). */
describe("drivingAudioRun", () => {
  const run = (audioSec: number | undefined, resolution = "1080p", fps: unknown = 24) =>
    drivingAudioRun({ provider: "ltx-2.5-fast", resolution, fps, audioSec })

  it("only LTX 2.5 Fast takes a driving clip; Pro and LTX 2.3 do not", () => {
    expect(takesDrivingAudio("ltx-2.5-fast")).toBe(true)
    expect(takesDrivingAudio("ltx-2.5-pro")).toBe(false)
    expect(takesDrivingAudio("ltx-2.3-pro")).toBe(false)
    expect(isDrivingAudioRun("ltx-2.5-fast", 0)).toBe(false)
    expect(isDrivingAudioRun("ltx-2.5-fast", 1)).toBe(true)
    expect(MODEL_CATALOG["ltx-2.5-fast"]?.features).toContain("audio-to-video")
    expect(MODEL_CATALOG["ltx-2.5-pro"]?.features ?? []).not.toContain("audio-to-video")
  })

  it("prices the length rounded up to a whole second, and sends the length less a small margin", () => {
    expect(run(7.2)).toMatchObject({ ok: true, billedSec: 8, sentSec: 7.15, creditId: "ltx-2.5-fast:8s:1080p" })
    expect(run(7)).toMatchObject({ ok: true, billedSec: 7, sentSec: 6.95, creditId: "ltx-2.5-fast:7s:1080p" })
    expect(run(2.05)).toMatchObject({ ok: true, billedSec: 2, sentSec: 2 })
    expect(run(19.5)).toMatchObject({ ok: true, billedSec: 20, sentSec: 19.45 })
  })

  it("forgives a decoder's few hundredths past a whole second (the platform's 0.05 s grace)", () => {
    expect(run(7.04)).toMatchObject({ ok: true, billedSec: 7, sentSec: 6.99 })
    expect(run(7.06)).toMatchObject({ ok: true, billedSec: 8, sentSec: 7.01 })
    expect(run(20.03)).toMatchObject({ ok: true, billedSec: 20, sentSec: 19.98 })
  })

  it("the length sent is never more than the seconds held, and always stays the margin under the audio", () => {
    for (let hundredths = 200; hundredths <= 2005; hundredths += 1) {
      const audioSec = hundredths / 100
      const r = run(audioSec)
      if (!r.ok) continue
      expect(r.sentSec).toBeLessThanOrEqual(r.billedSec)
      expect(r.sentSec).toBeGreaterThanOrEqual(2)
      expect(r.sentSec).toBeLessThanOrEqual(audioSec - DRIVING_AUDIO_SEND_MARGIN_SEC + 1e-9)
    }
  })

  it("refuses a clip under 2 s, over 20 s, or one it could not measure, before anything is held", () => {
    expect(run(1.9)).toMatchObject({ ok: false, code: "audio_too_short" })
    // The shortest clip plus the margin the length sent keeps under it: 2.00-2.04 s is refused too.
    for (const s of [2, 2.02, 2.04]) {
      const r = run(s)
      expect(r, String(s)).toMatchObject({ ok: false, code: "audio_too_short" })
      if (!r.ok) expect(r.message).toContain("at least 2.05 s")
    }
    expect(run(20.2)).toMatchObject({ ok: false, code: "audio_too_long" })
    expect(run(undefined)).toMatchObject({ ok: false, code: "audio_unmeasured" })
    expect(run(Number.NaN)).toMatchObject({ ok: false, code: "audio_unmeasured" })
  })

  it("keeps the 10 s limit at 1440p and at 48 / 50 fps, naming the setting to change", () => {
    expect(drivingAudioMaxSec("ltx-2.5-fast", { resolution: "1440p" })).toBe(10)
    expect(drivingAudioMaxSec("ltx-2.5-fast", { resolution: "1080p", fps: 48 })).toBe(10)
    expect(drivingAudioMaxSec("ltx-2.5-fast", { resolution: "720p", fps: 25 })).toBe(20)
    expect(run(9.4, "1440p")).toMatchObject({ ok: true, creditId: "ltx-2.5-fast:10s:1440p" })
    const over = run(12, "1080p", 50)
    expect(over.ok).toBe(false)
    if (!over.ok) {
      expect(over.code).toBe("audio_too_long")
      expect(over.message).toContain("720p or 1080p at 24 or 25 fps")
    }
  })

  it("an unstated resolution is the tier's default (1080p), as the run sends it", () => {
    expect(drivingAudioRun({ provider: "ltx-2.5-fast", audioSec: 5 })).toMatchObject({ ok: true, creditId: "ltx-2.5-fast:5s:1080p" })
  })

  it("an estimate with no length, or one the run refuses, quotes the longest clip the run can hold", () => {
    expect(drivingAudioQuoteId({ provider: "ltx-2.5-fast", resolution: "720p", audioSec: undefined })).toBe("ltx-2.5-fast:20s:720p")
    expect(drivingAudioQuoteId({ provider: "ltx-2.5-fast", resolution: "1440p", audioSec: 30 })).toBe("ltx-2.5-fast:10s:1440p")
    expect(drivingAudioQuoteId({ provider: "ltx-2.5-fast", resolution: "720p", audioSec: 3.2 })).toBe("ltx-2.5-fast:4s:720p")
  })
})

describe("free credits: an audio-driven LTX 2.5 Fast run", () => {
  const limits = { enabled: true, maxSeconds: 4 } as const

  it("its text and image runs stay locked (their shortest clip is 6 s); an audio-driven one is judged by 2 s", () => {
    expect(freeVideoModelLock("ltx-2.5-fast", limits)).toMatchObject({ kind: "shortest" })
    expect(freeVideoModelLock("ltx-2.5-fast", limits, { audioDriven: true })).toBeNull()
    // Pro has no audio-driven run: the flag changes nothing there.
    expect(freeVideoModelLock("ltx-2.5-pro", limits, { audioDriven: true })).not.toBeNull()
  })

  it("is open at 720p for audio up to 4 s, and locked above 4 s or above 720p", () => {
    const req = (duration: number, resolution: string) => ({ provider: "ltx-2.5-fast", duration, resolution, videoSize: null, audioDriven: true })
    expect(freeVideoLock(req(4, "720p"), limits)).toBeNull()
    expect(freeVideoLock(req(2, "720p"), limits)).toBeNull()
    expect(freeVideoLock(req(5, "720p"), limits)).toMatchObject({ kind: "duration" })
    expect(freeVideoLock(req(4, "1080p"), limits)).toMatchObject({ kind: "resolution" })
  })
})
