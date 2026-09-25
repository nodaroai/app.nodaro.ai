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
  BASE_RGB, FPS, audioMd5, changedBox, ffmpegAvailable, frameAt, makeAnimatedWebp, makeApng, makeBase, makeExifSplit,
  makeSolidPng, near, offsetStart, pixel, probeStreams, tagRotation,
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

  it("an MP3 with cover art is refused as not a video before any image is fetched (Review Focus 2)", async () => {
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", "libmp3lame", p("tone.mp3")])
    await runFfmpeg(["-y", "-i", p("tone.mp3"), "-i", p("magenta-1x2.png"), "-map", "0", "-map", "1", "-c", "copy", "-disposition:v:0", "attached_pic", p("cover.mp3")])
    const layers = [{ imageUrl: url("does-not-exist.png"), start: 0 }]
    const err = await renderVideoOverlay({ videoUrl: url("cover.mp3"), layers }, await work()).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as Error).message).toBe("The base input is not a video")
  }, 120_000)
})
