import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * LTX 2.5 Fast audio-to-video's measurement through the real reader
 * (`measureAudio`): only the download, the stream probe and the decoder are
 * stood in, so the decoder's own answers drive the rule (decided 2026-11-23).
 */
const probes = vi.hoisted(() => ({
  decoded: { overCap: false, samples: 1, seconds: 5 } as { overCap: true } | { overCap: false; samples: number; seconds: number },
  hasVideo: false,
  formats: undefined as readonly string[] | undefined,
  capSec: 0,
}))
vi.mock("@/providers/video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/providers/video/ffmpeg-utils.js")>()),
  downloadFile: async (_url: string, path: string) => {
    const { writeFile } = await import("node:fs/promises")
    await writeFile(path, Buffer.alloc(1000))
  },
  probeMediaStreams: async () => ({ hasVideo: probes.hasVideo, hasAudio: true }),
}))
vi.mock("@/providers/video/decoded-audio-length.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/providers/video/decoded-audio-length.js")>()),
  measureDecodedAudio: async (_path: string, opts: { capSec: number; formats?: readonly string[] }) => {
    probes.formats = opts.formats
    probes.capSec = opts.capSec
    return probes.decoded
  },
}))
vi.mock("../url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})
const slots = vi.hoisted(() => ({ waits: [] as number[] }))
vi.mock("../lip-sync-download-slots.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lip-sync-download-slots.js")>()
  return {
    ...actual,
    lipSyncMeasureSlots: {
      acquire: async (_u: string | undefined, o: { waitMs: number }) => (slots.waits.push(o.waitMs), true),
      release: () => {},
    },
  }
})

import { measureDrivingAudio, stampDrivingAudioRun, DRIVING_AUDIO_FORMATS } from "../driving-audio-measure.js"
import { LIP_SYNC_MEASURE_SLOT_WAIT_MS, LIP_SYNC_RUN_MEASURE_SLOT_WAIT_MS } from "../lip-sync-download-slots.js"

const AUDIO = "https://cdn.example/a.mp3"

beforeEach(() => {
  probes.decoded = { overCap: false, samples: 1, seconds: 5 }
  probes.hasVideo = false
  slots.waits = []
})

describe("measureDrivingAudio, through the real reader", () => {
  it("a decode stopped past the limit is refused as longer than the limit, stating no length it never read", async () => {
    probes.decoded = { overCap: true }
    const out = await measureDrivingAudio({ provider: "ltx-2.5-fast", audioUrl: AUDIO, resolution: "1080p", fps: 24 })
    expect(out).toMatchObject({ ok: false, code: "audio_too_long" })
    if (!out.ok) {
      expect(out.message).toMatch(/at most 20 s of audio; this clip is longer/)
      expect(out.message).not.toMatch(/\d+\.\d s/)
    }
    // The decode stops one grace past the limit at this setting.
    expect(probes.capSec).toBeCloseTo(20.05, 6)
  })

  it("at 1440p the over-limit refusal names the setting to change", async () => {
    probes.decoded = { overCap: true }
    const out = await measureDrivingAudio({ provider: "ltx-2.5-fast", audioUrl: AUDIO, resolution: "1440p" })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.message).toMatch(/at most 10 s of audio at 1440p.*720p or 1080p/)
    expect(probes.capSec).toBeCloseTo(10.05, 6)
  })

  it("a file with a picture (an MP4 / MOV wired as audio) is refused before the hold", async () => {
    probes.hasVideo = true
    expect(await measureDrivingAudio({ provider: "ltx-2.5-fast", audioUrl: AUDIO })).toMatchObject({ ok: false, code: "audio_has_video" })
  })

  it("decodes only the containers the endpoint takes", async () => {
    await measureDrivingAudio({ provider: "ltx-2.5-fast", audioUrl: AUDIO })
    expect(probes.formats).toEqual(DRIVING_AUDIO_FORMATS)
  })

  it("a request waits the request's slot time; the workflow run waits the run's, as Lip Sync's does", async () => {
    await measureDrivingAudio({ provider: "ltx-2.5-fast", audioUrl: AUDIO })
    await stampDrivingAudioRun({ provider: "ltx-2.5-fast", referenceAudioUrls: [AUDIO], drivingAudioPending: true }, "x", "u1")
    expect(slots.waits).toEqual([LIP_SYNC_MEASURE_SLOT_WAIT_MS, LIP_SYNC_RUN_MEASURE_SLOT_WAIT_MS])
  })

  it("sends a little under the measured length, never above the seconds held", async () => {
    probes.decoded = { overCap: false, samples: 1, seconds: 7.2 }
    const out = await measureDrivingAudio({ provider: "ltx-2.5-fast", audioUrl: AUDIO, resolution: "720p" })
    expect(out).toMatchObject({ ok: true, billedSec: 8, sentSec: 7.15, creditId: "ltx-2.5-fast:8s:720p" })
  })
})
