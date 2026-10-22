import { describe, it, expect } from "vitest"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFileSync } from "node:child_process"
import { resolveMaskCompositeSettings } from "@nodaro/shared/media"
import { buildMaskCompositeArgs, buildMaskCompositeFillArgs, maskCompositePixelBlockPx, maskCompositeTimeoutMs, type MaskCompositeProbe } from "../mask-composite.js"
import { runFfmpeg } from "../ffmpeg-utils.js"

const PROBE: MaskCompositeProbe = { width: 641, height: 361, frameRate: "30/1", durationSec: 2, foregroundHasAudio: true, backgroundHasAudio: true }
const graphOf = (argv: string[]) => argv[argv.indexOf("-filter_complex") + 1]!
const build = (data: Record<string, unknown>, probe: MaskCompositeProbe = PROBE) =>
  buildMaskCompositeArgs({ foregroundPath: "fg.mp4", backgroundPath: "bg.mp4", maskPath: "m.mp4", outputPath: "o.mp4", settings: resolveMaskCompositeSettings(data), probe })

describe("buildMaskCompositeArgs", () => {
  it("renders on the foreground's (even) frame and length, looping the background", () => {
    const argv = build({})
    const g = graphOf(argv)
    expect(g).toContain("[0:v]fps=30/1,scale=640:360")
    expect(g).toContain("[2:v]setpts=PTS-STARTPTS,scale=640:360")
    expect(argv.join(" ")).toContain("-stream_loop -1 -i bg.mp4")
    expect(argv[argv.indexOf("-t") + 1]).toBe("2.000")
    // The mask holds its last frame so a short mask never ends the render.
    expect(g).toContain("tpad=stop_mode=clone:stop=-1")
  })
  it("composites a late foreground on a clock starting at 0 and puts its start back on the output, rendering to its last frame", () => {
    const argv = build({}, { ...PROBE, startSec: 0.1 })
    const g = graphOf(argv)
    expect(g).toContain("[0:v]setpts=PTS-STARTPTS,fps=30/1,scale=640:360,")
    expect(g).toContain("[2:v]setpts=PTS-STARTPTS,scale=640:360,")
    expect(g).toContain("format=yuv420p,setpts=PTS+round(0.100000/TB)[vout]")
    expect(argv[argv.indexOf("-t") + 1]).toBe("2.100")
    // A picture starting at 0: the foreground and the output are left as they were.
    expect(graphOf(build({}))).toContain("[0:v]fps=30/1,scale=640:360,")
    expect(graphOf(build({}))).toContain("format=yuv420p[vout]")
  })
  it("starts the background with the foreground, so no bare background frame comes before a late foreground (23.976 fps, a fraction of a frame late)", () => {
    const probe = { ...PROBE, frameRate: "24000/1001", durationSec: 97 * 1001 / 24000, startSec: 0.041 }
    const g = graphOf(build({ invertMask: true, backgroundFit: "stretch" }, probe))
    expect(g).toContain("[1:v]setpts=PTS-STARTPTS,scale=640:360,setsar=1,fps=24000/1001,format=yuv420p[bg]")
    expect(g).toContain("[2:v]setpts=PTS-STARTPTS,scale=640:360,")
    expect(g).toContain(",setpts=PTS+round(0.041000/TB)[vout]")
  })
  it("bounds the render to the foreground's frame count when the probe has one (the overlay follows the looped background)", () => {
    const argv = build({}, { ...PROBE, frameCount: 60 })
    expect(argv.slice(argv.indexOf("-frames:v"), argv.indexOf("-frames:v") + 2)).toEqual(["-frames:v", "60"])
    expect(argv[argv.indexOf("-t") + 1]).toBe("2.000")
    expect(build({})).not.toContain("-frames:v")
  })
  it("squares a non-square-pixel foreground instead of stretching it", () => {
    expect(graphOf(build({}, { ...PROBE, width: 720, height: 480, sar: 32 / 27 }))).toContain("[0:v]fps=30/1,scale=852:480")
  })
  it("normalises the mask range so near-black is fully background and near-white fully foreground", () => {
    expect(graphOf(build({}))).toContain("lut=c0='clip((val-24)*255/206,0,255)'")
  })
  it("applies invert, grow (one morphology pass per pixel) and feather in that order", () => {
    const g = graphOf(build({ invertMask: true, grow: 3, feather: 6 }))
    expect(g).toMatch(/negate,dilation,dilation,dilation,gblur=sigma=3\.00/)
    expect(graphOf(build({ grow: -2 }))).toMatch(/erosion,erosion/)
    expect(graphOf(build({ feather: 0 }))).not.toContain("gblur")
  })
  it("fits the background per setting", () => {
    expect(graphOf(build({ backgroundFit: "cover" }))).toContain("force_original_aspect_ratio=increase,crop=640:360")
    expect(graphOf(build({ backgroundFit: "contain" }))).toContain("force_original_aspect_ratio=decrease,pad=640:360")
    expect(graphOf(build({ backgroundFit: "stretch" }))).toContain("[1:v]setpts=PTS-STARTPTS,scale=640:360,setsar=1")
  })
  it("picks the sound: one track, both mixed, or none — and degrades when a track is missing", () => {
    expect(build({ audioSource: "foreground" })).toEqual(expect.arrayContaining(["-map", "0:a:0", "-c:a", "aac"]))
    expect(build({ audioSource: "background" })).toEqual(expect.arrayContaining(["-map", "1:a:0"]))
    expect(graphOf(build({ audioSource: "mix" }))).toContain("amix=inputs=2:duration=first")
    // Equal level, not a sum: two loud tracks never clip.
    expect(graphOf(build({ audioSource: "mix" }))).not.toContain("normalize=0")
    expect(build({ audioSource: "none" })).toContain("-an")
    expect(build({ audioSource: "mix" }, { ...PROBE, backgroundHasAudio: false })).toEqual(expect.arrayContaining(["-map", "0:a:0"]))
    expect(build({ audioSource: "foreground" }, { ...PROBE, foregroundHasAudio: false })).toContain("-an")
  })
  it("clamps and defaults node data the panel never wrote", () => {
    const s = resolveMaskCompositeSettings({ feather: 99, grow: -40, backgroundFit: "tile", audioSource: 3 })
    expect(s).toEqual({ invertMask: false, feather: 20, grow: -10, opacity: 1, fill: "video", pixelSizePct: 1.25, blurStrengthPct: 2, backgroundFit: "cover", audioSource: "foreground" })
    expect(resolveMaskCompositeSettings({ fill: "mosaic" }).fill).toBe("video")
    expect(resolveMaskCompositeSettings({ fill: "blur" }).fill).toBe("blur")
    expect(resolveMaskCompositeSettings({ pixelSizePct: 0.05 }).pixelSizePct).toBe(0.2)
    expect(resolveMaskCompositeSettings({ pixelSizePct: 50 }).pixelSizePct).toBe(10)
    expect(resolveMaskCompositeSettings({ pixelSizePct: 3.3 }).pixelSizePct).toBe(3.3)
    expect(resolveMaskCompositeSettings({ blurStrengthPct: 0 }).blurStrengthPct).toBe(0.1)
    expect(resolveMaskCompositeSettings({ blurStrengthPct: 9 }).blurStrengthPct).toBe(5)
    expect(resolveMaskCompositeSettings({ blurStrengthPct: "1" }).blurStrengthPct).toBe(2)
    expect(resolveMaskCompositeSettings({ opacity: 1.5 }).opacity).toBe(1)
    expect(resolveMaskCompositeSettings({ opacity: -0.2 }).opacity).toBe(0)
    expect(resolveMaskCompositeSettings({ opacity: 0.85 }).opacity).toBe(0.85)
    expect(resolveMaskCompositeSettings({ opacity: "0.5" }).opacity).toBe(1)
  })
  it("opacity 1 (the default) leaves the graph exactly as it was", () => {
    const argv = build({ invertMask: true, grow: 2, feather: 4 })
    expect(build({ invertMask: true, grow: 2, feather: 4, opacity: 1 })).toEqual(argv)
    expect(graphOf(argv)).toContain(
      "[2:v]setpts=PTS-STARTPTS,scale=640:360,setsar=1,format=gray,lut=c0='clip((val-24)*255/206,0,255)',negate,dilation,dilation,gblur=sigma=2.00,fps=30/1,tpad=stop_mode=clone:stop=-1[m]",
    )
  })
  it("opacity < 1 scales the finished mask (after invert / grow / feather), so inside it the result is opacity × foreground + (1 − opacity) × background", () => {
    expect(graphOf(build({ invertMask: true, grow: 2, feather: 4, opacity: 0.85 }))).toContain(
      "[2:v]setpts=PTS-STARTPTS,scale=640:360,setsar=1,format=gray,lut=c0='clip((val-24)*255/206,0,255)',negate,dilation,dilation,gblur=sigma=2.00,lut=c0='val*0.8500',fps=30/1,tpad=stop_mode=clone:stop=-1[m]",
    )
    expect(graphOf(build({ opacity: 0 }))).toContain("lut=c0='val*0.0000'")
  })
  it("the video fill's argv is byte-identical to the graph before fills existed (defaults, and every setting at once)", () => {
    // Captured from the builder before `fill` was added; the video fill must never move — except
    // for `fps` on the foreground, which puts it on the mask's frame grid (frame N meets mask N).
    expect(build({})).toEqual([
      "-y", "-i", "fg.mp4", "-stream_loop", "-1", "-i", "bg.mp4", "-i", "m.mp4",
      "-filter_complex",
      "[0:v]fps=30/1,scale=640:360,setsar=1,format=yuva420p[fg];[1:v]setpts=PTS-STARTPTS,scale=640:360:force_original_aspect_ratio=increase,crop=640:360,setsar=1,fps=30/1,format=yuv420p[bg];[2:v]setpts=PTS-STARTPTS,scale=640:360,setsar=1,format=gray,lut=c0='clip((val-24)*255/206,0,255)',gblur=sigma=1.00,fps=30/1,tpad=stop_mode=clone:stop=-1[m];[fg][m]alphamerge[fga];[bg][fga]overlay=format=auto:shortest=1,format=yuv420p[vout]",
      "-map", "[vout]", "-map", "0:a:0", "-t", "2.000",
      "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "o.mp4",
    ])
    const every = { invertMask: true, grow: 2, feather: 4, backgroundFit: "contain", audioSource: "mix" }
    const before = [
      "-y", "-i", "fg.mp4", "-stream_loop", "-1", "-i", "bg.mp4", "-i", "m.mp4",
      "-filter_complex",
      "[0:v]fps=30/1,scale=640:360,setsar=1,format=yuva420p[fg];[1:v]setpts=PTS-STARTPTS,scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30/1,format=yuv420p[bg];[2:v]setpts=PTS-STARTPTS,scale=640:360,setsar=1,format=gray,lut=c0='clip((val-24)*255/206,0,255)',negate,dilation,dilation,gblur=sigma=2.00,fps=30/1,tpad=stop_mode=clone:stop=-1[m];[fg][m]alphamerge[fga];[bg][fga]overlay=format=auto:shortest=1,format=yuv420p[vout];[0:a:0][1:a:0]amix=inputs=2:duration=first:dropout_transition=0[aout]",
      "-map", "[vout]", "-map", "[aout]", "-t", "2.000",
      "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "o.mp4",
    ]
    expect(build(every)).toEqual(before)
    // pixelSizePct / blurStrengthPct are inert on the video fill.
    expect(build({ ...every, fill: "video", opacity: 1, pixelSizePct: 3, blurStrengthPct: 4 })).toEqual(before)
  })
  it("gives longer composites a longer kill budget", () => {
    expect(maskCompositeTimeoutMs(300)).toBeGreaterThan(maskCompositeTimeoutMs(10))
  })
})

describe("buildMaskCompositeFillArgs (pixelate / blur)", () => {
  const BG_PROBE: MaskCompositeProbe = { ...PROBE, foregroundHasAudio: false }
  const fillBuild = (data: Record<string, unknown>, probe: MaskCompositeProbe = BG_PROBE) =>
    buildMaskCompositeFillArgs({ backgroundPath: "bg.mp4", maskPath: "m.mp4", outputPath: "o.mp4", settings: resolveMaskCompositeSettings(data), probe })

  it("pixelate: the background, split; one copy area-averaged into blocks of pixelSizePct % of the width and scaled back with nearest-neighbour, laid over the other through the mask", () => {
    // 5 % of 640 = 32 px blocks.
    const argv = fillBuild({ fill: "pixelate", pixelSizePct: 5 })
    expect(argv.slice(0, 5)).toEqual(["-y", "-i", "bg.mp4", "-i", "m.mp4"])
    expect(argv).not.toContain("-stream_loop")
    expect(argv).not.toContain("fg.mp4")
    expect(graphOf(argv)).toBe(
      "[0:v]fps=30/1,scale=640:360,setsar=1,format=yuv420p,split=2[bg][src];" +
        // 640/32 = 20, 360/32 = 11.25 → 11 blocks.
        "[src]scale=20:11:flags=area,scale=640:360:flags=neighbor,format=yuva420p[fx];" +
        "[1:v]setpts=PTS-STARTPTS,scale=640:360,setsar=1,format=gray,lut=c0='clip((val-24)*255/206,0,255)',gblur=sigma=1.00,fps=30/1,tpad=stop_mode=clone:stop=-1[m];" +
        "[fx][m]alphamerge[fxa];[bg][fxa]overlay=format=auto:shortest=1,format=yuv420p[vout]",
    )
    expect(argv[argv.indexOf("-t") + 1]).toBe("2.000")
  })
  it("pixelate blocks are relative to the width: the default 1.25 % is 16 px on a 1280-wide frame, 8 px on 640, and never under 2 px", () => {
    expect(maskCompositePixelBlockPx({ pixelSizePct: 1.25 }, 1280)).toBe(16)
    expect(maskCompositePixelBlockPx({ pixelSizePct: 1.25 }, 640)).toBe(8)
    expect(maskCompositePixelBlockPx({ pixelSizePct: 0.2 }, 640)).toBe(2)
    expect(graphOf(fillBuild({ fill: "pixelate" }))).toContain("[src]scale=80:45:flags=area,scale=640:360:flags=neighbor")
    expect(graphOf(fillBuild({ fill: "pixelate" }, { ...BG_PROBE, width: 1280, height: 720 }))).toContain("[src]scale=80:45:flags=area,scale=1280:720:flags=neighbor")
  })
  it("pixelate never asks for fewer than one block either way", () => {
    expect(graphOf(fillBuild({ fill: "pixelate", pixelSizePct: 10 }, { ...BG_PROBE, width: 60, height: 2 }))).toContain("[src]scale=10:1:flags=area,scale=60:2:flags=neighbor")
  })
  it("blur: a gaussian at sigma = blurStrengthPct % of the width (the default 2 % ≈ 25.6 px on 1280)", () => {
    expect(graphOf(fillBuild({ fill: "blur" }))).toContain("[src]gblur=sigma=12.80,format=yuva420p[fx]")
    expect(graphOf(fillBuild({ fill: "blur" }, { ...BG_PROBE, width: 1280, height: 720 }))).toContain("[src]gblur=sigma=25.60,")
    expect(graphOf(fillBuild({ fill: "blur", blurStrengthPct: 0.1 }))).toContain("[src]gblur=sigma=0.64,")
    expect(graphOf(fillBuild({ fill: "blur", blurStrengthPct: 5 }))).toContain("[src]gblur=sigma=32.00,")
  })
  it("the mask chain is the video fill's: invert / grow / feather, and opacity scales it", () => {
    const g = graphOf(fillBuild({ fill: "pixelate", invertMask: true, grow: 2, feather: 4, opacity: 0.85 }))
    expect(g).toContain(
      "[1:v]setpts=PTS-STARTPTS,scale=640:360,setsar=1,format=gray,lut=c0='clip((val-24)*255/206,0,255)',negate,dilation,dilation,gblur=sigma=2.00,lut=c0='val*0.8500',fps=30/1,tpad=stop_mode=clone:stop=-1[m]",
    )
    expect(graphOf(fillBuild({ fill: "blur", opacity: 0.5 }))).toContain("lut=c0='val*0.5000'")
    expect(graphOf(fillBuild({ fill: "blur" }))).not.toContain("val*")
  })
  it("follows the background's clock and frame: a late picture is composited from 0 and its start put back, non-square pixels are squared", () => {
    const argv = fillBuild({ fill: "blur" }, { ...BG_PROBE, startSec: 0.1, width: 720, height: 480, sar: 32 / 27 })
    expect(graphOf(argv)).toContain("[0:v]setpts=PTS-STARTPTS,fps=30/1,scale=852:480,")
    expect(graphOf(argv)).toContain("[1:v]setpts=PTS-STARTPTS,scale=852:480,")
    expect(graphOf(argv)).toContain("format=yuv420p,setpts=PTS+round(0.100000/TB)[vout]")
    expect(graphOf(fillBuild({ fill: "blur" }))).toContain("[0:v]fps=30/1,scale=")
    expect(argv[argv.indexOf("-t") + 1]).toBe("2.100")
  })
  it("always carries the background's sound, whatever audioSource says (none included); silent only when the background is", () => {
    for (const audioSource of ["foreground", "background", "mix", "none"]) {
      const argv = fillBuild({ fill: "pixelate", audioSource })
      expect(argv).toEqual(expect.arrayContaining(["-map", "0:a:0", "-c:a", "aac"]))
      expect(graphOf(argv)).not.toContain("amix")
    }
    expect(fillBuild({ fill: "blur", audioSource: "background" }, { ...BG_PROBE, backgroundHasAudio: false })).toContain("-an")
  })
})

const frameCount = (file: string) =>
  Number(execFileSync("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", file]).toString().trim())

describe("mask composite (real ffmpeg)", () => {
  // A 25-frame foreground at `rate` whose picture starts one frame late (as a re-timed upload can),
  // a background and a mask at other rates. Every fill renders exactly the followed video's frames.
  it.each([
    ["24000/1001", "24/1"], ["30000/1001", "30/1"], ["60000/1001", "25/1"], ["24/1", "30000/1001"], ["30/1", "24/1"],
  ] as const)("renders exactly the source's frame count at %s (background / mask at %s), picture one frame late or not", async (rate, otherRate) => {
    const dir = await mkdtemp(join(tmpdir(), "mask-composite-frames-"))
    try {
      const [num, den = "1"] = rate.split("/")
      const frameSec = Number(den) / Number(num)
      const clip = (src: string, r: string, file: string, extra: string[] = []) =>
        execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `${src}${src.includes("=") ? ":" : "="}s=160x90:r=${r}`, ...extra, "-c:v", "libx264", "-pix_fmt", "yuv420p", file])
      const fgRaw = join(dir, "fg-raw.mp4"), fgLate = join(dir, "fg-late.mp4"), bg = join(dir, "bg.mp4"), mask = join(dir, "mask.mp4")
      clip("testsrc", rate, fgRaw, ["-frames:v", "25"])
      execFileSync("ffmpeg", ["-v", "error", "-y", "-i", fgRaw, "-c", "copy", "-output_ts_offset", frameSec.toFixed(6), fgLate])
      clip("color=c=gray", otherRate, bg, ["-t", "2"])
      clip("color=c=black", otherRate, mask, ["-t", "2", "-vf", "drawbox=x=40:y=20:w=80:h=50:color=white:t=fill"])
      const { probeVideoOverlayBase } = await import("../ffmpeg-utils.js")
      for (const fg of [fgRaw, fgLate]) {
        const p = await probeVideoOverlayBase(fg)
        expect(p.frameCount).toBe(25)
        const probe = { width: 160, height: 90, frameRate: rate, durationSec: p.streamDurationSec, startSec: p.startTimeSec, frameCount: p.frameCount, foregroundHasAudio: false, backgroundHasAudio: false }
        const out = join(dir, "out.mp4")
        await runFfmpeg(buildMaskCompositeArgs({
          foregroundPath: fg, backgroundPath: bg, maskPath: mask, outputPath: out,
          settings: resolveMaskCompositeSettings({ invertMask: true, backgroundFit: "stretch" }), probe,
        }), 60_000)
        expect(frameCount(out)).toBe(25)
        for (const fill of ["blur", "pixelate"]) {
          // Pixelate / blur follow the BACKGROUND: here the 25-frame clip is the background.
          await runFfmpeg(buildMaskCompositeFillArgs({ backgroundPath: fg, maskPath: mask, outputPath: out, settings: resolveMaskCompositeSettings({ fill, invertMask: true }), probe }), 60_000)
          expect(frameCount(out)).toBe(25)
        }
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("keeps the mask on the foreground's frames when the foreground's picture starts late", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mask-composite-offset-"))
    try {
      const fgRaw = join(dir, "fg-raw.mp4"), fg = join(dir, "fg.mp4"), bg = join(dir, "bg.mp4"), mask = join(dir, "mask.mp4"), out = join(dir, "out.mp4")
      // Foreground: red for its first 10 frames, green after (10 fps); its picture starts at 0.5 s.
      execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=160x90:r=10:d=1", "-f", "lavfi", "-i", "color=c=green:s=160x90:r=10:d=1",
        "-filter_complex", "[0][1]concat=n=2:v=1[v]", "-map", "[v]", "-c:v", "libx264", "-pix_fmt", "yuv420p", fgRaw])
      execFileSync("ffmpeg", ["-v", "error", "-y", "-i", fgRaw, "-c", "copy", "-output_ts_offset", "0.5", fg])
      execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=160x90:r=10:d=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", bg])
      // Mask (starts at 0, one frame per foreground frame): black for frames 0–9, white from frame 10.
      execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=160x90:r=10:d=1", "-f", "lavfi", "-i", "color=c=white:s=160x90:r=10:d=1",
        "-filter_complex", "[0][1]concat=n=2:v=1[v]", "-map", "[v]", "-c:v", "libx264", "-pix_fmt", "yuv420p", mask])
      const { probeVideoOverlayBase } = await import("../ffmpeg-utils.js")
      const p = await probeVideoOverlayBase(fg)
      expect(p.startTimeSec).toBeCloseTo(0.5, 1)
      const argv = buildMaskCompositeArgs({
        foregroundPath: fg, backgroundPath: bg, maskPath: mask, outputPath: out,
        settings: resolveMaskCompositeSettings({ feather: 0 }),
        probe: { width: 160, height: 90, frameRate: "10/1", durationSec: p.streamDurationSec, startSec: p.startTimeSec, foregroundHasAudio: false, backgroundHasAudio: false },
      })
      await runFfmpeg(argv, 60_000)
      // Exactly the foreground's 20 frames: no background-only frames before its picture starts.
      expect(frameCount(out)).toBe(20)
      // By frame index: the render starts on the foreground's clock (0.5 s), so output frame N is foreground frame N.
      const at = (n: number) => {
        const rgb = execFileSync("ffmpeg", ["-v", "error", "-i", out, "-vf", `select=eq(n\\,${n})`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])
        const i = (45 * 160 + 80) * 3
        return [rgb[i]!, rgb[i + 1]!, rgb[i + 2]!]
      }
      // Foreground frame 7 (t = 0.5 + 0.7): its mask frame is black → background (blue), never the red foreground.
      const [r1, , b1] = at(7)
      expect(b1).toBeGreaterThan(200); expect(r1).toBeLessThan(60)
      // Foreground frame 15 (t = 0.5 + 1.5): mask white → the green foreground.
      const [, g2, b2] = at(15)
      expect(g2).toBeGreaterThan(100); expect(b2).toBeLessThan(60)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  // A picture starting a FRACTION of a frame late (a 23.976 fps clip whose picture starts at 0.041 s while
  // its sound starts at 0, as trimmed film clips do): the mask's frame N must still meet frame N — never
  // the frame before, and never no mask at all on frame 0. The mask is white on odd frames only, so a
  // one-frame slip shows.
  const lateParityScene = async (dir: string, source: string, vf: string[] = [], timescale = "24000") => {
    const raw = join(dir, "src-raw.mp4"), late = join(dir, "src-late.mp4"), mask = join(dir, "mask.mp4")
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `${source}:s=160x90:r=24000/1001`, "-frames:v", "12", ...vf, "-c:v", "libx264", "-pix_fmt", "yuv444p", "-crf", "0", raw])
    execFileSync("ffmpeg", ["-v", "error", "-y", "-itsoffset", "0.041", "-i", raw, "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
      "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-t", "0.6", "-video_track_timescale", timescale, late])
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=160x90:r=24000/1001", "-frames:v", "12",
      "-vf", "format=gray,geq=lum='if(mod(N,2),255,0)'", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-qp", "0", mask])
    const { probeVideoOverlayBase } = await import("../ffmpeg-utils.js")
    const p = await probeVideoOverlayBase(late)
    expect(p.startTimeSec).toBeCloseTo(0.041, 2)
    expect(p.frameCount).toBe(12)
    const probe: MaskCompositeProbe = { width: 160, height: 90, frameRate: "24000/1001", durationSec: p.streamDurationSec, startSec: p.startTimeSec, frameCount: p.frameCount, foregroundHasAudio: true, backgroundHasAudio: true }
    return { late, mask, probe }
  }
  const frameRgb = (file: string, n: number, pixFmt: "rgb24" | "gray") =>
    execFileSync("ffmpeg", ["-v", "error", "-i", file, "-vf", `select=eq(n\\,${n})`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", pixFmt, "-"])

  // The output's picture starts where the source's did (a frame ahead of the sound otherwise).
  const videoStart = (file: string) =>
    Number(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=start_time", "-of", "csv=p=0", file]).toString().trim())

  it.each(["24000", "90000", "600"])("video fill: mask frame N meets foreground frame N when the picture starts a fraction of a frame late (timescale 1/%s)", async (timescale) => {
    const dir = await mkdtemp(join(tmpdir(), "mask-composite-late-video-"))
    try {
      const { late, mask, probe } = await lateParityScene(dir, "color=c=red", [], timescale)
      const bg = join(dir, "bg.mp4"), out = join(dir, "out.mp4")
      execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=160x90:r=24000/1001:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", bg])
      await runFfmpeg(buildMaskCompositeArgs({ foregroundPath: late, backgroundPath: bg, maskPath: mask, outputPath: out, settings: resolveMaskCompositeSettings({ feather: 0 }), probe }), 60_000)
      expect(frameCount(out)).toBe(12)
      const i = (45 * 160 + 80) * 3
      const seen = Array.from({ length: 8 }, (_, n) => {
        const rgb = frameRgb(out, n, "rgb24")
        return rgb[i]! > 200 && rgb[i + 2]! < 60 ? "fg" : rgb[i + 2]! > 200 && rgb[i]! < 60 ? "bg" : "?"
      })
      // Even frames: mask black → background; odd frames: mask white → foreground.
      expect(seen).toEqual(["bg", "fg", "bg", "fg", "bg", "fg", "bg", "fg"])
      expect(Math.abs(videoStart(out) - videoStart(late))).toBeLessThan(0.002)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it.each(["24000", "90000", "600"])("blur fill: mask frame N meets frame N when the picture starts a fraction of a frame late, frame 0 never blurred whole (timescale 1/%s)", async (timescale) => {
    const dir = await mkdtemp(join(tmpdir(), "mask-composite-late-blur-"))
    try {
      // 1-px black / white columns: blurred, neighbouring columns read the same grey.
      const { late, mask, probe } = await lateParityScene(dir, "color=c=gray", ["-vf", "geq=lum='if(mod(X,2),235,16)':cb=128:cr=128"], timescale)
      const out = join(dir, "out.mp4")
      await runFfmpeg(buildMaskCompositeFillArgs({ backgroundPath: late, maskPath: mask, outputPath: out, settings: resolveMaskCompositeSettings({ fill: "blur", blurStrengthPct: 5, feather: 0 }), probe }), 60_000)
      expect(frameCount(out)).toBe(12)
      const seen = Array.from({ length: 8 }, (_, n) => {
        const g = frameRgb(out, n, "gray")
        const swing = Math.abs(g[45 * 160 + 80]! - g[45 * 160 + 81]!)
        return swing > 100 ? "sharp" : swing < 40 ? "blurred" : "?"
      })
      expect(seen).toEqual(["sharp", "blurred", "sharp", "blurred", "sharp", "blurred", "sharp", "blurred"])
      expect(Math.abs(videoStart(out) - videoStart(late))).toBeLessThan(0.002)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("shows the foreground where the mask is white and the background where it is black, for the foreground's length", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mask-composite-test-"))
    try {
      const fg = join(dir, "fg.mp4"), bg = join(dir, "bg.mp4"), mask = join(dir, "mask.mp4"), out = join(dir, "out.mp4")
      const lavfi = (src: string, file: string, extra: string[] = []) =>
        execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", src, ...extra, "-c:v", "libx264", "-pix_fmt", "yuv420p", file])
      lavfi("color=c=red:s=160x90:r=10:d=2", fg)
      // A shorter background (it must loop) at another size (it must be fitted).
      lavfi("color=c=blue:s=320x180:r=25:d=0.5", bg)
      // Left half white, right half black; shorter than the foreground (it must hold).
      lavfi("color=c=black:s=160x90:r=10:d=1", mask, ["-vf", "drawbox=x=0:y=0:w=80:h=90:color=white:t=fill"])
      const argv = buildMaskCompositeArgs({
        foregroundPath: fg, backgroundPath: bg, maskPath: mask, outputPath: out,
        settings: resolveMaskCompositeSettings({ feather: 0 }),
        probe: { width: 160, height: 90, frameRate: "10/1", durationSec: 2, foregroundHasAudio: false, backgroundHasAudio: false },
      })
      await runFfmpeg(argv, 60_000)
      const info = execFileSync("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=width,height,nb_read_frames", "-of", "csv=p=0", out]).toString().trim()
      expect(info).toBe("160,90,20")
      // The last frame (past the mask's and the background's own ends).
      const rgb = execFileSync("ffmpeg", ["-v", "error", "-i", out, "-vf", "select=eq(n\\,19)", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])
      const at = (x: number, y: number) => [...rgb.subarray((y * 160 + x) * 3, (y * 160 + x) * 3 + 3)]
      const [lr, , lb] = at(20, 45)
      const [rr, , rb] = at(140, 45)
      expect(lr).toBeGreaterThan(200); expect(lb).toBeLessThan(60) // red foreground on the left
      expect(rb).toBeGreaterThan(200); expect(rr).toBeLessThan(60) // blue background on the right
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  // A background with detail (left half: 1-px black/white columns; right half: plain blue), a mask covering the left half.
  const fillScene = async (dir: string, size: string, data: Record<string, unknown>) => {
    const bg = join(dir, "bg.mp4"), mask = join(dir, "mask.mp4"), out = join(dir, "out.mp4")
    const [w, h] = size.split("x").map(Number) as [number, number]
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=blue:s=${size}:r=10:d=1`, "-vf",
      `geq=lum='if(lt(X,${w / 2}),if(mod(X,2),235,16),41)':cb='if(lt(X,${w / 2}),128,240)':cr='if(lt(X,${w / 2}),128,110)'`,
      "-c:v", "libx264", "-pix_fmt", "yuv444p", "-crf", "0", bg])
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=black:s=${size}:r=10:d=1`, "-vf", `drawbox=x=0:y=0:w=${w / 2}:h=${h}:color=white:t=fill`,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", mask])
    const argv = buildMaskCompositeFillArgs({
      backgroundPath: bg, maskPath: mask, outputPath: out,
      settings: resolveMaskCompositeSettings({ feather: 0, ...data }),
      probe: { width: w, height: h, frameRate: "10/1", durationSec: 1, foregroundHasAudio: false, backgroundHasAudio: false },
    })
    await runFfmpeg(argv, 60_000)
    const rgb = execFileSync("ffmpeg", ["-v", "error", "-i", out, "-vf", "select=eq(n\\,5)", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"])
    return { at: (x: number, y: number) => rgb[y * w + x]!, w, h }
  }

  it.each([["pixelate", { fill: "pixelate", pixelSizePct: 10 }], ["blur", { fill: "blur", blurStrengthPct: 5 }]] as const)(
    "%s: smooths the masked half of the background (the columns average to grey) and leaves the rest untouched — on an odd block count",
    async (_name, data) => {
      const dir = await mkdtemp(join(tmpdir(), "mask-composite-fill-"))
      try {
        // 168x90 at 10 %: 17 px blocks → 168/17 ≈ 9.9 → 10 columns, 90/17 ≈ 5.3 → 5 rows (an odd count).
        const { at } = await fillScene(dir, "168x90", data)
        // Inside the mask: no column-to-column flicker any more, mid grey.
        const row = [20, 21, 22, 23, 24, 25].map((x) => at(x, 45))
        expect(Math.max(...row) - Math.min(...row)).toBeLessThan(40)
        expect(row[0]!).toBeGreaterThan(80); expect(row[0]!).toBeLessThan(180)
        // Outside the mask: the plain background, as it was.
        expect(Math.abs(at(150, 45) - at(160, 45))).toBeLessThan(6)
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    },
  )

  it("opacity applies to a pixelate fill: half the effect, half the original background", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mask-composite-fill-opacity-"))
    try {
      const full = await fillScene(dir, "160x90", { fill: "pixelate", pixelSizePct: 10 })
      const dirB = await mkdtemp(join(tmpdir(), "mask-composite-fill-opacity-b-"))
      try {
        const half = await fillScene(dirB, "160x90", { fill: "pixelate", pixelSizePct: 10, opacity: 0.5 })
        // The original columns alternate dark / light; the full effect flattens them; half keeps half the swing.
        const swing = (s: typeof full) => Math.abs(s.at(20, 45) - s.at(21, 45))
        expect(swing(full)).toBeLessThan(30)
        expect(swing(half)).toBeGreaterThan(50)
        expect(swing(half)).toBeLessThan(170)
      } finally {
        await rm(dirB, { recursive: true, force: true })
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("blends opacity × foreground + (1 − opacity) × background inside the mask, and leaves outside it alone", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mask-composite-opacity-"))
    try {
      const fg = join(dir, "fg.mp4"), bg = join(dir, "bg.mp4"), mask = join(dir, "mask.mp4"), out = join(dir, "out.mp4")
      const lavfi = (src: string, file: string, extra: string[] = []) =>
        execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", src, ...extra, "-c:v", "libx264", "-pix_fmt", "yuv420p", file])
      lavfi("color=c=red:s=160x90:r=10:d=1", fg)
      lavfi("color=c=blue:s=160x90:r=10:d=1", bg)
      lavfi("color=c=black:s=160x90:r=10:d=1", mask, ["-vf", "drawbox=x=0:y=0:w=80:h=90:color=white:t=fill"])
      const argv = buildMaskCompositeArgs({
        foregroundPath: fg, backgroundPath: bg, maskPath: mask, outputPath: out,
        settings: resolveMaskCompositeSettings({ feather: 0, opacity: 0.5 }),
        probe: { width: 160, height: 90, frameRate: "10/1", durationSec: 1, foregroundHasAudio: false, backgroundHasAudio: false },
      })
      await runFfmpeg(argv, 60_000)
      const rgb = execFileSync("ffmpeg", ["-v", "error", "-i", out, "-vf", "select=eq(n\\,5)", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])
      const at = (x: number, y: number) => [...rgb.subarray((y * 160 + x) * 3, (y * 160 + x) * 3 + 3)]
      const [lr, , lb] = at(20, 45)
      const [rr, , rb] = at(140, 45)
      // Inside the mask: half red, half blue.
      expect(lr).toBeGreaterThan(90); expect(lr).toBeLessThan(170)
      expect(lb).toBeGreaterThan(90); expect(lb).toBeLessThan(170)
      // Outside it: the background, untouched.
      expect(rb).toBeGreaterThan(200); expect(rr).toBeLessThan(60)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
