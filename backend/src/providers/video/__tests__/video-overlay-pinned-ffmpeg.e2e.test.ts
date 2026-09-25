// backend/src/providers/video/__tests__/video-overlay-pinned-ffmpeg.e2e.test.ts
/**
 * Decision 4's confirmation, as a test: the Video Overlay D1 chain run on the
 * ffmpeg the CI "Backend Tests" job installs — the production pin
 * (tools/install-pinned-ffmpeg.sh, Dockerfile FFMPEG_TARBALL_* ARGs). The argv
 * is written out BY HAND from spec §4.3 (the builder lands later and must not
 * be able to mask a build change): pre-fitted PNG inputs through
 * `-f image2 -loop 1 -framerate 30 -t`, no per-layer fit `scale`/`crop`, no
 * `enable`, the animation `scale=…:eval=frame` kept.
 *
 * Case "per-frame scale" is THE gate: if it fails on the pin, fade-only is
 * decision 4's contingency and needs Tal before anything else ships.
 *
 * The pin is an ASSERTION, not a log line: backend/src/test/setup.ts turns
 * every console method into a no-op, and `describe.skipIf(!ffmpegAvailable)`
 * would count a missing ffmpeg as "not failed". In CI the first case below
 * cannot skip, and it fails unless ffmpeg is present, libopus is present and
 * `ffmpeg -version` names the Dockerfile's pinned build — so a green "Backend
 * Tests" check means every case ran on the production pin.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { dirname, join } from "node:path"
import { promises as fs, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import sharp from "sharp"
import { runFfmpeg } from "../ffmpeg-utils.js"
import { prefitVideoOverlayLayer } from "../video-overlay-prefit.js"
import {
  BASE_RGB, FPS, audioMd5, changedBox, expectedScaleWidths, ffmpegAvailable, ffmpegVersionLine, frameAt,
  libopusAvailable, makeAnimatedWebp, makeApng, makeBase, makeExifSplit, makeSolidPng, near, offsetStart,
  pixel, probeStreams, showinfoSizes, tagRotation,
} from "./video-overlay-e2e-fixtures.js"

const EVEN_BASE = "scale=trunc(iw*sar/2)*2:trunc(ih/2)*2,setsar=1"
const CARD: HandLayer = { path: "", start: 0.5, end: 1.5, left: 252, top: 307, w: 576, h: 1152 }

interface HandLayer {
  readonly path: string
  readonly start: number
  readonly end: number
  readonly left: number
  readonly top: number
  readonly w: number
  readonly h: number
  readonly opacity?: number
  readonly animate?: boolean
}

/** Spec §4.3, spelled out. `showinfo` (test-only) logs the first layer's per-frame size. */
function handArgs(input: string, output: string, base: string, layers: readonly HandLayer[], opts: { showinfo?: boolean } = {}): string[] {
  const args = ["-y", "-i", input]
  const parts = [`[0:v]${base}[base]`]
  let prev = "base"
  layers.forEach((l, k) => {
    const dur = l.end - l.start
    args.push("-f", "image2", "-loop", "1", "-framerate", String(FPS), "-t", dur.toFixed(3), "-i", l.path)
    const f = ["format=rgba"]
    if (l.opacity !== undefined && l.opacity < 1) f.push(`colorchannelmixer=aa=${l.opacity.toFixed(3)}`)
    if (l.animate !== false) {
      const r = Math.min(0.15, dur / 2)
      const R = r.toFixed(3)
      const out = (dur - r).toFixed(3)
      const s = `(0.96+0.04*min(1,t/${R})-0.04*max(0,(t-${out})/${R}))`
      f.push(
        `fade=t=in:st=0:d=${R}:alpha=1`,
        `fade=t=out:st=${out}:d=${R}:alpha=1`,
        `scale=w='if(isnan(t),${l.w},trunc(${l.w}*${s}/2)*2)':h='if(isnan(t),${l.h},trunc(${l.h}*${s}/2)*2)':eval=frame`,
      )
      if (opts.showinfo && k === 0) f.push("showinfo")
    }
    f.push(`setpts=PTS+${l.start.toFixed(3)}/TB`)
    parts.push(`[${k + 1}:v]${f.join(",")}[ov${k + 1}]`)
    parts.push(`[${prev}][ov${k + 1}]overlay=x='${l.left}+(${l.w}-overlay_w)/2':y='${l.top}+(${l.h}-overlay_h)/2':eof_action=pass[v${k + 1}]`)
    prev = `v${k + 1}`
  })
  args.push(
    "-filter_complex", parts.join(";"),
    "-map", `[${prev}]`, "-map", "0:a:0?",
    "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
    "-c:a", "copy", "-movflags", "+faststart", output,
  )
  return args
}

/** The pinned build's version tag, read from the Dockerfile's amd64 tarball ARG (e.g. `n8.1.2-21-gce3c09c101`). */
function dockerfilePin(): string {
  const dockerfile = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../../../Dockerfile"), "utf8")
  const m = dockerfile.match(/ffmpeg-(n[0-9.]+-\d+-g[0-9a-f]+)-linux64/)
  if (!m) throw new Error("FFMPEG_TARBALL_URL_AMD64 not found in the Dockerfile")
  return m[1]!
}

// Outside the skipIf describe on purpose: in CI this case runs whatever the
// ffmpeg state, so "ffmpeg missing" or "some other ffmpeg" FAILS the file
// instead of skipping it. Locally (no CI env) it is skipped — a local run is
// never the confirmation.
it.runIf(!!process.env.CI)("runs on the production-pinned ffmpeg (CI)", () => {
  // Visible in the job log when the worker's stdout reaches it; the assertions are what count.
  process.stdout.write(`[video-overlay pinned smoke] ${ffmpegVersionLine()}\n`)
  expect(ffmpegAvailable).toBe(true)
  expect(libopusAvailable).toBe(true)
  expect(ffmpegVersionLine()).toContain(dockerfilePin())
})

describe.skipIf(!ffmpegAvailable)("Video Overlay D1 chain on the ffmpeg under test (production pin in CI)", () => {
  let dir: string
  const p = (name: string) => join(dir, name)
  let card: HandLayer

  beforeAll(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), "vo-pin-"))
    await makeBase(p("base.mp4"), { width: 1080, height: 1920, durationSec: 2 })
    await makeSolidPng(p("card-src.png"), 1080, 2160, [255, 0, 255])
    const fitted = await prefitVideoOverlayLayer(p("card-src.png"), p("card.png"), { width: 576, height: 1152 }, "contain")
    expect(fitted).toEqual({ width: 576, height: 1152 })
    card = { ...CARD, path: p("card.png") }
  }, 180_000)

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  })

  it("GATE — the animation scale is evaluated per frame (0.96 → 1.0 → 0.96, exactly S(t))", async () => {
    const sizes = await showinfoSizes(handArgs(p("base.mp4"), p("gate.mp4"), EVEN_BASE, [card], { showinfo: true }))
    const widths = expectedScaleWidths(576, 1)
    const heights = expectedScaleWidths(1152, 1)
    expect(sizes).toEqual(widths.map((w, i) => `${w}x${heights[i]}`))
    expect(new Set(sizes).size).toBeGreaterThanOrEqual(5)
  }, 120_000)

  it("renders the card only inside its window, centred on the drawn rect, audio byte-identical, cadence kept", async () => {
    await runFfmpeg(handArgs(p("base.mp4"), p("card-out.mp4"), EVEN_BASE, [card]))
    expect(changedBox(await frameAt(p("card-out.mp4"), 0.2), BASE_RGB)).toBeNull()
    expect(changedBox(await frameAt(p("card-out.mp4"), 1.8), BASE_RGB)).toBeNull()
    const mid = changedBox(await frameAt(p("card-out.mp4"), 1.0), BASE_RGB)!
    expect(Math.abs(mid.left - 252)).toBeLessThanOrEqual(2)
    expect(Math.abs(mid.top - 307)).toBeLessThanOrEqual(2)
    expect(Math.abs(mid.width - 576)).toBeLessThanOrEqual(2)
    expect(Math.abs(mid.height - 1152)).toBeLessThanOrEqual(2)
    // Well inside the fade-in ramp (never on the window's ±1-frame edge, spec §7 / audit F5):
    // two frames after the start the card is visible, still shrunk below 576 px, and centred on
    // the drawn rect — true whether the first layer frame landed on frame 15 or 16. The exact
    // per-frame sizes are the GATE case's (showinfo, frame-exact).
    const ramp = changedBox(await frameAt(p("card-out.mp4"), 0.5 + 2 / FPS), BASE_RGB)!
    expect(ramp.width).toBeLessThan(576)
    expect(Math.abs(ramp.left + ramp.width / 2 - (252 + 288))).toBeLessThanOrEqual(2)
    expect(await audioMd5(p("card-out.mp4"))).toBe(await audioMd5(p("base.mp4")))
    const v = (await probeStreams(p("card-out.mp4"))).find((s) => s.codecType === "video")!
    expect(v.frames).toBe(60)
    expect(v.rFrameRate).toBe("30/1")
    expect(Math.abs((v.duration ?? 0) - 2)).toBeLessThanOrEqual(1 / FPS)
  }, 120_000)

  it("a base whose start_time is 1.0 lands the card at the same player time; skew moves by at most one frame; audio byte-identical", async () => {
    await offsetStart(p("base.mp4"), p("start1.mp4"), 1)
    await runFfmpeg(handArgs(p("start1.mp4"), p("start1-out.mp4"), EVEN_BASE, [card]))
    const skew = (streams: Awaited<ReturnType<typeof probeStreams>>) =>
      (streams.find((s) => s.codecType === "video")!.startTime ?? 0) - (streams.find((s) => s.codecType === "audio")!.startTime ?? 0)
    const inSkew = skew(await probeStreams(p("start1.mp4")))
    const outSkew = skew(await probeStreams(p("start1-out.mp4")))
    expect(Math.abs(outSkew - inSkew)).toBeLessThanOrEqual(1 / FPS + 0.001)
    expect(await audioMd5(p("start1-out.mp4"))).toBe(await audioMd5(p("start1.mp4")))
    expect(changedBox(await frameAt(p("start1-out.mp4"), 0.2), BASE_RGB)).toBeNull()
    expect(changedBox(await frameAt(p("start1-out.mp4"), 1.0), BASE_RGB)).not.toBeNull()
    expect(changedBox(await frameAt(p("start1-out.mp4"), 1.8), BASE_RGB)).toBeNull()
  }, 120_000)

  it("a rotation-tagged base (stored 1920×1080, tag 90) enters upright: 1080×1920 output, the card centred on it", async () => {
    await makeBase(p("land.mp4"), { width: 1920, height: 1080, durationSec: 2 })
    await tagRotation(p("land.mp4"), p("rot.mp4"), 90)
    await runFfmpeg(handArgs(p("rot.mp4"), p("rot-out.mp4"), EVEN_BASE, [card]))
    const f = await frameAt(p("rot-out.mp4"), 1.0)
    expect([f.width, f.height]).toEqual([1080, 1920])
    const box = changedBox(f, BASE_RGB)!
    expect(Math.abs(box.left - 252)).toBeLessThanOrEqual(2)
    expect(Math.abs(box.width - 576)).toBeLessThanOrEqual(2)
  }, 120_000)

  it("a SAR 2:1 base (540×1920, display 9:16) renders at 1080×1920 square pixels", async () => {
    await makeBase(p("sar.mp4"), { width: 540, height: 1920, durationSec: 2, sar: "2/1" })
    await runFfmpeg(handArgs(p("sar.mp4"), p("sar-out.mp4"), EVEN_BASE, [card]))
    const v = (await probeStreams(p("sar-out.mp4"))).find((s) => s.codecType === "video")!
    expect([v.width, v.height]).toEqual([1080, 1920])
    expect(v.sar === undefined || v.sar === "1:1").toBe(true)
    const box = changedBox(await frameAt(p("sar-out.mp4"), 1.0), BASE_RGB)!
    expect(Math.abs(box.left - 252)).toBeLessThanOrEqual(2)
  }, 120_000)

  it("EXIF-6 JPEG and EXIF-6 WebP layers are pre-fitted upright (top red, bottom blue) and render that way", async () => {
    for (const format of ["jpeg", "webp"] as const) {
      const src = p(`exif6.${format === "jpeg" ? "jpg" : "webp"}`)
      await makeExifSplit(src, format)
      const fitted = p(`exif6-${format}.png`)
      expect(await prefitVideoOverlayLayer(src, fitted, { width: 100, height: 200 }, "contain")).toEqual({ width: 100, height: 200 })
      expect((await sharp(fitted).metadata()).orientation).toBeUndefined()
      const out = p(`exif6-${format}.mp4`)
      await runFfmpeg(handArgs(p("base.mp4"), out, EVEN_BASE, [{ path: fitted, start: 0.5, end: 1.5, left: 10, top: 10, w: 100, h: 200, animate: false }]))
      const f = await frameAt(out, 1.0)
      expect(near(pixel(f, 60, 40), [255, 0, 0], 40)).toBe(true)
      expect(near(pixel(f, 60, 180), [0, 0, 255], 40)).toBe(true)
    }
  }, 120_000)

  it("animated WebP and APNG layers contribute their FIRST frame (red) through the pre-fit", async () => {
    await makeAnimatedWebp(p("anim.webp"))
    await makeApng(p("anim.png"))
    expect((await sharp(p("anim.webp")).metadata()).pages).toBe(2)
    await prefitVideoOverlayLayer(p("anim.webp"), p("anim-w.png"), { width: 100, height: 100 }, "contain")
    await prefitVideoOverlayLayer(p("anim.png"), p("anim-a.png"), { width: 100, height: 100 }, "contain")
    await runFfmpeg(handArgs(p("base.mp4"), p("anim-out.mp4"), EVEN_BASE, [
      { path: p("anim-w.png"), start: 0.5, end: 1.5, left: 100, top: 100, w: 100, h: 100, animate: false },
      { path: p("anim-a.png"), start: 0.5, end: 1.5, left: 400, top: 100, w: 100, h: 100, animate: false },
    ]))
    const f = await frameAt(p("anim-out.mp4"), 1.0)
    expect(near(pixel(f, 150, 150), [255, 0, 0], 12)).toBe(true)
    expect(near(pixel(f, 450, 150), [255, 0, 0], 12)).toBe(true)
  }, 120_000)

  it("alpha PNG composites over the base; colorchannelmixer=aa multiplies the alpha", async () => {
    await makeSolidPng(p("alpha-src.png"), 300, 300, [0, 200, 0], 0.5)
    await prefitVideoOverlayLayer(p("alpha-src.png"), p("alpha.png"), { width: 200, height: 200 }, "contain")
    await runFfmpeg(handArgs(p("base.mp4"), p("alpha-out.mp4"), EVEN_BASE, [
      { path: p("alpha.png"), start: 0.5, end: 1.5, left: 100, top: 100, w: 200, h: 200, animate: false },
      { path: p("alpha.png"), start: 0.5, end: 1.5, left: 500, top: 100, w: 200, h: 200, animate: false, opacity: 0.5 },
    ]))
    const f = await frameAt(p("alpha-out.mp4"), 1.0)
    expect(near(pixel(f, 200, 200), [32, 132, 32], 12)).toBe(true) // 50 % green over grey
    expect(near(pixel(f, 600, 200), [48, 98, 48], 12)).toBe(true) // 25 % green over grey
  }, 120_000)

  it("a very tall image (400×4000 at width 60 %, no height) is pre-fitted to 192×1920 and drawn inside the frame", async () => {
    await makeSolidPng(p("tall-src.png"), 400, 4000, [255, 255, 0])
    expect(await prefitVideoOverlayLayer(p("tall-src.png"), p("tall.png"), { width: 192, height: 1920 }, "contain")).toEqual({ width: 192, height: 1920 })
    await runFfmpeg(handArgs(p("base.mp4"), p("tall-out.mp4"), EVEN_BASE, [{ path: p("tall.png"), start: 0.5, end: 1.5, left: 444, top: 0, w: 192, h: 1920, animate: false }]))
    const box = changedBox(await frameAt(p("tall-out.mp4"), 1.0), BASE_RGB)!
    expect(Math.abs(box.left - 444)).toBeLessThanOrEqual(2)
    expect(Math.abs(box.height - 1920)).toBeLessThanOrEqual(2)
  }, 120_000)

  it("a base with no audio yields a video-only file (0:a:0? is optional)", async () => {
    await makeBase(p("silent.mp4"), { width: 640, height: 360, durationSec: 2, audio: "none" })
    await makeSolidPng(p("dot.png"), 50, 50, [255, 0, 255])
    await runFfmpeg(handArgs(p("silent.mp4"), p("silent-out.mp4"), EVEN_BASE, [{ path: p("dot.png"), start: 0.5, end: 1.5, left: 10, top: 10, w: 50, h: 50 }]))
    expect((await probeStreams(p("silent-out.mp4"))).map((s) => s.codecType)).toEqual(["video"])
  }, 120_000)

  // Skips only on a local build without libopus. In CI it always runs — the pin case above
  // already requires libopus there, so "Opus copy" can never be confirmed by a skip.
  it.skipIf(!libopusAvailable && !process.env.CI)("an Opus base stream-copies into MP4 byte-identically (no -strict)", async () => {
    await makeBase(p("opus.mp4"), { width: 640, height: 360, durationSec: 2, audio: "opus" })
    await runFfmpeg(handArgs(p("opus.mp4"), p("opus-out.mp4"), EVEN_BASE, [{ path: p("dot.png"), start: 0.5, end: 1.5, left: 10, top: 10, w: 50, h: 50 }]))
    expect((await probeStreams(p("opus-out.mp4"))).find((s) => s.codecType === "audio")?.codecName).toBe("opus")
    expect(await audioMd5(p("opus-out.mp4"))).toBe(await audioMd5(p("opus.mp4")))
  }, 120_000)

  it("contain onto a target canvas pads with a non-black colour (0xff0000)", async () => {
    await makeBase(p("wide.mp4"), { width: 640, height: 360, durationSec: 2 })
    const contain = "scale=iw*sar:ih,setsar=1,scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=0xff0000"
    await runFfmpeg(handArgs(p("wide.mp4"), p("contain-out.mp4"), contain, [{ path: p("dot.png"), start: 0.5, end: 1.5, left: 10, top: 900, w: 50, h: 50 }]))
    const f = await frameAt(p("contain-out.mp4"), 1.0)
    expect([f.width, f.height]).toEqual([1080, 1920])
    expect(near(pixel(f, 540, 10), [255, 0, 0], 12)).toBe(true)
    expect(near(pixel(f, 540, 960), BASE_RGB, 12)).toBe(true)
  }, 120_000)

  it("a 0.02 s layer (shorter than 2R and than one frame) still configures and renders", async () => {
    await runFfmpeg(handArgs(p("base.mp4"), p("short-out.mp4"), EVEN_BASE, [{ path: p("dot.png"), start: 0.5, end: 0.52, left: 10, top: 10, w: 50, h: 50 }]))
    const v = (await probeStreams(p("short-out.mp4"))).find((s) => s.codecType === "video")!
    expect(v.frames).toBe(60)
  }, 120_000)

  it("a 20-layer chain configures and runs", async () => {
    const layers = Array.from({ length: 20 }, (_, i) => ({ path: p("dot.png"), start: i * 0.09, end: i * 0.09 + 0.2, left: 10 + i * 40, top: 10, w: 50, h: 50 }))
    await runFfmpeg(handArgs(p("base.mp4"), p("twenty-out.mp4"), EVEN_BASE, layers))
    expect((await probeStreams(p("twenty-out.mp4"))).find((s) => s.codecType === "video")!.frames).toBe(60)
  }, 120_000)
})
