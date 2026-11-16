// @test-reads-none reads only the clips it makes with ffmpeg in its own temp dir
/**
 * The steps that charge by a clip's PICTURE (Topaz and Nodaro Video Upscale,
 * Video Overlay, Combine Videos) read its length in order — the stream's own
 * length, its DURATION tag, its packets — and only when all three fail the
 * container's, less the fallback's allowance. A WebM or an MKV states no
 * stream length, only the tag, so an ordinary upload of one is measured by its
 * picture, never the fallback; a file with neither (an FLV) is measured from
 * its packets. Real ffmpeg and ffprobe: the fixtures are written at test time.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { join } from "node:path"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import { topazVideoHoldUnits } from "@nodaro/render-rules"
import { probeVideoOverlayBase, probeVideoOverlayBaseSource, probeVideoSource, runFfmpeg, runFfprobe } from "../../providers/video/ffmpeg-utils.js"
import { probeClipReading } from "../video-utility-probe.js"
import { guardedPacketScan, videoOverlayChargedSec, videoTrackHeaderOf, videoTrackLengthFrom } from "../video-track-length.js"
import { measureVideoOverlayBase } from "../video-overlay-length.js"
import { videoOverlayRefusalForCharge } from "../video-overlay-refusal.js"
import { planTopazVideoUpscale } from "../topaz-video-plan.js"

let dir: string
/** 5.1 s of picture, no sound (VP8): the container is exactly the picture. */
let pictureWebm: string
/** 5 s of picture, 5.3 s of sound (H.264 + AAC): the container runs to the sound's end. */
let soundMkv: string
/** The same 5 s / 5.3 s as an FLV: no stream length, no tag — only its packets tell the picture's. */
let soundFlv: string
/** 4.9 s of picture, 5.7 s of sound (MKV): the picture is 1 unit of 5 s, the container 2 even past the render's re-measure slack. */
let edgeMkv: string
/** A 5 s MKV whose DURATION tag was rewritten to claim 9 s (a malformed file): its container still states 5 s. */
let overTagMkv: string

beforeAll(async () => {
  dir = join(tmpdir(), `video-track-length-${randomUUID()}`)
  await fs.mkdir(dir, { recursive: true })
  pictureWebm = join(dir, "picture.webm")
  soundMkv = join(dir, "sound.mkv")
  soundFlv = join(dir, "sound.flv")
  await runFfmpeg(["-y", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=30:duration=5.1", "-c:v", "libvpx", "-deadline", "realtime", "-b:v", "200k", pictureWebm])
  const av = ["-y", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=30:duration=5", "-f", "lavfi", "-i", "sine=f=440:sample_rate=48000:duration=5.3", "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac"]
  await runFfmpeg([...av, soundMkv])
  await runFfmpeg([...av, soundFlv])
  // ffmpeg's muxer writes the tag itself, so the claim is patched into the file's bytes (the same-length string).
  const plainMkv = join(dir, "plain.mkv")
  overTagMkv = join(dir, "over-tag.mkv")
  await runFfmpeg(["-y", "-f", "lavfi", "-i", "testsrc2=size=160x120:rate=30:duration=5", "-c:v", "libx264", "-preset", "veryfast", plainMkv])
  const bytes = await fs.readFile(plainMkv)
  const claim = Buffer.from("00:00:05.000000000")
  const at = bytes.indexOf(claim)
  if (at < 0 || bytes.indexOf(claim, at + 1) >= 0) throw new Error("the fixture's DURATION tag is not written once")
  Buffer.from("00:00:09.000000000").copy(bytes, at)
  await fs.writeFile(overTagMkv, bytes)
  edgeMkv = join(dir, "edge.mkv")
  await runFfmpeg(["-y", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=30:duration=4.9", "-f", "lavfi", "-i", "sine=f=440:sample_rate=48000:duration=5.7", "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", edgeMkv])
}, 60_000)

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

const header = async (path: string) => JSON.parse(await runFfprobe(["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=duration:stream_tags=DURATION:format=duration", "-of", "json", path])) as {
  streams: Array<{ duration?: string; tags?: { DURATION?: string } }>
  format: { duration?: string }
}

describe("the fixtures are what they claim", () => {
  it("a WebM and an MKV state no stream length, only a DURATION tag; an FLV states neither; all three state a container length", async () => {
    for (const path of [pictureWebm, soundMkv]) {
      const h = await header(path)
      expect(h.streams[0]!.duration, path).toBeUndefined()
      expect(h.streams[0]!.tags?.DURATION, path).toMatch(/^00:00:05\./)
      expect(Number(h.format.duration), path).toBeGreaterThan(5)
    }
    const flv = await header(soundFlv)
    expect(flv.streams[0]!.duration).toBeUndefined()
    expect(flv.streams[0]!.tags?.DURATION).toBeUndefined()
    // The container runs past the picture, to the sound's end.
    expect(Number((await header(soundMkv)).format.duration)).toBeGreaterThan(5.25)
  })
})

describe("the picture's length, before any container fallback", () => {
  it("probeVideoSource reads the WebM's and the MKV's DURATION tag", async () => {
    expect((await probeVideoSource(pictureWebm)).videoTagDurationSeconds).toBeCloseTo(5.1, 3)
    const mkv = await probeVideoSource(soundMkv)
    expect(mkv.videoDurationSeconds).toBeUndefined()
    expect(mkv.videoTagDurationSeconds).toBeCloseTo(5, 3)
    expect(mkv.durationSeconds).toBeGreaterThan(5.25)
  })

  it("Topaz and Nodaro Video Upscale's reading: the tag for a WebM / MKV, the packets for an FLV — never the container", async () => {
    for (const [path, sec] of [[pictureWebm, 5.1], [soundMkv, 5], [soundFlv, 5]] as const) {
      const track = await videoTrackLengthFrom(videoTrackHeaderOf(await probeVideoSource(path)), guardedPacketScan(path))
      expect(track?.reading, path).toBe("video-stream")
      expect(track?.sec, path).toBeCloseTo(sec, 1)
    }
  })

  it("Topaz holds the MKV's picture, 5 s of frames, not its 5.3 s container", async () => {
    const plan = await planTopazVideoUpscale(soundMkv, { targetResolution: "4k", targetFps: 60 })
    expect(plan.sourceDurationSec).toBeCloseTo(5, 3)
    expect(plan.holdUnits).toBe(topazVideoHoldUnits({ resolution: "4k", fps: 60, durationSec: plan.sourceDurationSec, source: { width: 320, height: 240 } }))
  })

  it("Video Overlay's probe gives the MKV's picture length beside the render's container length", async () => {
    const probe = await probeVideoOverlayBaseSource(soundMkv)
    expect(probe.videoTagSec).toBeCloseTo(5, 3)
    expect(probe.videoStreamSec).toBeUndefined()
    expect(probe.streamDurationSec).toBeGreaterThan(5.25)
    // An FLV has no picture length in its header: the charge scans its packets.
    const flv = await probeVideoOverlayBaseSource(soundFlv)
    expect(flv.videoStreamSec).toBeUndefined()
    expect(flv.videoTagSec).toBeUndefined()
    expect(flv.videoStreamIndex).toBe(0)
  })

  it("Combine Videos' reading (the video stream): the tag for a WebM / MKV, the packets for an FLV", async () => {
    expect((await probeClipReading(pictureWebm, { reading: "video-stream" })).sec).toBeCloseTo(5.1, 3)
    expect((await probeClipReading(soundMkv, { reading: "video-stream" })).sec).toBeCloseTo(5, 3)
    expect((await probeClipReading(soundFlv, { reading: "video-stream" })).sec).toBeCloseTo(5, 1)
    // Trim and Loop read the container, as before.
    expect((await probeClipReading(soundMkv)).sec).toBeGreaterThan(5.25)
  })
})

describe("Video Overlay's render checks the units it was charged by the same picture length", () => {
  it("an MKV whose sound runs past a unit edge: charged 1 unit by its 4.9 s picture, and the render's check (its own copy) agrees", async () => {
    // The fixture: its container runs past 5 s by more than the render's 0.5 s re-measure slack.
    expect(Number((await header(edgeMkv)).format.duration)).toBeGreaterThan(5.55)
    const layers = [{ videoUrl: edgeMkv, start: 0 }] as unknown as Parameters<typeof videoOverlayRefusalForCharge>[0]
    const measured = await measureVideoOverlayBase({ videoUrl: edgeMkv, layers } as unknown as Parameters<typeof measureVideoOverlayBase>[0])
    expect(measured).toMatchObject({ ok: true, units: 1 })
    const probe = await probeVideoOverlayBase(edgeMkv)
    const chargedSec = await videoOverlayChargedSec(probe, edgeMkv)
    expect(chargedSec).toBeCloseTo(4.9, 2)
    expect(videoOverlayRefusalForCharge(layers, 1, chargedSec)).toBeUndefined()
    // Read by the container instead, the same run would be refused as a changed base.
    expect(videoOverlayRefusalForCharge(layers, 1, probe.streamDurationSec)).toMatchObject({ code: "video_overlay_base_changed" })
  })
})

describe("a tag that claims more than its container is held to the container", () => {
  it("the fixture: a 9 s DURATION tag on a 5 s container", async () => {
    const h = await header(overTagMkv)
    expect(h.streams[0]!.tags?.DURATION).toBe("00:00:09.000000000")
    expect(Number(h.format.duration)).toBeCloseTo(5, 3)
  })

  it("every picture-measuring step reads 5 s, its container, never the tag's 9 s", async () => {
    // Topaz and Nodaro Video Upscale's reading.
    const probed = await probeVideoSource(overTagMkv)
    expect(probed.videoTagDurationSeconds).toBeCloseTo(9, 3)
    const track = await videoTrackLengthFrom(videoTrackHeaderOf(probed), guardedPacketScan(overTagMkv))
    expect(track).toEqual({ sec: expect.closeTo(5, 3), reading: "video-stream" })
    expect((await planTopazVideoUpscale(overTagMkv, { targetResolution: "4k", targetFps: 60 })).sourceDurationSec).toBeCloseTo(5, 3)
    // Combine Videos' reading.
    expect((await probeClipReading(overTagMkv, { reading: "video-stream" })).sec).toBeCloseTo(5, 3)
    // Video Overlay's charge, and its render's check.
    const layers = [{ videoUrl: overTagMkv, start: 0 }] as unknown as Parameters<typeof videoOverlayRefusalForCharge>[0]
    expect(await measureVideoOverlayBase({ videoUrl: overTagMkv, layers } as unknown as Parameters<typeof measureVideoOverlayBase>[0])).toMatchObject({ ok: true, units: 1 })
    expect(await videoOverlayChargedSec(await probeVideoOverlayBase(overTagMkv), overTagMkv)).toBeCloseTo(5, 3)
  })
})
