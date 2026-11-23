import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * The workflow run's measurement of an LTX 2.5 Fast audio-to-video clip
 * (decided 2026-11-23): the same rule the routes price by, stamped on the
 * payload before the reservation; a clip the routes refuse is refused here too.
 */
vi.mock("../lip-sync-inputs.js", () => ({ measureAudio: vi.fn() }))
vi.mock("../url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})

import { measureAudio } from "../lip-sync-inputs.js"
import { stampDrivingAudioRun } from "../driving-audio-measure.js"

const AUDIO = "https://cdn.example/voice.wav"
const base = { provider: "ltx-2.5-fast", duration: 6, resolution: "720p", fps: 24, referenceAudioUrls: [AUDIO], drivingAudioPending: true }

beforeEach(() => vi.clearAllMocks())

describe("stampDrivingAudioRun", () => {
  it("stamps the measured length, the billed seconds and the row; the pending mark is gone", async () => {
    vi.mocked(measureAudio).mockResolvedValue({ kind: "measured", length: { overCap: false, samples: 1, seconds: 12.31 } } as never)
    const out = await stampDrivingAudioRun({ ...base }, "ltx-2.5-fast:6s:720p", "u1")
    expect(out).toMatchObject({
      ok: true,
      modelIdentifier: "ltx-2.5-fast:13s:720p",
      payload: { duration: 12.26, resolution: "720p", audioToVideo: true, drivingAudioSec: 12.31, drivingAudioBilledSec: 13 },
    })
    if (out.ok) expect(out.payload.drivingAudioPending).toBeUndefined()
  })

  it("refuses what the routes refuse: too short, too long at 48 fps, two clips", async () => {
    vi.mocked(measureAudio).mockResolvedValue({ kind: "measured", length: { overCap: false, samples: 1, seconds: 1.2 } } as never)
    expect(await stampDrivingAudioRun({ ...base }, "x", "u1")).toMatchObject({ ok: false, code: "audio_too_short" })
    vi.mocked(measureAudio).mockResolvedValue({ kind: "measured", length: { overCap: true } } as never)
    expect(await stampDrivingAudioRun({ ...base, fps: 48 }, "x", "u1")).toMatchObject({ ok: false, code: "audio_too_long" })
    expect(await stampDrivingAudioRun({ ...base, referenceAudioUrls: [AUDIO, AUDIO] }, "x", "u1")).toMatchObject({ ok: false })
  })

  it("leaves a payload that is not marked untouched, and does not measure", async () => {
    const payload = { provider: "ltx-2.5-fast", duration: 6 }
    expect(await stampDrivingAudioRun(payload, "ltx-2.5-fast:6s:1080p", "u1")).toEqual({ ok: true, payload, modelIdentifier: "ltx-2.5-fast:6s:1080p" })
    expect(measureAudio).not.toHaveBeenCalled()
  })
})
