/**
 * The working copy (working-copy-encode.ts) at every encode that takes it:
 * Mask Composite's two graphs and Video Face Mesh's encoder. Asked for, each
 * writes libx264 `-preset fast -crf 6`, capped at `-maxrate 50M -bufsize 100M`,
 * in the source's own pixel format (its
 * graph in that format throughout); not asked for, each argv is exactly the
 * one before the working copy existed — the DEFAULT_* arrays below are those
 * argvs, captured from the code before this change, never re-derived.
 */
import { describe, expect, it } from "vitest"
import { execFileSync } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveMaskCompositeSettings } from "@nodaro/shared/media"
import {
  WORKING_COPY_BUFFER,
  WORKING_COPY_CRF,
  WORKING_COPY_MAX_RATE,
  withAlphaPlane,
  workingCopyCodecArgs,
  workingCopyPeakMemoryMiB,
  workingCopyPictureArgs,
  workingCopyPixFmt,
} from "../working-copy-encode.js"
import { matchedPictureArgs, probeMatched } from "../matched-encode.js"
import { buildMaskCompositeArgs, buildMaskCompositeFillArgs, maskCompositePeakMemoryMiB } from "../mask-composite.js"
import { EXACT_ENCODE_FLAGS, buildFaceMeshEncodeArgs, buildStreamFramesArgs, clipColourOf } from "../../../services/face-mesh/draw-face-mesh.js"

const PROBE = { width: 1280, height: 720, frameRate: "30000/1001", durationSec: 4.5, startSec: 0.041, frameCount: 135, sar: 1, foregroundHasAudio: true, backgroundHasAudio: true }
const video = (workingCopy?: Parameters<typeof buildMaskCompositeArgs>[0]["workingCopy"]) =>
  buildMaskCompositeArgs({ foregroundPath: "fg.mp4", backgroundPath: "bg.mp4", maskPath: "m.mp4", outputPath: "o.mp4", settings: resolveMaskCompositeSettings({}), probe: PROBE, ...(workingCopy ? { workingCopy } : {}) })
const blur = (workingCopy?: Parameters<typeof buildMaskCompositeFillArgs>[0]["workingCopy"]) =>
  buildMaskCompositeFillArgs({ backgroundPath: "bg.mp4", maskPath: "m.mp4", outputPath: "o.mp4", settings: resolveMaskCompositeSettings({ fill: "blur" }), probe: PROBE, ...(workingCopy ? { workingCopy } : {}) })
const pixelate = () =>
  buildMaskCompositeFillArgs({ backgroundPath: "bg.mp4", maskPath: "m.mp4", outputPath: "o.mp4", settings: resolveMaskCompositeSettings({ fill: "pixelate", audioSource: "none" }), probe: { ...PROBE, backgroundHasAudio: false } })
const SD_PC = clipColourOf({ color_space: "smpte170m", color_range: "pc" })
const faceMesh = (workingCopy?: { pixFmt: "yuv420p" | "yuv422p" | "yuv444p" }) =>
  buildFaceMeshEncodeArgs({ width: 720, height: 1280, frameRate: "30000/1001", audioFrom: "/in.mp4", outputPath: "/out.mp4", colour: SD_PC, ...(workingCopy ? { workingCopy } : {}) })

const DEFAULT_VIDEO = ["-y", "-i", "fg.mp4", "-stream_loop", "-1", "-i", "bg.mp4", "-i", "m.mp4", "-filter_complex", "[0:v]setpts=PTS-STARTPTS,fps=30000/1001,scale=1280:720,setsar=1,format=yuva420p[fg];[1:v]setpts=PTS-STARTPTS,scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,setsar=1,fps=30000/1001,format=yuv420p[bg];[2:v]setpts=PTS-STARTPTS,scale=1280:720,setsar=1,format=gray,lut=c0='clip((val-24)*255/206,0,255)',gblur=sigma=1.00,fps=30000/1001,tpad=stop_mode=clone:stop=-1[m];[fg][m]alphamerge[fga];[bg][fga]overlay=format=auto:shortest=1,format=yuv420p,setpts=PTS+round(0.041000/TB)[vout]", "-map", "[vout]", "-map", "0:a:0", "-frames:v", "135", "-t", "4.541", "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "o.mp4"]
const DEFAULT_BLUR = ["-y", "-i", "bg.mp4", "-i", "m.mp4", "-filter_complex", "[0:v]setpts=PTS-STARTPTS,fps=30000/1001,scale=1280:720,setsar=1,format=yuv420p,split=2[bg][src];[src]gblur=sigma=25.60,format=yuva420p[fx];[1:v]setpts=PTS-STARTPTS,scale=1280:720,setsar=1,format=gray,lut=c0='clip((val-24)*255/206,0,255)',gblur=sigma=1.00,fps=30000/1001,tpad=stop_mode=clone:stop=-1[m];[fx][m]alphamerge[fxa];[bg][fxa]overlay=format=auto:shortest=1,format=yuv420p,setpts=PTS+round(0.041000/TB)[vout]", "-map", "[vout]", "-map", "0:a:0", "-t", "4.541", "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "o.mp4"]
const DEFAULT_PIXELATE = ["-y", "-i", "bg.mp4", "-i", "m.mp4", "-filter_complex", "[0:v]setpts=PTS-STARTPTS,fps=30000/1001,scale=1280:720,setsar=1,format=yuv420p,split=2[bg][src];[src]scale=80:45:flags=area,scale=1280:720:flags=neighbor,format=yuva420p[fx];[1:v]setpts=PTS-STARTPTS,scale=1280:720,setsar=1,format=gray,lut=c0='clip((val-24)*255/206,0,255)',gblur=sigma=1.00,fps=30000/1001,tpad=stop_mode=clone:stop=-1[m];[fx][m]alphamerge[fxa];[bg][fxa]overlay=format=auto:shortest=1,format=yuv420p,setpts=PTS+round(0.041000/TB)[vout]", "-map", "[vout]", "-t", "4.541", "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", "-an", "-movflags", "+faststart", "o.mp4"]
const DEFAULT_FACE_MESH = ["-y", "-nostdin", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "720x1280", "-framerate", "30000/1001", "-i", "pipe:0", "-i", "/in.mp4", "-map", "0:v:0", "-map", "1:a:0?", "-fps_mode", "passthrough", "-vf", "scale=out_color_matrix=bt601:out_range=pc,format=yuv420p,setparams=colorspace=smpte170m:color_primaries=smpte170m:color_trc=smpte170m:range=pc", "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p", "-colorspace", "smpte170m", "-color_primaries", "smpte170m", "-color_trc", "smpte170m", "-color_range", "pc", "-c:a", "copy", "-movflags", "+faststart", "/out.mp4"]
const DEFAULT_FACE_MESH_UNTAGGED = ["-y", "-nostdin", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "2x2", "-framerate", "24/1", "-i", "pipe:0", "-i", "/a", "-map", "0:v:0", "-map", "1:a:0?", "-fps_mode", "passthrough", "-vf", "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv", "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv", "-c:a", "copy", "-movflags", "+faststart", "/o"]

/**
 * The face mesh's encode as it is now: the captured argv above with the one
 * deliberate change since, exact rounding on its RGB → YUV scale
 * (`EXACT_ENCODE_FLAGS`, so a round trip keeps the luma mean).
 */
const exactEncode = (argv: string[]) => {
  const out = [...argv]
  const vf = out.indexOf("-vf") + 1
  out[vf] = out[vf]!.replace(/^(scale=out_color_matrix=[^,]+),/, `$1:flags=${EXACT_ENCODE_FLAGS},`)
  expect(out[vf]).toContain(`:flags=${EXACT_ENCODE_FLAGS},format=`)
  return out
}

/** The delivery encode's codec segment, as both Mask Composite graphs write it. */
const DELIVERY = ["-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p"]
const replaced = (argv: string[], from: string[], to: string[]) => {
  const at = argv.findIndex((_, i) => from.every((v, j) => argv[i + j] === v))
  expect(at, "segment found").toBeGreaterThanOrEqual(0)
  return [...argv.slice(0, at), ...to, ...argv.slice(at + from.length)]
}

describe("the working copy's arguments", () => {
  it("libx264, preset fast, CRF 6 under a 50 Mbit/s cap, in the source's own pixel format where 8-bit H.264 holds it", () => {
    expect(WORKING_COPY_CRF).toBe("6")
    expect(workingCopyCodecArgs("yuv444p")).toEqual(["-c:v", "libx264", "-preset", "fast", "-crf", "6", "-maxrate", "50M", "-bufsize", "100M", "-pix_fmt", "yuv444p"])
    expect(workingCopyPixFmt({ pixFmt: "yuv420p" })).toBe("yuv420p")
    expect(workingCopyPixFmt({ pixFmt: "yuv422p" })).toBe("yuv422p")
    expect(workingCopyPixFmt({ pixFmt: "yuv444p" })).toBe("yuv444p")
    // Full-range 4:2:0 stays 4:2:0 (its range kept by the tag); what 8-bit H.264 cannot hold is 4:2:0.
    expect(workingCopyPixFmt({ pixFmt: "yuvj420p" })).toBe("yuv420p")
    expect(workingCopyPixFmt({ pixFmt: "yuv420p10le" })).toBe("yuv420p")
    expect(workingCopyPixFmt({ pixFmt: "rgb24" })).toBe("yuv420p")
    expect(workingCopyPixFmt({})).toBe("yuv420p")
    expect(withAlphaPlane("yuv420p")).toBe("yuva420p")
    expect(withAlphaPlane("yuv444p")).toBe("yuva444p")
  })

  it("carries the source's colour tags, as the matched re-encode does (an unknown one left out)", () => {
    const source = { pixFmt: "yuvj420p", colorSpace: "smpte170m", colorPrimaries: "unknown", colorTransfer: "bt709", colorRange: "pc" }
    expect(workingCopyPictureArgs(source)).toEqual([
      "-c:v", "libx264", "-preset", "fast", "-crf", "6", "-maxrate", "50M", "-bufsize", "100M", "-pix_fmt", "yuv420p",
      "-colorspace", "smpte170m", "-color_trc", "bt709", "-color_range", "pc",
    ])
    // The matched re-encode's own tags, through the same helper.
    expect(matchedPictureArgs(source).slice(-6)).toEqual(["-colorspace", "smpte170m", "-color_trc", "bt709", "-color_range", "pc"])
  })

  it("bounds a copy's video at 50 Mbit/s for its length plus a 100 Mbit buffer: 15 s is at most 106 MB, 30 s 200 MB", () => {
    expect(WORKING_COPY_MAX_RATE).toBe(50_000_000)
    expect(WORKING_COPY_BUFFER).toBe(2 * WORKING_COPY_MAX_RATE)
    const maxVideoBytes = (seconds: number) => (WORKING_COPY_MAX_RATE * seconds + WORKING_COPY_BUFFER) / 8
    expect(maxVideoBytes(10)).toBe(75_000_000)
    expect(maxVideoBytes(15)).toBe(106_250_000)
    expect(maxVideoBytes(30)).toBe(200_000_000)
    // The argv states the same two numbers (ffmpeg reads "M" as 10^6).
    const argv = workingCopyCodecArgs("yuv420p")
    expect(Number(argv[argv.indexOf("-maxrate") + 1]!.replace("M", "")) * 1e6).toBe(WORKING_COPY_MAX_RATE)
    expect(Number(argv[argv.indexOf("-bufsize") + 1]!.replace("M", "")) * 1e6).toBe(WORKING_COPY_BUFFER)
  })

  it("raises a declared peak only for a picture that holds more than 4:2:0", () => {
    expect(workingCopyPeakMemoryMiB(1000, "yuv420p")).toBe(1000)
    expect(workingCopyPeakMemoryMiB(1000, "yuv422p")).toBe(1334)
    expect(workingCopyPeakMemoryMiB(1000, "yuv444p")).toBe(2000)
    expect(maskCompositePeakMemoryMiB(1000, undefined)).toBe(1000)
    expect(maskCompositePeakMemoryMiB(1000, { pixFmt: "yuv420p" })).toBe(1000)
    expect(maskCompositePeakMemoryMiB(1000, { pixFmt: "yuv444p" })).toBe(2000)
  })
})

/**
 * Mask Composite's graphs as they are now: the captured argv above with the
 * one deliberate change since, the overlay blending in the graph's own format
 * (`overlay=format=yuv420`, so the background is never converted).
 */
const inFormatOverlay = (argv: string[]) => {
  const out = [...argv]
  const at = out.indexOf("-filter_complex") + 1
  expect(out[at]).toContain("overlay=format=auto:")
  out[at] = out[at]!.replace("overlay=format=auto:", "overlay=format=yuv420:")
  return out
}

describe("Mask Composite", () => {
  it("without the working copy: every argv exactly as before, but for the overlay's format", () => {
    expect(video()).toEqual(inFormatOverlay(DEFAULT_VIDEO))
    expect(blur()).toEqual(inFormatOverlay(DEFAULT_BLUR))
    expect(pixelate()).toEqual(inFormatOverlay(DEFAULT_PIXELATE))
  })

  it("a 4:2:0 working copy: the same graph, only the encode changed (with the source's tags)", () => {
    const source = { pixFmt: "yuv420p", colorSpace: "bt709", colorRange: "tv" }
    const enc = [...workingCopyCodecArgs("yuv420p"), "-colorspace", "bt709", "-color_range", "tv"]
    expect(video(source)).toEqual(replaced(inFormatOverlay(DEFAULT_VIDEO), DELIVERY, enc))
    expect(blur(source)).toEqual(replaced(inFormatOverlay(DEFAULT_BLUR), DELIVERY, enc))
  })

  it("a 4:4:4 working copy: the graph in 4:4:4 throughout, encoded 4:4:4", () => {
    const source = { pixFmt: "yuv444p" }
    const as444 = (argv: string[]) => {
      const current = inFormatOverlay(argv)
      const graph = current[current.indexOf("-filter_complex") + 1]!
      const out = replaced(current, DELIVERY, workingCopyCodecArgs("yuv444p"))
      out[out.indexOf("-filter_complex") + 1] = graph
        .replaceAll("format=yuva420p", "format=yuva444p").replaceAll("format=yuv420p", "format=yuv444p").replace("overlay=format=yuv420:", "overlay=format=yuv444:")
      return out
    }
    expect(video(source)).toEqual(as444(DEFAULT_VIDEO))
    expect(blur(source)).toEqual(as444(DEFAULT_BLUR))
    for (const argv of [video(source), blur(source)]) {
      expect(argv.join(" ")).not.toContain("420p")
      expect(argv.slice(argv.indexOf("-crf"), argv.indexOf("-crf") + 8)).toEqual(["-crf", "6", "-maxrate", "50M", "-bufsize", "100M", "-pix_fmt", "yuv444p"])
    }
  })
})

describe("Video Face Mesh's encoder", () => {
  it("without the working copy: exactly as before, but for the exact rounding", () => {
    expect(faceMesh()).toEqual(exactEncode(DEFAULT_FACE_MESH))
    expect(buildFaceMeshEncodeArgs({ width: 2, height: 2, frameRate: "24/1", audioFrom: "/a", outputPath: "/o" })).toEqual(exactEncode(DEFAULT_FACE_MESH_UNTAGGED))
  })

  it("a working copy: the same colour round trip and tags, encoded preset fast, CRF 6, in the drawn-on clip's format", () => {
    const delivery = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p"]
    expect(faceMesh({ pixFmt: "yuv420p" })).toEqual(replaced(exactEncode(DEFAULT_FACE_MESH), delivery, workingCopyCodecArgs("yuv420p")))
    const full = replaced(exactEncode(DEFAULT_FACE_MESH), delivery, workingCopyCodecArgs("yuv444p"))
    const vf = full.indexOf("-vf") + 1
    full[vf] = full[vf]!.replace(",format=yuv420p,", ",format=yuv444p,")
    expect(faceMesh({ pixFmt: "yuv444p" })).toEqual(full)
  })
})

describe("the working copy, rendered by the real ffmpeg", () => {
  const ff = (args: string[], input?: Buffer) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { maxBuffer: 1e9, ...(input ? { input } : {}) })
  const stream = (file: string) =>
    execFileSync("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=pix_fmt,width,height,nb_read_frames", "-of", "csv=p=0", file]).toString().trim()
  /** PSNR (dB, all planes) of `file` against `ref` at 4:4:4. */
  const psnr = (ref: string, file: string) => {
    const out = execFileSync("sh", ["-c", `ffmpeg -v info -i "${ref}" -i "${file}" -lavfi "[0:v]format=yuv444p[a];[1:v]format=yuv444p[b];[a][b]psnr" -f null - 2>&1`]).toString()
    const m = /average:([0-9.]+|inf)/.exec(out)
    return m![1] === "inf" ? Infinity : Number(m![1])
  }
  const W = 320, H = 180, N = 24

  it.each(["yuv420p", "yuv444p"])("Mask Composite (blur, nothing masked) and Face Mesh keep a %s source's format and frames, closer to it than the delivery encode", async (pixFmt) => {
    const dir = await mkdtemp(join(tmpdir(), "working-copy-"))
    try {
      const src = join(dir, "src.mp4"), mask = join(dir, "mask.mp4")
      ff(["-f", "lavfi", "-i", `testsrc2=s=${W}x${H}:r=24,noise=alls=8:allf=t`, "-frames:v", String(N), "-c:v", "libx264", "-crf", "0", "-pix_fmt", pixFmt, "-colorspace", "bt709", "-color_range", "tv", src])
      ff(["-f", "lavfi", "-i", `color=black:s=${W}x${H}:r=24`, "-frames:v", String(N), "-c:v", "libx264", "-pix_fmt", "yuv420p", mask])
      const source = await probeMatched(src)
      expect(source.pixFmt).toBe(pixFmt)
      const probe = { width: W, height: H, frameRate: "24/1", durationSec: N / 24, frameCount: N, foregroundHasAudio: false, backgroundHasAudio: false }
      const settings = resolveMaskCompositeSettings({ fill: "blur" })
      const delivery = join(dir, "mc-delivery.mp4"), working = join(dir, "mc-working.mp4")
      ff(buildMaskCompositeFillArgs({ backgroundPath: src, maskPath: mask, outputPath: delivery, settings, probe }).slice(1))
      ff(buildMaskCompositeFillArgs({ backgroundPath: src, maskPath: mask, outputPath: working, settings, probe, workingCopy: source }).slice(1))
      expect(stream(delivery)).toBe(`${W},${H},yuv420p,${N}`)
      expect(stream(working)).toBe(`${W},${H},${pixFmt},${N}`)
      // Measured on this grainy source with ffmpeg 9.0: 44.5 dB (4:2:0) and 45.2 dB (4:4:4) against the delivery
      // encode's 32.4 and 36.3; the face mesh's encoder 48.5 / 45.5 against 40.6 / 32.1 (44.5 / 45.5 against
      // 39.5 / 31.8 before its exact rounding: EXACT_DECODE_FLAGS / EXACT_ENCODE_FLAGS). The CI runner's ffmpeg
      // measured 41.9 dB for the 4:2:0 composite, so the floor sits under both.
      expect(psnr(src, working)).toBeGreaterThan(psnr(src, delivery) + 3)
      expect(psnr(src, working)).toBeGreaterThan(40)

      // The face mesh's encoder, fed the clip's own frames as the drawer feeds them (raw RGB, nothing drawn).
      const colour = clipColourOf({ color_space: "bt709", color_range: "tv" })
      const rgb = ff(buildStreamFramesArgs(src, { pixFmt: "rgb24", width: W, height: H, colour, exact: true }))
      const encode = (outputPath: string, wc?: { pixFmt: "yuv420p" | "yuv444p" }) =>
        ff(buildFaceMeshEncodeArgs({ width: W, height: H, frameRate: "24/1", audioFrom: src, outputPath, colour, ...(wc ? { workingCopy: wc } : {}) }).slice(1), rgb)
      const fmDelivery = join(dir, "fm-delivery.mp4"), fmWorking = join(dir, "fm-working.mp4")
      encode(fmDelivery)
      encode(fmWorking, { pixFmt: workingCopyPixFmt(source) as "yuv420p" | "yuv444p" })
      expect(stream(fmDelivery)).toBe(`${W},${H},yuv420p,${N}`)
      expect(stream(fmWorking)).toBe(`${W},${H},${pixFmt},${N}`)
      expect(psnr(src, fmWorking)).toBeGreaterThan(psnr(src, fmDelivery) + 3)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)
})
