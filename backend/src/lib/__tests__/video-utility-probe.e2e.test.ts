/**
 * A clip whose header carries no length (a live-written Matroska/WebM, as a
 * browser's recorder writes) is measured from its packets — on the charge's
 * path and on the render's check, through the one reading both use — so
 * Trim, Loop and Combine Videos never refuse a file their render accepts. A
 * file that is no video at all is still refused, on both. Each node reads the
 * length its worker reads: Trim and Loop the container, Combine Videos each
 * clip's video stream (where it joins), which a clip whose sound runs past its
 * last frame ends before its container. Real ffmpeg and ffprobe: the fixtures
 * are written at test time with ffmpeg's own encoder.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { join } from "node:path"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import { runFfmpeg, runFfprobe } from "../../providers/video/ffmpeg-utils.js"
import { trimVideo } from "../../providers/video/trim-video.js"

// The Trim provider downloads its source over the network (`downloadFile`, http(s) only); here it copies a
// local fixture instead. Everything else in ffmpeg-utils stays real.
vi.mock("../../providers/video/ffmpeg-utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../providers/video/ffmpeg-utils.js")>()
  const { promises: fsp } = await import("node:fs")
  return { ...actual, downloadFile: async (src: string, dest: string) => { await fsp.copyFile(src, dest) } }
})
import { isDeterministicJobError } from "../deterministic-job-error.js"
import { ClipUnreadableError, probeClipLengthSec } from "../video-utility-probe.js"
import { measureVideoUtilityCharge } from "../video-utility-length.js"
import { videoUtilityChargeCheck } from "../video-utility-charge-check.js"
import { LOSSLESS_TRIM_OVERSHOOT_SEC } from "@nodaro/render-rules"

let dir: string
let noLength: string
let withLength: string
let notVideo: string
let soundOverhang: string
let offsetStart: string
let browserVp8: string
let browserVp9: string

beforeAll(async () => {
  dir = join(tmpdir(), `video-utility-probe-${randomUUID()}`)
  await fs.mkdir(dir, { recursive: true })
  noLength = join(dir, "live.mkv")
  withLength = join(dir, "clip.mp4")
  notVideo = join(dir, "notes.txt")
  // A live-written Matroska: no duration in its header, its packets 3.2 s long.
  await runFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=blue:s=64x64:r=10:d=3.2", "-c:v", "mpeg4", "-f", "matroska", "-live", "1", noLength])
  await runFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=red:s=64x64:r=10:d=3.2", "-c:v", "mpeg4", withLength])
  await fs.writeFile(notVideo, "not a video")
  // A browser's recorder writes a live WebM: VP8 or VP9, no length in its header (libvpx is in the pinned build).
  browserVp8 = join(dir, "recording-vp8.webm")
  browserVp9 = join(dir, "recording-vp9.webm")
  await runFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=green:s=64x64:r=10:d=3.2", "-c:v", "libvpx", "-deadline", "realtime", "-f", "webm", "-live", "1", browserVp8])
  await runFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=green:s=64x64:r=10:d=3.2", "-c:v", "libvpx-vp9", "-deadline", "realtime", "-f", "webm", "-live", "1", browserVp9])
  // The same 3.2 s, written live with its timestamps starting at 10 s (format.start_time 10).
  offsetStart = join(dir, "offset.mkv")
  await runFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=blue:s=64x64:r=10:d=3.2", "-c:v", "mpeg4", "-output_ts_offset", "10", "-f", "matroska", "-live", "1", offsetStart])
  // 5 s of picture, 6 s of sound: the container runs to the sound's end.
  soundOverhang = join(dir, "overhang.mp4")
  await runFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=green:s=64x64:r=10:d=5", "-f", "lavfi", "-i", "sine=f=440:d=6", "-c:v", "mpeg4", "-c:a", "aac", soundOverhang])
})

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe("a clip with no length in its header", () => {
  it("really has none in its header (the fixture is what it claims)", async () => {
    const header = await runFfprobe(["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=duration:format=duration", "-of", "csv=p=0", noLength])
    expect(header.split("\n").map((l) => l.trim()).filter(Boolean).every((l) => l === "N/A")).toBe(true)
  })

  it("is read from its packets: 3.2 s, as a file with a header reads", async () => {
    expect(await probeClipLengthSec(noLength)).toBeCloseTo(3.2, 3)
    expect(await probeClipLengthSec(withLength)).toBeCloseTo(3.2, 1)
  })

  it("whose timestamps start late is read from its start: 3.2 s, not the 13.2 s its last packet ends at", async () => {
    expect(await probeClipLengthSec(offsetStart)).toBeCloseTo(3.2, 3)
  })

  it("the charge measures it: a Loop ×2 of 3.2 s (less the grace) is 2 units", async () => {
    await expect(measureVideoUtilityCharge("loop-video", { videoUrl: noLength, mode: "repeat", repeatCount: 2 })).resolves.toMatchObject({ ok: true, units: 2 })
  })

  it("the render's check reads it the same way: within its units it renders, past them it is refused", async () => {
    await expect(videoUtilityChargeCheck("loop-video", { mode: "repeat", repeatCount: 2, billedUnits: 2, upstreamDuration: 3.2 })([noLength])).resolves.toBeUndefined()
    const refused = await videoUtilityChargeCheck("loop-video", { mode: "repeat", repeatCount: 2, billedUnits: 1, upstreamDuration: 1 })([noLength]).then(
      () => undefined,
      (e: unknown) => e,
    )
    expect(isDeterministicJobError(refused)).toBe(true)
  })
})

describe("a browser's live WebM recording (VP8, VP9), no length in its header", () => {
  it.each([["VP8", () => browserVp8], ["VP9", () => browserVp9]])("%s: has none in its header, and is read from its packets on the charge and at the render's check", async (_codec, file) => {
    const header = await runFfprobe(["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=duration:format=duration", "-of", "csv=p=0", file()])
    expect(header.split("\n").map((l) => l.trim()).filter(Boolean).every((l) => l === "N/A")).toBe(true)
    expect(await probeClipLengthSec(file())).toBeCloseTo(3.2, 3)
    // 3.2 s less the grace, two copies: 6.2 s, 2 units — and the render's check passes it at 2.
    await expect(measureVideoUtilityCharge("loop-video", { videoUrl: file(), mode: "repeat", repeatCount: 2 })).resolves.toMatchObject({ ok: true, units: 2 })
    await expect(videoUtilityChargeCheck("loop-video", { mode: "repeat", repeatCount: 2, billedUnits: 2, upstreamDuration: 3.2 })([file()])).resolves.toBeUndefined()
  })
})

describe("a clip whose sound runs past its last frame", () => {
  it("reads the container by default and the video stream when asked", async () => {
    expect(await probeClipLengthSec(soundOverhang)).toBeGreaterThan(5.9)
    expect(await probeClipLengthSec(soundOverhang, { reading: "video-stream" })).toBeCloseTo(5, 1)
  })

  it("Trim is charged the container (6 s less the grace: 2 units), Combine Videos each clip's picture (2 × 4.9 s: 2 units, not 3)", async () => {
    await expect(measureVideoUtilityCharge("trim-video", { videoUrl: soundOverhang, trimMode: "seconds" })).resolves.toMatchObject({ ok: true, units: 2 })
    const combine = await measureVideoUtilityCharge("combine-videos", { videoUrls: [soundOverhang, soundOverhang], transition: "cut", trimStartFrames: 0, trimEndFrames: 0 })
    expect(combine).toMatchObject({ ok: true, units: 2 })
    expect(combine.ok && combine.secs[0]).toBeCloseTo(5, 1)
  })

  it("the render's check re-measures Combine Videos by the picture too: priced at 2 units, it renders (by the container it would need 3)", async () => {
    const body = { transition: "cut", trimStartFrames: 0, trimEndFrames: 0, billedUnits: 2, videoUrls: ["a", "b"], upstreamDurations: [5, 5] }
    await expect(videoUtilityChargeCheck("combine-videos", body)([soundOverhang, soundOverhang])).resolves.toBeUndefined()
  })
})

describe("a file that is no video", () => {
  it("cannot be measured: refused on the charge and on the render's check", async () => {
    await expect(probeClipLengthSec(notVideo)).rejects.toBeInstanceOf(Error)
    await expect(measureVideoUtilityCharge("trim-video", { videoUrl: notVideo, trimMode: "seconds" })).resolves.toMatchObject({ ok: false, code: "invalid_video_duration" })
    const refused = await videoUtilityChargeCheck("trim-video", { trimMode: "seconds", billedUnits: 2, upstreamDuration: 5 })([notVideo]).then(() => undefined, (e: unknown) => e)
    expect(isDeterministicJobError(refused)).toBe(true)
  })

  it("an audio-only file has no video stream to measure", async () => {
    const audio = join(dir, "tone.m4a")
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "sine=f=440:d=1", audio])
    await expect(probeClipLengthSec(audio)).rejects.toBeInstanceOf(ClipUnreadableError)
  })
})

describe("the Trim provider with Lossless on, on a source with a keyframe every 2 s", () => {
  it("cuts 3–8 s from the keyframe at 2 s: longer than the 5 s window, within the bound a quote reads it at", async () => {
    const src = join(dir, "h264-gop2.mp4")
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "testsrc2=size=160x120:rate=24:duration=12", "-f", "lavfi", "-i", "sine=f=440:sample_rate=48000:duration=12", "-c:v", "libx264", "-preset", "veryfast", "-g", "48", "-keyint_min", "48", "-sc_threshold", "0", "-c:a", "aac", "-shortest", src])
    const { videoPath } = await trimVideo({ videoUrl: src, startTime: 3, endTime: 8, losslessKeyframe: true })
    try {
      const made = await probeClipLengthSec(videoPath, { reading: "container" })
      // From the keyframe at 2 s to 8 s and a couple of frames past it: about 6.08 s.
      expect(made).toBeGreaterThan(5)
      expect(made).toBeCloseTo(6.08, 1)
      expect(made).toBeLessThanOrEqual(8 + LOSSLESS_TRIM_OVERSHOOT_SEC)
    } finally {
      await fs.rm(join(videoPath, ".."), { recursive: true, force: true })
    }
  })
})

describe("a lossless (keyframe-snapped) Trim's stream copy", () => {
  // The copy the Trim provider runs on an H.264/AAC source with Lossless on (providers/video/trim-video.ts):
  // `-ss <the keyframe at or before the start> -i src -t <end − that keyframe> -c copy`. One keyframe
  // (x264's default interval on a short clip), so a 3–8 s cut starts at 0. Measured as the Trim reads a clip.
  it.each([24, 10])("at %i fps runs past its window: from the keyframe before it, and a few frames past its end, within the quote's bound", async (fps) => {
    const src = join(dir, `h264-${fps}.mp4`)
    const out = join(dir, `h264-${fps}-cut.mp4`)
    await runFfmpeg(["-y", "-f", "lavfi", "-i", `testsrc2=size=160x120:rate=${fps}:duration=12`, "-f", "lavfi", "-i", "sine=f=440:sample_rate=48000:duration=12", "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", "-shortest", src])
    await runFfmpeg(["-y", "-ss", "0", "-i", src, "-t", "8", "-c:v", "copy", "-c:a", "copy", "-movflags", "+faststart", out])
    const made = await probeClipLengthSec(out, { reading: "container" })
    // Longer than the 5 s window and past its 8 s end, never past the bound a quote reads it at.
    expect(made).toBeGreaterThan(8)
    expect(made).toBeLessThanOrEqual(8 + LOSSLESS_TRIM_OVERSHOOT_SEC)
  })
})
