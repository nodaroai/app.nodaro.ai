import { describe, expect, it, vi } from "vitest"

const probe = vi.hoisted(() => ({ answer: "" as string | Error }))
vi.mock("../../providers/video/ffmpeg-utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../providers/video/ffmpeg-utils.js")>()
  return {
    ...actual,
    readProbeSource: vi.fn(async (_src: string, read: (input: string, p: { inputArgs: string[]; run: () => Promise<string> }) => Promise<string>) =>
      read("in", {
        inputArgs: [],
        run: async () => {
          if (probe.answer instanceof Error) throw probe.answer
          return probe.answer
        },
      }),
    ),
  }
})

import {
  BITRATE_SLACK_BYTES,
  MEDIA_IMPORT_MAX_BITRATE_BPS,
  MEDIA_IMPORT_MAX_BYTES,
  MEDIA_IMPORT_MAX_SEC,
  MediaImportLengthError,
  assertImportableMedia,
  isBitrateImplausible,
} from "../media-import-length.js"
import { precheckRemoteVideo } from "../media-import-precheck.js"
import { ProbeSourceBlockedError, readProbeSource } from "../../providers/video/ffmpeg-utils.js"

const MB = 1_000_000
const bytesFor = (mbitPerSec: number, sec: number) => Math.round((mbitPerSec * MB * sec) / 8) + BITRATE_SLACK_BYTES

describe("the import rules", () => {
  it("10 GiB and 30 minutes", () => {
    expect(MEDIA_IMPORT_MAX_BYTES).toBe(10 * 1024 ** 3)
    expect(MEDIA_IMPORT_MAX_SEC).toBe(1800)
  })

  it("real recordings pass the bitrate check: 4K60 phone footage and ProRes for video, uncompressed multichannel for audio", () => {
    expect(MEDIA_IMPORT_MAX_BITRATE_BPS).toEqual({ video: 2_500_000_000, audio: 50_000_000 })
    // 4K60 HEVC from a phone, ~200 Mbit/s; ProRes 422 HQ 4K60 ~1,770; ProRes 4444 4K30 ~2,000.
    for (const mbps of [200, 1770, 2000]) expect(isBitrateImplausible(bytesFor(mbps, 30), 30, "video")).toBe(false)
    // 24-bit/192 kHz stereo ~9.2 Mbit/s; 32-bit float 8 ch/192 kHz ~49.2.
    for (const mbps of [9.2, 49.2]) expect(isBitrateImplausible(bytesFor(mbps, 60), 60, "audio")).toBe(false)
  })

  it("a big file claiming a short length is implausible", () => {
    expect(isBitrateImplausible(bytesFor(2600, 10), 10, "video")).toBe(true)
    expect(isBitrateImplausible(bytesFor(60, 10), 10, "audio")).toBe(true)
    // A 10 GiB file claiming 10 s.
    expect(isBitrateImplausible(MEDIA_IMPORT_MAX_BYTES, 10, "video")).toBe(true)
  })

  it("a tiny clip with a large header or cover art is never refused for it (16 MiB slack)", () => {
    expect(isBitrateImplausible(BITRATE_SLACK_BYTES, 0.01, "audio")).toBe(false)
  })

  it("assertImportableMedia answers each refusal with its own code", () => {
    const code = (input: Parameters<typeof assertImportableMedia>[0]) => {
      try {
        assertImportableMedia(input)
        return "ok"
      } catch (err) {
        return (err as MediaImportLengthError).code
      }
    }
    expect(code({ durationSec: 600, sizeBytes: 2 * 1024 ** 3, kind: "video" })).toBe("ok")
    expect(code({ durationSec: 600, sizeBytes: MEDIA_IMPORT_MAX_BYTES + 1, kind: "video" })).toBe("media_too_large")
    expect(code({ durationSec: undefined, sizeBytes: 10, kind: "video" })).toBe("media_unreadable")
    expect(code({ durationSec: 1801, sizeBytes: 10, kind: "video" })).toBe("media_too_long")
    expect(code({ durationSec: 1, sizeBytes: 1024 ** 3, kind: "video" })).toBe("media_bitrate_implausible")
  })
})

describe("the direct-file link pre-check", () => {
  const answer = (format: Record<string, string>) => {
    probe.answer = JSON.stringify({ format })
  }

  it("reads the remote file through the probe guard (readProbeSource) and passes a file that fits", async () => {
    answer({ duration: "600", size: String(2 * 1024 ** 3) })
    await expect(precheckRemoteVideo("https://files.example.com/a.mp4")).resolves.toEqual({ kind: "ok", durationSec: 600, sizeBytes: 2 * 1024 ** 3 })
    expect(vi.mocked(readProbeSource).mock.calls.at(-1)![0]).toBe("https://files.example.com/a.mp4")
  })

  it.each([
    [{ duration: "1801" }, "media_too_long"],
    [{ duration: "600", size: String(MEDIA_IMPORT_MAX_BYTES + 1) }, "media_too_large"],
    [{ size: String(MEDIA_IMPORT_MAX_BYTES + 1) }, "media_too_large"],
    [{ duration: "5", size: String(5 * 1024 ** 3) }, "media_bitrate_implausible"],
  ])("refuses %j before any download (%s)", async (format, code) => {
    answer(format)
    await expect(precheckRemoteVideo("https://files.example.com/a.mp4")).rejects.toMatchObject({ code })
  })

  it("a link the guard refuses for its address (a redirect to a private one included) is blocked", async () => {
    probe.answer = new ProbeSourceBlockedError("address", "blocked")
    await expect(precheckRemoteVideo("https://files.example.com/a.mp4")).resolves.toEqual({ kind: "blocked" })
  })

  it("anything it cannot read falls through to the downloaded file's check", async () => {
    for (const a of [new Error("timeout"), new ProbeSourceBlockedError("container", "playlist"), "not json", JSON.stringify({ format: {} })]) {
      probe.answer = a
      await expect(precheckRemoteVideo("https://files.example.com/a.mp4")).resolves.toEqual({ kind: "ok" })
    }
  })
})
