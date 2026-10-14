import { describe, it, expect } from "vitest"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFileSync } from "node:child_process"
import { resolveMaskCompositeSettings } from "@nodaro/shared/media"
import { buildMaskCompositeArgs, maskCompositeTimeoutMs, type MaskCompositeProbe } from "../mask-composite.js"
import { runFfmpeg } from "../ffmpeg-utils.js"

const PROBE: MaskCompositeProbe = { width: 641, height: 361, frameRate: "30/1", durationSec: 2, foregroundHasAudio: true, backgroundHasAudio: true }
const graphOf = (argv: string[]) => argv[argv.indexOf("-filter_complex") + 1]!
const build = (data: Record<string, unknown>, probe: MaskCompositeProbe = PROBE) =>
  buildMaskCompositeArgs({ foregroundPath: "fg.mp4", backgroundPath: "bg.mp4", maskPath: "m.mp4", outputPath: "o.mp4", settings: resolveMaskCompositeSettings(data), probe })

describe("buildMaskCompositeArgs", () => {
  it("renders on the foreground's (even) frame and length, looping the background", () => {
    const argv = build({})
    const g = graphOf(argv)
    expect(g).toContain("[0:v]scale=640:360")
    expect(g).toContain("[2:v]setpts=PTS-STARTPTS,scale=640:360")
    expect(argv.join(" ")).toContain("-stream_loop -1 -i bg.mp4")
    expect(argv[argv.indexOf("-t") + 1]).toBe("2.000")
    // The mask holds its last frame so a short mask never ends the render.
    expect(g).toContain("tpad=stop_mode=clone:stop=-1")
  })
  it("puts the mask on the foreground's clock when the foreground's picture starts late, and renders to its last frame", () => {
    const argv = build({}, { ...PROBE, startSec: 0.1 })
    expect(graphOf(argv)).toContain("[2:v]setpts=PTS-STARTPTS+0.100000/TB,")
    expect(argv[argv.indexOf("-t") + 1]).toBe("2.100")
    // A picture starting at 0 adds no offset.
    expect(graphOf(build({}))).toContain("[2:v]setpts=PTS-STARTPTS,")
  })
  it("squares a non-square-pixel foreground instead of stretching it", () => {
    expect(graphOf(build({}, { ...PROBE, width: 720, height: 480, sar: 32 / 27 }))).toContain("[0:v]scale=852:480")
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
    expect(s).toEqual({ invertMask: false, feather: 20, grow: -10, backgroundFit: "cover", audioSource: "foreground" })
  })
  it("gives longer composites a longer kill budget", () => {
    expect(maskCompositeTimeoutMs(300)).toBeGreaterThan(maskCompositeTimeoutMs(10))
  })
})

describe("mask composite (real ffmpeg)", () => {
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
      const at = (sec: number) => {
        const rgb = execFileSync("ffmpeg", ["-v", "error", "-ss", String(sec), "-i", out, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])
        const i = (45 * 160 + 80) * 3
        return [rgb[i]!, rgb[i + 1]!, rgb[i + 2]!]
      }
      // Foreground frame 7 (t = 0.5 + 0.7): its mask frame is black → background (blue), never the red foreground.
      const [r1, , b1] = at(1.25)
      expect(b1).toBeGreaterThan(200); expect(r1).toBeLessThan(60)
      // Foreground frame 15 (t = 0.5 + 1.5): mask white → the green foreground.
      const [, g2, b2] = at(2.05)
      expect(g2).toBeGreaterThan(100); expect(b2).toBeLessThan(60)
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
})
