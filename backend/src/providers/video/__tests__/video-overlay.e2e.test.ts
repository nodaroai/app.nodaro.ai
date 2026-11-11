// backend/src/providers/video/__tests__/video-overlay.e2e.test.ts
/**
 * `renderVideoOverlay` end to end on real ffprobe + sharp + ffmpeg, over
 * fixtures generated at run time. Only `downloadFile` is replaced — it copies
 * a local fixture (a `file://` URL); everything the provider does after the
 * bytes land is real. The pinned-ffmpeg smoke proves the chain on the
 * production build; this file proves the provider drives it correctly.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest"
import { join } from "node:path"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { pathToFileURL } from "node:url"

vi.mock("../ffmpeg-utils.js", async (importOriginal) => {
  const { copyFile } = await import("node:fs/promises")
  return {
    ...(await importOriginal<typeof import("../ffmpeg-utils.js")>()),
    downloadFile: async (url: string, dest: string) => copyFile(new URL(url), dest),
  }
})

import { runFfmpeg } from "../ffmpeg-utils.js"
import { renderVideoOverlay } from "../video-overlay.js"
import { isDeterministicJobError } from "../../../lib/deterministic-job-error.js"
import {
  BASE_RGB, FPS, audioMd5, beepSampleTimeSec, beepTimeSec, changedBox, ffmpegAvailable, flashTimeSec, frameAt, makeAnimatedWebp, makeApng, makeBase, makeColourClip,
  makeExifSplit, makeFlashBeepClip, makeLoudToneClip, makeSolidPng, makeSplitClip, near, offsetStart, pixel, probeStreams, rmsDbfs, samplePeakDbfs, tagRotation, type Rgb,
} from "./video-overlay-e2e-fixtures.js"

// In CI this file must never skip green: a runner without ffmpeg FAILS here
// instead of silently skipping the describe below.
it.runIf(!!process.env.CI)("CI has ffmpeg — this file never skips there", () => {
  expect(ffmpegAvailable).toBe(true)
})

describe.skipIf(!ffmpegAvailable)("renderVideoOverlay — real ffmpeg", () => {
  let dir: string
  let n = 0
  const p = (name: string) => join(dir, name)
  const url = (name: string) => pathToFileURL(p(name)).href
  /** A fresh work dir per render, as the handler's createWorkDir gives. */
  const work = async () => {
    const w = p(`work-${++n}`)
    await fs.mkdir(w)
    return w
  }
  const CARD = { imageUrl: "", start: 0.5, end: 1.5, preset: "card" as const }
  const card = () => ({ ...CARD, imageUrl: url("magenta-1x2.png") })
  const expectCardAt = (box: ReturnType<typeof changedBox>) => {
    // card on 1080×1920, a 1:2 image: box 842×1152 at (119, 307) → drawn 576×1152 at (252, 307)
    expect(box).not.toBeNull()
    expect(Math.abs(box!.left - 252)).toBeLessThanOrEqual(2)
    expect(Math.abs(box!.top - 307)).toBeLessThanOrEqual(2)
    expect(Math.abs(box!.width - 576)).toBeLessThanOrEqual(2)
    expect(Math.abs(box!.height - 1152)).toBeLessThanOrEqual(2)
  }

  beforeAll(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), "vo-e2e-"))
    await makeBase(p("base.mp4"), { width: 1080, height: 1920, durationSec: 2 })
    await makeSolidPng(p("magenta-1x2.png"), 1080, 2160, [255, 0, 255])
  }, 120_000)

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  })

  it("card preset: inside its window only, where the shared geometry puts it, audio byte-identical, cadence kept", async () => {
    const r = await renderVideoOverlay({ videoUrl: url("base.mp4"), layers: [card()] }, await work())
    expect(r).toMatchObject({ warnings: [], width: 1080, height: 1920 })
    expect(Math.abs(r.durationSec - 2)).toBeLessThanOrEqual(1 / FPS)
    expect(changedBox(await frameAt(r.outputPath, 0.2), BASE_RGB)).toBeNull()
    expectCardAt(changedBox(await frameAt(r.outputPath, 1.0), BASE_RGB))
    expect(changedBox(await frameAt(r.outputPath, 1.8), BASE_RGB)).toBeNull()
    expect(await audioMd5(r.outputPath)).toBe(await audioMd5(p("base.mp4")))
    const v = (await probeStreams(r.outputPath)).find((s) => s.codecType === "video")!
    expect([v.frames, v.rFrameRate]).toEqual([60, "30/1"])
  }, 120_000)

  it("a base whose start_time is 1.0: the window is on the player clock, audio byte-identical", async () => {
    await offsetStart(p("base.mp4"), p("start1.mp4"), 1)
    const r = await renderVideoOverlay({ videoUrl: url("start1.mp4"), layers: [card()] }, await work())
    expect(changedBox(await frameAt(r.outputPath, 0.2), BASE_RGB)).toBeNull()
    expectCardAt(changedBox(await frameAt(r.outputPath, 1.0), BASE_RGB))
    expect(changedBox(await frameAt(r.outputPath, 1.8), BASE_RGB)).toBeNull()
    expect(await audioMd5(r.outputPath)).toBe(await audioMd5(p("start1.mp4")))
  }, 120_000)

  it("a rotation-tagged base (stored 1920×1080, tag 90) renders upright at 1080×1920 with the card where the preview puts it", async () => {
    await makeBase(p("land.mp4"), { width: 1920, height: 1080, durationSec: 2 })
    await tagRotation(p("land.mp4"), p("rot.mp4"), 90)
    const r = await renderVideoOverlay({ videoUrl: url("rot.mp4"), layers: [card()] }, await work())
    expect([r.width, r.height]).toEqual([1080, 1920])
    expectCardAt(changedBox(await frameAt(r.outputPath, 1.0), BASE_RGB))
  }, 120_000)

  it("a SAR 2:1 base (540×1920 stored) renders at its display size 1080×1920", async () => {
    await makeBase(p("sar.mp4"), { width: 540, height: 1920, durationSec: 2, sar: "2/1" })
    const r = await renderVideoOverlay({ videoUrl: url("sar.mp4"), layers: [card()] }, await work())
    expect([r.width, r.height]).toEqual([1080, 1920])
    const v = (await probeStreams(r.outputPath)).find((s) => s.codecType === "video")!
    expect([v.width, v.height]).toEqual([1080, 1920])
    expectCardAt(changedBox(await frameAt(r.outputPath, 1.0), BASE_RGB))
  }, 120_000)

  it("EXIF-6 JPEG and WebP layers render upright (top red, bottom blue)", async () => {
    for (const [name, format] of [["exif6.jpg", "jpeg"], ["exif6.webp", "webp"]] as const) {
      await makeExifSplit(p(name), format)
      // top-left, 10 % wide, height follows the DISPLAY aspect (1:2): 108×216 at (0, 0)
      const r = await renderVideoOverlay(
        { videoUrl: url("base.mp4"), layers: [{ imageUrl: url(name), start: 0.5, end: 1.5, anchor: "top-left", x: 0, y: 0, width: 10, animate: false }] },
        await work(),
      )
      const f = await frameAt(r.outputPath, 1.0)
      expect(near(pixel(f, 54, 50), [255, 0, 0], 40)).toBe(true)
      expect(near(pixel(f, 54, 170), [0, 0, 255], 40)).toBe(true)
    }
  }, 120_000)

  it("an animated WebP renders its first frame and says so", async () => {
    await makeAnimatedWebp(p("anim.webp"))
    const r = await renderVideoOverlay(
      { videoUrl: url("base.mp4"), layers: [{ imageUrl: url("anim.webp"), start: 0.5, end: 1.5, anchor: "top-left", x: 10, y: 10, width: 10, animate: false }] },
      await work(),
    )
    expect(r.warnings).toEqual([{ layer: 0, code: "animated_first_frame", detail: "animated image (2 frames): its first frame is used" }])
    expect(near(pixel(await frameAt(r.outputPath, 1.0), 162, 246), [255, 0, 0], 12)).toBe(true)
  }, 120_000)

  it("an APNG goes the worker's own path — inspect, gate, pre-fit, render — and renders its first frame with NO warning (APNG is undetectable)", async () => {
    await makeApng(p("anim.png"))
    // top-left, x/y 10 %, 10 % wide, a 1:1 image on 1080×1920: 108×108 at (108, 192) — centre (162, 246)
    const r = await renderVideoOverlay(
      { videoUrl: url("base.mp4"), layers: [{ imageUrl: url("anim.png"), start: 0.5, end: 1.5, anchor: "top-left", x: 10, y: 10, width: 10, animate: false }] },
      await work(),
    )
    expect(r.warnings).toEqual([])
    expect(near(pixel(await frameAt(r.outputPath, 1.0), 162, 246), [255, 0, 0], 12)).toBe(true)
  }, 120_000)

  it("a PCM base is re-encoded to AAC and says so", async () => {
    await runFfmpeg(["-y", "-i", p("base.mp4"), "-c:v", "copy", "-c:a", "pcm_s16le", p("pcm.mov")])
    const r = await renderVideoOverlay({ videoUrl: url("pcm.mov"), layers: [card()] }, await work())
    expect(r.warnings).toEqual([{ code: "audio_reencoded", detail: "the base's pcm_s16le audio was re-encoded to AAC" }])
    expect((await probeStreams(r.outputPath)).find((s) => s.codecType === "audio")?.codecName).toBe("aac")
  }, 120_000)

  it("outputAspect 9:16 + contain pads a landscape base with the colour", async () => {
    await makeBase(p("wide.mp4"), { width: 640, height: 360, durationSec: 2 })
    const r = await renderVideoOverlay(
      { videoUrl: url("wide.mp4"), layers: [card()], outputAspect: "9:16", baseFit: "contain", backgroundColor: "#ff0000" },
      await work(),
    )
    const f = await frameAt(r.outputPath, 1.0)
    expect([f.width, f.height]).toEqual([1080, 1920])
    expect(near(pixel(f, 540, 10), [255, 0, 0], 12)).toBe(true)
  }, 120_000)

  it("a truncated PNG passes the header check but not the decode: refused once as 'not an image', libvips' text kept for the operator", async () => {
    await makeSolidPng(p("whole.png"), 64, 64, [0, 255, 0])
    const bytes = await fs.readFile(p("whole.png"))
    expect(bytes.length).toBeGreaterThan(100)
    // Keep the signature + IHDR (33 bytes) and half of the rest: IDAT is cut, IEND is gone.
    await fs.writeFile(p("truncated.png"), bytes.subarray(0, 33 + Math.floor((bytes.length - 33) / 2)))
    const layers = [{ imageUrl: url("truncated.png"), start: 0 }]
    const err = await renderVideoOverlay({ videoUrl: url("base.mp4"), layers }, await work()).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as Error).message).toBe("layers[0]: not an image (PNG, JPEG or WebP)")
    // Filed by the pre-fit (the header check passed): libvips' words ride for the operator only.
    expect((err as { internalDetails?: string }).internalDetails).toMatch(/png|vips|stream/i)
  }, 120_000)

  describe("video layers, stacks and a placed base", () => {
    const RED: Rgb = [255, 0, 0]
    const BLUE: Rgb = [0, 0, 255]
    const GREEN: Rgb = [0, 255, 0]
    const BLACK: Rgb = [0, 0, 0]
    const TOL = 24
    type Render = Parameters<typeof renderVideoOverlay>[0]
    // Each run is priced at the 60 s cap, as the route or the workflow run would write it.
    const render = async (job: Render) => renderVideoOverlay({ billedUnits: 12, ...job }, await work())
    const isNear = (rgb: Rgb, want: Rgb) => expect(near(rgb, want, TOL), `${rgb} ≈ ${want}`).toBe(true)
    const videoFacts = async (path: string) => (await probeStreams(path)).find((s) => s.codecType === "video")!
    const hasAudio = async (path: string) => (await probeStreams(path)).some((s) => s.codecType === "audio")

    beforeAll(async () => {
      // Tiny sources; a case with an outputAspect renders on 1080×1920 anyway, the others on a 320×180 base.
      await makeColourClip(p("red-16x9.mp4"), { width: 160, height: 90, colours: [RED], secondsEach: 2 })
      await makeColourClip(p("blue-16x9.mp4"), { width: 160, height: 90, colours: [BLUE], secondsEach: 2 })
      await makeBase(p("small.mp4"), { width: 320, height: 180, durationSec: 2 })
      await makeSolidPng(p("green-4x1.png"), 400, 100, GREEN)
    }, 120_000)

    it("stacks two videos whole on 9:16", async () => {
      const out = await render({ videoUrl: url("red-16x9.mp4"), outputAspect: "9:16", layout: "stack-whole", layers: [{ videoUrl: url("blue-16x9.mp4"), start: 0 }] })
      const f = await frameAt(out.outputPath, 1.0)
      expect([f.width, f.height]).toEqual([1080, 1920])
      isNear(pixel(f, 540, 650), RED)
      isNear(pixel(f, 540, 1250), BLUE)
      isNear(pixel(f, 540, 100), BLACK)
      // The join: base to y 959, layer from y 960 — no strip of background between them.
      isNear(pixel(f, 540, 957), RED)
      isNear(pixel(f, 540, 962), BLUE)
    }, 120_000)

    it("puts a 16:9 base at the bottom, images above it, with the base's own frame count", async () => {
      const out = await render({
        videoUrl: url("red-16x9.mp4"), outputAspect: "9:16", layout: "video-bottom",
        layers: [{ imageUrl: url("green-4x1.png"), start: 0, anchor: "top", x: 0, y: 8, width: 80 }],
      })
      const f = await frameAt(out.outputPath, 1.0)
      isNear(pixel(f, 540, 1600), RED)
      isNear(pixel(f, 540, 400), BLACK)
      isNear(pixel(f, 540, 250), GREEN)
      // The placed base's canvas is made from its own frames: 60 in, 60 out, at its rate.
      const v = await videoFacts(out.outputPath)
      expect([v.frames, v.rFrameRate]).toEqual([(await videoFacts(p("red-16x9.mp4"))).frames, "30/1"])
    }, 120_000)

    it("holds a short layer's last frame", async () => {
      await makeBase(p("grey-5s.mp4"), { width: 320, height: 180, durationSec: 5 })
      await makeColourClip(p("red-then-blue.mp4"), { width: 160, height: 90, colours: [RED, BLUE], secondsEach: 1 })
      // A 2 s layer in a 5 s window, top-left, half the width: 160×90 at (0, 0).
      const out = await render({ videoUrl: url("grey-5s.mp4"), layers: [{ videoUrl: url("red-then-blue.mp4"), start: 0, anchor: "top-left", x: 0, y: 0, width: 50 }] })
      isNear(pixel(await frameAt(out.outputPath, 0.5), 80, 45), RED)
      const late = pixel(await frameAt(out.outputPath, 1.9), 80, 45)
      isNear(late, BLUE)
      isNear(pixel(await frameAt(out.outputPath, 4.0), 80, 45), late)
    }, 120_000)

    it("warns layer_no_audio and still renders; the base's audio is untouched", async () => {
      const out = await render({ videoUrl: url("small.mp4"), layers: [{ videoUrl: url("blue-16x9.mp4"), start: 0, slot: 1, sound: { volume: 1 } }] })
      expect(out.warnings).toContainEqual(expect.objectContaining({ code: "layer_no_audio", slot: 1 }))
      expect(await audioMd5(out.outputPath)).toBe(await audioMd5(p("small.mp4")))
    }, 120_000)

    it("a layer with sound but no sound setting leaves the base's audio byte-identical", async () => {
      await makeColourClip(p("blue-tone.mp4"), { width: 160, height: 90, colours: [BLUE], secondsEach: 2, audio: "aac" })
      const out = await render({ videoUrl: url("small.mp4"), layers: [{ videoUrl: url("blue-tone.mp4"), start: 0 }] })
      expect(out.warnings).toEqual([])
      expect(await audioMd5(out.outputPath)).toBe(await audioMd5(p("small.mp4")))
    }, 120_000)

    it("a silent base with a layer's sound has audio", async () => {
      await makeBase(p("silent.mp4"), { width: 320, height: 180, durationSec: 2, audio: "none" })
      await makeColourClip(p("blue-tone-2.mp4"), { width: 160, height: 90, colours: [BLUE], secondsEach: 2, audio: "aac" })
      const out = await render({ videoUrl: url("silent.mp4"), layers: [{ videoUrl: url("blue-tone-2.mp4"), start: 0, sound: { volume: 0.8 } }] })
      expect(await hasAudio(out.outputPath)).toBe(true)
      const a = (await probeStreams(out.outputPath)).find((s) => s.codecType === "audio")!
      expect(a.codecName).toBe("aac")
    }, 120_000)

    it("a PCM base with a sounding layer is mixed to AAC and not reported as re-encoded", async () => {
      await runFfmpeg(["-y", "-i", p("small.mp4"), "-c:v", "copy", "-c:a", "pcm_s16le", p("small-pcm.mov")])
      await makeColourClip(p("blue-tone-3.mp4"), { width: 160, height: 90, colours: [BLUE], secondsEach: 2, audio: "aac" })
      const out = await render({ videoUrl: url("small-pcm.mov"), layers: [{ videoUrl: url("blue-tone-3.mp4"), start: 0, sound: { volume: 0.5 } }] })
      expect(out.warnings).toEqual([])
      expect((await probeStreams(out.outputPath)).find((s) => s.codecType === "audio")?.codecName).toBe("aac")
    }, 120_000)

    it("a loud base and a loud layer at volume 1: the mix peaks at most −1 dBFS, and the base alone keeps its level", async () => {
      // −3 dBFS + −1 dBFS sum to about +4 dBFS where they overlap: clipped without the limiter.
      await makeLoudToneClip(p("loud-base.mp4"), { width: 320, height: 180, rgb: BASE_RGB, durationSec: 3, frequency: 440, amplitude: 0.708 })
      await makeLoudToneClip(p("loud-layer.mp4"), { width: 160, height: 90, rgb: BLUE, durationSec: 2, frequency: 660, amplitude: 0.891 })
      const out = await render({ videoUrl: url("loud-base.mp4"), layers: [{ videoUrl: url("loud-layer.mp4"), start: 1, anchor: "top-left", x: 0, y: 0, width: 50, sound: { volume: 1 } }] })
      const peak = await samplePeakDbfs(out.outputPath)
      expect(peak, `mix peak ${peak.toFixed(2)} dBFS`).toBeLessThanOrEqual(-0.9)
      // Where the layer is heard, the sum is turned down to the limit, not below it.
      expect(await samplePeakDbfs(out.outputPath, 1.2, 2.8)).toBeGreaterThan(-2)
      // Before the layer starts, the base alone: its own level, unchanged by the limiter.
      const before = await rmsDbfs(out.outputPath, 0.1, 0.9)
      const source = await rmsDbfs(p("loud-base.mp4"), 0.1, 0.9)
      expect(Math.abs(before - source), `base ${before.toFixed(2)} vs source ${source.toFixed(2)} dBFS`).toBeLessThanOrEqual(0.2)
    }, 120_000)

    it("draws a rotated layer upright", async () => {
      // Stored 160×90, left blue | right red, tagged 90: displayed 90×160, the right half (red) on top, blue below.
      await makeSplitClip(p("split.mp4"), { width: 160, height: 90, left: BLUE, right: RED, durationSec: 2 })
      await tagRotation(p("split.mp4"), p("split-rot.mp4"), 90)
      // top-left, 25 % of 320 = 80 wide, height from the DISPLAY aspect (9:16): box 80×142, contain 78×142, even at (0, 0).
      const out = await render({ videoUrl: url("small.mp4"), layers: [{ videoUrl: url("split-rot.mp4"), start: 0, anchor: "top-left", x: 0, y: 0, width: 25 }] })
      const f = await frameAt(out.outputPath, 1.0)
      expect(changedBox(f, BASE_RGB)).toEqual({ left: 0, top: 0, width: 78, height: 142 })
      // Upright: the halves are top and bottom. Squashed instead, left and right would differ on every row.
      isNear(pixel(f, 40, 30), RED)
      isNear(pixel(f, 40, 112), BLUE)
      isNear(pixel(f, 8, 30), pixel(f, 70, 30))
    }, 120_000)

    it("a sounding layer keeps its picture and sound together, edit list or not, by timestamp and by sample count", async () => {
      await makeBase(p("silent-3s.mp4"), { width: 320, height: 180, durationSec: 3, audio: "none" })
      for (const [name, editList, pictureAfterSound] of [["flash-edl.mp4", true, 0], ["flash-noedl.mp4", false, 2 / FPS]] as const) {
        await makeFlashBeepClip(p(name), { editList })
        const src = await probeStreams(p(name))
        const offset = src.find((s) => s.codecType === "video")!.startTime! - src.find((s) => s.codecType === "audio")!.startTime!
        expect(Math.abs(offset - pictureAfterSound), `${name}: picture start − sound start`).toBeLessThan(0.002)
        // Half the 320 × 180 base, top-left: 160 × 90 at (0, 0); the flash and the beep are 1.0 s into the file's own time.
        const out = await render({ videoUrl: url("silent-3s.mp4"), layers: [{ videoUrl: url(name), start: 0.5, anchor: "top-left", x: 0, y: 0, width: 50, sound: { volume: 1 } }] })
        const flash = await flashTimeSec(out.outputPath, { left: 40, top: 20, width: 80, height: 50 })
        const beep = await beepTimeSec(out.outputPath)
        expect(flash, name).not.toBeNull()
        expect(beep, name).not.toBeNull()
        expect(Math.abs(beep! - flash!), `${name}: flash at ${flash} s, beep at ${beep} s`).toBeLessThanOrEqual(1 / FPS)
        // By sample count too: the no-edit-list file's 45 ms gap in its sound is filled, so a tool that
        // counts samples (a later mix, a re-encode) hears the beep where a player does.
        const counted = await beepSampleTimeSec(out.outputPath)
        expect(counted, name).not.toBeNull()
        expect(Math.abs(counted! - flash!), `${name}: flash at ${flash} s, beep at sample ${counted} s`).toBeLessThanOrEqual(1 / FPS)
        expect(Math.abs(flash! - (0.5 + 1 + pictureAfterSound)), `${name}: the flash where the file puts it`).toBeLessThanOrEqual(1 / FPS)
      }
    }, 120_000)

    it("refuses an image given as a video layer, once", async () => {
      const err = await render({ videoUrl: url("small.mp4"), layers: [{ videoUrl: url("green-4x1.png"), start: 0, slot: 1 }] }).catch((e: unknown) => e)
      expect(isDeterministicJobError(err)).toBe(true)
      expect((err as Error).message).toMatch(/Layer 1: not a video/)
    }, 120_000)

    it("keeps the base's frame count over a 24 fps layer", async () => {
      await makeColourClip(p("blue-24.mp4"), { width: 160, height: 90, colours: [BLUE], secondsEach: 2, fps: 24 })
      const out = await render({ videoUrl: url("small.mp4"), layers: [{ videoUrl: url("blue-24.mp4"), start: 0, anchor: "top-left", x: 0, y: 0, width: 50 }] })
      const v = await videoFacts(out.outputPath)
      const base = await videoFacts(p("small.mp4"))
      expect([v.frames, v.rFrameRate]).toEqual([base.frames, base.rFrameRate])
      isNear(pixel(await frameAt(out.outputPath, 1.0), 80, 45), BLUE)
    }, 120_000)
  })

  it("an MP3 with cover art is refused as not a video before any image is fetched (Review Focus 2)", async () => {
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", "libmp3lame", p("tone.mp3")])
    await runFfmpeg(["-y", "-i", p("tone.mp3"), "-i", p("magenta-1x2.png"), "-map", "0", "-map", "1", "-c", "copy", "-disposition:v:0", "attached_pic", p("cover.mp3")])
    const layers = [{ imageUrl: url("does-not-exist.png"), start: 0 }]
    const err = await renderVideoOverlay({ videoUrl: url("cover.mp3"), layers }, await work()).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as Error).message).toBe("The base input is not a video")
  }, 120_000)
})
