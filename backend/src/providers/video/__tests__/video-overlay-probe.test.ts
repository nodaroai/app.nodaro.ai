// backend/src/providers/video/__tests__/video-overlay-probe.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const exec = vi.hoisted(() => ({
  next: { error: null as (Error & { killed?: boolean; code?: unknown }) | null, stdout: "", stderr: "" },
  calls: [] as string[][],
}))
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  execFile: (_cmd: string, args: string[], _opts: unknown, cb: (e: unknown, out: string, err: string) => void) => {
    exec.calls.push(args)
    cb(exec.next.error, exec.next.stdout, exec.next.stderr)
  },
}))

import { parseVideoOverlayProbe, probeVideoOverlayBase } from "../ffmpeg-utils.js"
import { isDeterministicJobError } from "../../../lib/deterministic-job-error.js"

const video = (over: Record<string, unknown> = {}) => ({
  index: 0, codec_type: "video", codec_name: "h264", width: 1080, height: 1920, sample_aspect_ratio: "1:1",
  r_frame_rate: "30/1", avg_frame_rate: "30/1", duration: "24.800000", start_time: "0.000000", disposition: { attached_pic: 0 }, ...over,
})
const audio = (codec = "aac") => ({ index: 1, codec_type: "audio", codec_name: codec, duration: "24.823000", disposition: { attached_pic: 0 } })
const json = (streams: unknown[], format: Record<string, unknown> = { duration: "24.823000" }) => JSON.stringify({ streams, format })

function expectNotVideo(run: () => unknown) {
  try {
    run()
  } catch (err) {
    expect((err as Error).message).toBe("The base input is not a video")
    expect(isDeterministicJobError(err)).toBe(true)
    return
  }
  throw new Error("expected a refusal")
}

describe("parseVideoOverlayProbe", () => {
  it("first video + first audio; the VIDEO stream's duration; raw frame rates", () => {
    expect(parseVideoOverlayProbe(json([video(), audio(), audio("mp3")]))).toEqual({
      width: 1080, height: 1920, rotation: 0, sar: 1, rFrameRate: "30/1", avgFrameRate: "30/1",
      streamDurationSec: 24.8, startTimeSec: 0, audioCodec: "aac",
    })
  })
  it("keeps a VFR base's rationals verbatim (the builder picks the cadence)", () => {
    expect(parseVideoOverlayProbe(json([video({ r_frame_rate: "0/0", avg_frame_rate: "30000/1001" })]))).toMatchObject({ rFrameRate: "0/0", avgFrameRate: "30000/1001", audioCodec: null })
  })
  it("falls back to the container duration when the stream reports none", () => {
    expect(parseVideoOverlayProbe(json([video({ duration: undefined })], { duration: "3.5" })).streamDurationSec).toBe(3.5)
  })
  it.each([[90, true], [-90, true], [270, true], [180, false], [0, false]])("rotation %i swaps the axes: %s", (rotation, swapped) => {
    const p = parseVideoOverlayProbe(json([video({ width: 1920, height: 1080, side_data_list: [{ rotation }] })]))
    expect([p.width, p.height]).toEqual(swapped ? [1080, 1920] : [1920, 1080])
    expect(p.rotation).toBe(((rotation % 360) + 360) % 360)
  })
  it("reads an old-style `rotate` tag too", () => {
    expect(parseVideoOverlayProbe(json([video({ width: 1920, height: 1080, tags: { rotate: "90" } })]))).toMatchObject({ width: 1080, height: 1920 })
  })
  it("parses the SAR, and inverts it when the axes swap", () => {
    expect(parseVideoOverlayProbe(json([video({ width: 540, sample_aspect_ratio: "2:1" })])).sar).toBe(2)
    expect(parseVideoOverlayProbe(json([video({ width: 1920, height: 540, sample_aspect_ratio: "2:1", side_data_list: [{ rotation: 90 }] })])).sar).toBe(0.5)
  })
  it.each(["0:1", "N/A", undefined])("a SAR of %s is 1 (Review Focus 3)", (sar) => {
    expect(parseVideoOverlayProbe(json([video({ sample_aspect_ratio: sar })])).sar).toBe(1)
  })
  it("an embedded cover picture is not a video (Review Focus 2)", () => {
    const cover = video({ codec_name: "mjpeg", width: 600, height: 600, disposition: { attached_pic: 1 } })
    expectNotVideo(() => parseVideoOverlayProbe(json([audio("mp3"), cover])))
  })
  it("refuses no video stream, a zero size, no duration anywhere, and unparseable output", () => {
    expectNotVideo(() => parseVideoOverlayProbe(json([audio()])))
    expectNotVideo(() => parseVideoOverlayProbe(json([video({ width: 0 })])))
    expectNotVideo(() => parseVideoOverlayProbe(json([video({ duration: undefined })], {})))
    expectNotVideo(() => parseVideoOverlayProbe("not json"))
  })
})

describe("probeVideoOverlayBase", () => {
  beforeEach(() => {
    exec.calls.length = 0
    exec.next = { error: null, stdout: json([video(), audio()]), stderr: "" }
  })
  it("asks ffprobe for every entry it needs in ONE call on the local file", async () => {
    await probeVideoOverlayBase("/w/input.mp4")
    expect(exec.calls).toHaveLength(1)
    const args = exec.calls[0]!
    expect(args.at(-1)).toBe("/w/input.mp4")
    expect(args[args.indexOf("-show_entries") + 1]).toContain("stream_side_data=rotation")
    expect(args[args.indexOf("-show_entries") + 1]).toContain("stream_disposition=attached_pic")
    expect(args).not.toContain("-select_streams")
  })
  it("ffprobe failing on the file (HTML saved as .mp4) is 'not a video' — deterministic", async () => {
    exec.next = { error: Object.assign(new Error("exit 1"), { killed: false, code: 1 }), stdout: "", stderr: "Invalid data found when processing input" }
    await expect(probeVideoOverlayBase("/w/input.mp4")).rejects.toSatisfy((e: unknown) => isDeterministicJobError(e) && (e as Error).message === "The base input is not a video")
  })
  it("an ffprobe TIMEOUT stays a plain, retryable error", async () => {
    exec.next = { error: Object.assign(new Error("timed out"), { killed: true, code: null }), stdout: "", stderr: "" }
    await expect(probeVideoOverlayBase("/w/input.mp4")).rejects.toSatisfy((e: unknown) => !isDeterministicJobError(e) && (e as { timedOut?: boolean }).timedOut === true)
  })
})
