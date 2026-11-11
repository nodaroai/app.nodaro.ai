// @test-watches backend/src/providers/video/__tests__/__goldens__/**
import { describe, it, expect } from "vitest"
import { VIDEO_OVERLAY_PRESETS, resolveVideoOverlayGeometry, videoOverlayCanvas, type VideoOverlayCanvas, type VideoOverlayRect } from "@nodaro/shared/video"
import {
  VIDEO_OVERLAY_MIX_PEAK_DBFS,
  buildVideoOverlayGraph,
  videoOverlayImageFramerate,
  type VideoOverlayGraph,
  type VideoOverlayGraphLayer,
  type VideoOverlayGraphSpec,
} from "../video-overlay-graph.js"
import type { VideoOverlayBaseProbe } from "../ffmpeg-utils.js"

const GOLDEN = (name: string) => `./__goldens__/video-overlay-graph/${name}.txt`
const PORTRAIT: VideoOverlayCanvas = { w: 1080, h: 1920 }
const PROBE: VideoOverlayBaseProbe = {
  width: 1080, height: 1920, rotation: 0, sar: 1, rFrameRate: "30/1", avgFrameRate: "30/1",
  streamDurationSec: 24.8, startTimeSec: 0, audioCodec: "aac",
}

interface LayerSpec {
  readonly index: number
  readonly start: number
  readonly end: number
  readonly box: Parameters<typeof resolveVideoOverlayGeometry>[1]
  readonly aspect: number
  readonly opacity?: number
  readonly animate?: boolean
  readonly zIndex?: number
}

/** A kept layer exactly as the provider hands it over: geometry from the shared helper, pre-fit = drawn. */
function layer(canvas: VideoOverlayCanvas, s: LayerSpec): VideoOverlayGraphLayer {
  const { drawn } = resolveVideoOverlayGeometry(canvas, s.box, s.aspect)
  return {
    index: s.index,
    path: `/w/layer-${s.index}.png`,
    prefit: { width: drawn.width, height: drawn.height },
    start: s.start,
    end: s.end,
    drawn,
    opacity: s.opacity ?? 1,
    animate: s.animate ?? true,
    ...(s.zIndex !== undefined ? { zIndex: s.zIndex } : {}),
  }
}

const CARD = (index: number, start: number, end: number, extra: Partial<LayerSpec> = {}) =>
  layer(PORTRAIT, { index, start, end, box: VIDEO_OVERLAY_PRESETS.card, aspect: 1080 / 2160, ...extra })

function graph(over: Partial<VideoOverlayGraphSpec> & Pick<VideoOverlayGraphSpec, "layers">): VideoOverlayGraph {
  return buildVideoOverlayGraph({
    inputPath: "/w/input.mp4", outputPath: "/w/output.mp4", probe: PROBE, canvas: PORTRAIT,
    baseFit: "cover", backgroundColor: "#000000", ...over,
  })
}

/** One argv element per line; the graph split on ";" so a diff names the chain that moved. */
function golden(g: VideoOverlayGraph): string {
  const at = g.args.indexOf("-filter_complex")
  return ["# argv", ...g.args.map((a, i) => (i === at + 1 ? "<filter_complex>" : a)), "", "# filter_complex", ...g.filterComplex.split(";"), ""].join("\n")
}

const chains = (g: VideoOverlayGraph) => g.filterComplex.split(";")

describe("buildVideoOverlayGraph — spec §4.3", () => {
  it("the worked example: card 5.240–6.640 s, drawn 576×1152 at (252, 307)", async () => {
    const g = graph({ layers: [CARD(0, 5.24, 6.64)] })
    expect(g.args.slice(0, 13)).toEqual(["-y", "-i", "/w/input.mp4", "-f", "image2", "-loop", "1", "-framerate", "30/1", "-t", "1.400", "-i", "/w/layer-0.png"])
    expect(chains(g)).toEqual([
      "[0:v]scale=trunc(iw*sar/2)*2:trunc(ih/2)*2,setsar=1[base]",
      "[1:v]format=rgba,fade=t=in:st=0:d=0.150:alpha=1,fade=t=out:st=1.250:d=0.150:alpha=1," +
        "scale=w='if(isnan(t),576,trunc(576*(0.96+0.04*min(1,t/0.150)-0.04*max(0,(t-1.250)/0.150))/2)*2)':" +
        "h='if(isnan(t),1152,trunc(1152*(0.96+0.04*min(1,t/0.150)-0.04*max(0,(t-1.250)/0.150))/2)*2)':eval=frame," +
        "setpts=PTS+5.240/TB[ov1]",
      "[base][ov1]overlay=x='252+(576-overlay_w)/2':y='307+(1152-overlay_h)/2':eof_action=pass[v1]",
    ])
    expect(g.args.slice(-17)).toEqual([
      "-map", "[v1]", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
      "-c:a", "copy", "-movflags", "+faststart", "/w/output.mp4",
    ])
    expect(g.audioReencoded).toBe(false)
    await expect(golden(g)).toMatchFileSnapshot(GOLDEN("one-card"))
  })

  it("D1 hygiene: -f image2 on every still, no per-layer fit scale/crop, no enable, no -copyts / -noautorotate", () => {
    const g = graph({ layers: [CARD(0, 1, 2, { animate: false }), CARD(1, 3, 4)] })
    expect(g.args.filter((a) => a === "image2")).toHaveLength(2)
    expect(g.filterComplex).not.toContain("enable=")
    expect(g.args).not.toContain("-copyts")
    expect(g.args).not.toContain("-noautorotate")
    const [, still] = chains(g)
    expect(still).toBe("[1:v]format=rgba,setpts=PTS+1.000/TB[ov1]")
    for (const c of chains(g).slice(1)) expect(c).not.toContain("crop=")
  })

  it("20 layers chain in render order", async () => {
    const layers = Array.from({ length: 20 }, (_, i) => CARD(i, i, i + 0.8))
    const g = graph({ layers })
    expect(g.args.filter((a) => a === "image2")).toHaveLength(20)
    expect(g.args).toContain("[v20]")
    await expect(golden(g)).toMatchFileSnapshot(GOLDEN("twenty-layers"))
  })

  it("a layer running to the end of the base carries -t = duration − start", async () => {
    const g = graph({ layers: [CARD(0, 20, 24.8)] })
    expect(g.args).toContain("4.800")
    await expect(golden(g)).toMatchFileSnapshot(GOLDEN("to-the-end"))
  })

  it("a custom box with cover: drawn = the box, even-rounded", async () => {
    const l = layer(PORTRAIT, { index: 0, start: 0, end: 2, box: { anchor: "top-left", x: 5, y: 5, width: 33, height: 21, fit: "cover" }, aspect: 16 / 9 })
    expect(l.drawn).toEqual({ left: 54, top: 96, width: 356, height: 402 })
    const g = graph({ layers: [l] })
    expect(chains(g)[2]).toBe("[base][ov1]overlay=x='54+(356-overlay_w)/2':y='96+(402-overlay_h)/2':eof_action=pass[v1]")
    await expect(golden(g)).toMatchFileSnapshot(GOLDEN("custom-cover"))
  })

  it("opacity < 1 multiplies the alpha BEFORE the fades", () => {
    const g = graph({ layers: [CARD(0, 1, 3, { opacity: 0.85 })] })
    expect(chains(g)[1]).toMatch(/^\[1:v\]format=rgba,colorchannelmixer=aa=0\.850,fade=t=in/)
  })

  it("animate off: no fade, no scale", () => {
    const g = graph({ layers: [CARD(0, 1, 3, { animate: false })] })
    expect(chains(g)[1]).toBe("[1:v]format=rgba,setpts=PTS+1.000/TB[ov1]")
  })

  it("a short layer clamps the ramp to half its length: 0.2 s → R 0.100; 0.02 s → R 0.010, -t 0.020 (Review Focus 5)", async () => {
    expect(chains(graph({ layers: [CARD(0, 1, 1.2)] }))[1]).toContain("fade=t=in:st=0:d=0.100:alpha=1,fade=t=out:st=0.100:d=0.100:alpha=1")
    const g = graph({ layers: [CARD(0, 1, 1.02)] })
    expect(g.args).toContain("0.020")
    expect(chains(g)[1]).toContain("fade=t=in:st=0:d=0.010:alpha=1,fade=t=out:st=0.010:d=0.010:alpha=1")
    await expect(golden(g)).toMatchFileSnapshot(GOLDEN("short-ramp"))
  })

  it("a window under 2 ms drops the animation (its ramp would round to d=0.000 and t/0.000, which ffmpeg cannot configure); 2 ms keeps it at R 0.001", () => {
    expect(chains(graph({ layers: [CARD(0, 1, 1.0005)] }))[1]).toBe("[1:v]format=rgba,setpts=PTS+1.000/TB[ov1]")
    expect(chains(graph({ layers: [CARD(0, 1, 1.0019)] }))[1]).toBe("[1:v]format=rgba,setpts=PTS+1.000/TB[ov1]")
    expect(chains(graph({ layers: [CARD(0, 1, 1.0005, { opacity: 0.5 })] }))[1]).toBe("[1:v]format=rgba,colorchannelmixer=aa=0.500,setpts=PTS+1.000/TB[ov1]")
    const atFloor = chains(graph({ layers: [CARD(0, 2, 2.002)] }))[1]
    expect(atFloor).toContain("fade=t=in:st=0:d=0.001:alpha=1,fade=t=out:st=0.001:d=0.001:alpha=1")
    expect(atFloor).not.toContain("0.000)")
    expect(atFloor).not.toContain("d=0.000")
  })

  it("target aspect, cover (default): SAR resolved, scaled up, centre-cropped", async () => {
    const g = graph({ probe: { ...PROBE, width: 1920, height: 1080 }, outputAspect: "9:16", layers: [CARD(0, 1, 2)] })
    expect(chains(g)[0]).toBe("[0:v]scale=iw*sar:ih,setsar=1,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[base]")
    await expect(golden(g)).toMatchFileSnapshot(GOLDEN("aspect-cover"))
  })

  it("target aspect, contain with a non-black colour (padHexToFfmpeg)", async () => {
    const g = graph({ probe: { ...PROBE, width: 1920, height: 1080 }, outputAspect: "9:16", baseFit: "contain", backgroundColor: "#FF0000", layers: [CARD(0, 1, 2)] })
    expect(chains(g)[0]).toBe("[0:v]scale=iw*sar:ih,setsar=1,scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=0xFF0000[base]")
    await expect(golden(g)).toMatchFileSnapshot(GOLDEN("aspect-contain-red"))
  })

  it("a base without audio: the optional 0:a:0? map, nothing re-encoded", async () => {
    const g = graph({ probe: { ...PROBE, audioCodec: null }, layers: [CARD(0, 1, 2)] })
    expect(g.args).toContain("0:a:0?")
    expect(g.audioReencoded).toBe(false)
    await expect(golden(g)).toMatchFileSnapshot(GOLDEN("no-audio"))
  })

  it("a codec MP4 cannot carry as-is (PCM) is re-encoded to AAC — decided from the probe", async () => {
    const g = graph({ probe: { ...PROBE, audioCodec: "pcm_s16le" }, layers: [CARD(0, 1, 2)] })
    expect(g.audioReencoded).toBe(true)
    expect(g.args.join(" ")).toContain("-c:a aac -b:a 128k")
    await expect(golden(g)).toMatchFileSnapshot(GOLDEN("pcm-reencode"))
    for (const codec of ["aac", "mp3", "ac3", "opus"]) expect(graph({ probe: { ...PROBE, audioCodec: codec }, layers: [CARD(0, 1, 2)] }).audioReencoded).toBe(false)
  })

  it("odd base dimensions: the canvas is even-rounded and the layer drawn on it", async () => {
    const canvas = videoOverlayCanvas({ width: 1079, height: 1919 })!
    expect(canvas).toEqual({ w: 1078, h: 1918 })
    const l = layer(canvas, { index: 0, start: 1, end: 2, box: VIDEO_OVERLAY_PRESETS.card, aspect: 0.5 })
    const g = graph({ probe: { ...PROBE, width: 1079, height: 1919 }, canvas, layers: [l] })
    expect(chains(g)[0]).toBe("[0:v]scale=trunc(iw*sar/2)*2:trunc(ih/2)*2,setsar=1[base]")
    await expect(golden(g)).toMatchFileSnapshot(GOLDEN("odd-dims"))
  })

  it("z-order: an explicit zIndex wins, ties keep array order", async () => {
    const g = graph({ layers: [CARD(0, 1, 2, { zIndex: 5 }), CARD(1, 1, 2), CARD(2, 1, 2, { zIndex: 0 })] })
    const inputs = g.args.filter((a) => a.startsWith("/w/layer-"))
    expect(inputs).toEqual(["/w/layer-2.png", "/w/layer-1.png", "/w/layer-0.png"])
    await expect(golden(g)).toMatchFileSnapshot(GOLDEN("z-order"))
  })

  it("a VFR base (no usable r_frame_rate) uses avg_frame_rate; a bogus 90000/1 falls back to 30", async () => {
    const vfr = graph({ probe: { ...PROBE, rFrameRate: undefined, avgFrameRate: "30000/1001" }, layers: [CARD(0, 1, 2)] })
    expect(vfr.args).toContain("30000/1001")
    await expect(golden(vfr)).toMatchFileSnapshot(GOLDEN("vfr"))
    const bogus = graph({ probe: { ...PROBE, rFrameRate: "90000/1", avgFrameRate: "0/0" }, layers: [CARD(0, 1, 2)] })
    expect(bogus.args[bogus.args.indexOf("-framerate") + 1]).toBe("30")
  })

  it("a base whose start_time is 1.0 builds the IDENTICAL graph (no -copyts, no PTS reset)", () => {
    expect(graph({ probe: { ...PROBE, startTimeSec: 1 }, layers: [CARD(0, 1, 2)] }).args).toEqual(graph({ layers: [CARD(0, 1, 2)] }).args)
  })

  it("a rotated base (stored 1920×1080, tag 90 → display 1080×1920): the card lands centred on the portrait canvas", async () => {
    const probe = { ...PROBE, width: 1080, height: 1920, rotation: 90 }
    const canvas = videoOverlayCanvas(probe)!
    expect(canvas).toEqual({ w: 1080, h: 1920 })
    const g = graph({ probe, canvas, layers: [layer(canvas, { index: 0, start: 1, end: 2, box: VIDEO_OVERLAY_PRESETS.card, aspect: 0.5 })] })
    expect(chains(g)[2]).toContain("overlay=x='252+(576-overlay_w)/2'")
    expect(g.args.join(" ")).not.toMatch(/rotate/)
    await expect(golden(g)).toMatchFileSnapshot(GOLDEN("rotated"))
  })

  it("a SAR 2:1 base (540×1920, display 9:16): canvas 1080×1920, the SAR resolved in the base chain", async () => {
    const probe = { ...PROBE, width: 540, height: 1920, sar: 2 }
    const canvas = videoOverlayCanvas(probe)!
    expect(canvas).toEqual({ w: 1080, h: 1920 })
    const g = graph({ probe, canvas, layers: [layer(canvas, { index: 0, start: 1, end: 2, box: VIDEO_OVERLAY_PRESETS.card, aspect: 0.5 })] })
    expect(chains(g)[0]).toBe("[0:v]scale=trunc(iw*sar/2)*2:trunc(ih/2)*2,setsar=1[base]")
    await expect(golden(g)).toMatchFileSnapshot(GOLDEN("sar"))
  })

  it("a very tall image at width 60 % (no height): pre-fit recorded 192×1920, overlay on the clamped rect", async () => {
    const l = layer(PORTRAIT, { index: 0, start: 1, end: 2, box: { anchor: "center", x: 0, y: 0, width: 60, fit: "contain" }, aspect: 400 / 4000 })
    expect(l.prefit).toEqual({ width: 192, height: 1920 })
    const g = graph({ layers: [l] })
    expect(chains(g)[2]).toBe("[base][ov1]overlay=x='444+(192-overlay_w)/2':y='0+(1920-overlay_h)/2':eof_action=pass[v1]")
    await expect(golden(g)).toMatchFileSnapshot(GOLDEN("tall"))
  })

  it("a layer drawn at the 2×2 floor still builds (Review Focus 4)", async () => {
    const canvas = { w: 100, h: 100 }
    const l = layer(canvas, { index: 0, start: 0, end: 1, box: { anchor: "top-left", x: 0, y: 0, width: 1, fit: "contain" }, aspect: 1 })
    expect(l.drawn).toMatchObject({ width: 2, height: 2 })
    const g = graph({ probe: { ...PROBE, width: 100, height: 100 }, canvas, layers: [l] })
    expect(chains(g)[1]).toContain("scale=w='if(isnan(t),2,trunc(2*")
    await expect(golden(g)).toMatchFileSnapshot(GOLDEN("tiny"))
  })

  it("refuses a pre-fit that disagrees with the drawn rect, an empty window, and no layers", () => {
    const l = CARD(0, 1, 2)
    expect(() => graph({ layers: [{ ...l, prefit: { width: 575, height: 1152 } }] })).toThrow(/pre-fitted to 575x1152 but is drawn at 576x1152/)
    expect(() => graph({ layers: [{ ...l, end: 1 }] })).toThrow(/empty window/)
    expect(() => graph({ layers: [] })).toThrow(/no layers/)
  })
})

// ── Video layers, a placed base, a layer's sound ────────────────────────────

/** A 16:9 video drawn full width against the bottom of the 1080×1920 canvas. */
const R: VideoOverlayRect = { left: 0, top: 1314, width: 1080, height: 606 }
const silentProbe: VideoOverlayBaseProbe = { ...PROBE, audioCodec: null }

/** A kept video layer as the worker hands it over: no pre-fit runs for a video, so `prefit` is its drawn size. */
function videoLayer(over: Partial<VideoOverlayGraphLayer> = {}): VideoOverlayGraphLayer {
  const index = over.index ?? 0
  const drawn = over.drawn ?? { left: 270, top: 808, width: 540, height: 304 }
  return {
    index,
    path: `/w/video-${index}.mp4`,
    start: 0,
    end: 2,
    opacity: 1,
    animate: false,
    video: { fit: "contain", hasAudio: false },
    ...over,
    drawn,
    prefit: over.prefit ?? { width: drawn.width, height: drawn.height },
  }
}

const soundLayer = videoLayer({ start: 2, end: 7, video: { fit: "contain", hasAudio: true, sound: { volume: 1 } } })

/** `graph` with one image card unless the case gives its own layers. */
const build = (over: Partial<VideoOverlayGraphSpec> = {}): VideoOverlayGraph => graph({ layers: [CARD(0, 1, 2)], ...over })

const OUTPUT_TAIL = ["-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p"]

describe("buildVideoOverlayGraph — video layers, a placed base, sound", () => {
  it("a video layer is a real input, sized in the graph, held and trimmed", () => {
    const g = build({ layers: [videoLayer({ start: 2, end: 7, drawn: R, video: { fit: "cover", hasAudio: true } })] })
    expect(g.args).not.toContain("-loop")
    expect(g.filterComplex).toContain("force_original_aspect_ratio=increase,crop=")
    expect(g.filterComplex).toContain("tpad=stop_mode=clone:stop_duration=5.000")
    expect(g.filterComplex).toContain("trim=duration=5.000")
  })

  it("a placed base sits on the background colour", () => {
    const g = build({ basePlacement: { drawn: { left: 0, top: 1314, width: 1080, height: 606 }, fit: "contain" }, outputAspect: "9:16", backgroundColor: "#112233" })
    expect(g.filterComplex).toContain("[bsrc]scale=1080:1920:flags=neighbor,setsar=1,format=rgb24,drawbox=x=0:y=0:w=iw:h=ih:color=0x112233:t=fill[bg]")
    expect(g.filterComplex).toContain("overlay=0:1314")
  })

  it("a layer's sound mixes at its window and volume", () => {
    const g = build({ layers: [videoLayer({ start: 2, end: 7, video: { fit: "contain", hasAudio: true, sound: { volume: 0.8 } } })] })
    expect(g.filterComplex).toContain("adelay=2000:all=1")
    expect(g.filterComplex).toContain("volume=0.800")
    expect(g.filterComplex).toContain("amix=inputs=2")
    expect(g.args).toEqual(expect.arrayContaining(["-map", "[aout]", "-c:a", "aac"]))
    expect(g.audioMixed).toBe(true)
  })

  it("a silent base with a layer's sound carries the layer", () => {
    const g = build({ probe: silentProbe, layers: [soundLayer] })
    expect(g.filterComplex).toContain("amix=inputs=1")
    expect(g.args).not.toContain("0:a:0?")
  })

  it("sound on a layer with no audio leaves the base untouched", () => {
    const g = build({ layers: [videoLayer({ video: { fit: "contain", hasAudio: false, sound: { volume: 1 } } })] })
    expect(g.args).toEqual(expect.arrayContaining(["-map", "0:a:0?", "-c:a", "copy"]))
    expect(g.audioMixed).toBe(false)
  })

  it("a video layer's chain, exactly: SAR resolved, fitted to the drawn rect, at the base's rate, held and trimmed to its window, then the image body", () => {
    const cover = build({ layers: [videoLayer({ start: 2, end: 7, drawn: R, video: { fit: "cover", hasAudio: false } })] })
    expect(cover.args.slice(0, 5)).toEqual(["-y", "-i", "/w/input.mp4", "-i", "/w/video-0.mp4"])
    expect(chains(cover)).toEqual([
      "[0:v]scale=trunc(iw*sar/2)*2:trunc(ih/2)*2,setsar=1[base]",
      "[1:v]scale=iw*sar:ih,setsar=1,scale=1080:606:force_original_aspect_ratio=increase,crop=1080:606,fps=30/1," +
        "tpad=stop_mode=clone:stop_duration=5.000,trim=duration=5.000,setpts=PTS-STARTPTS,format=rgba,setpts=PTS+2.000/TB[ov1]",
      "[base][ov1]overlay=x='0+(1080-overlay_w)/2':y='1314+(606-overlay_h)/2':eof_action=pass[v1]",
    ])
    const contain = build({ layers: [videoLayer({ start: 2, end: 7, drawn: R, video: { fit: "contain", hasAudio: false } })] })
    expect(chains(contain)[1]).toBe(
      "[1:v]scale=iw*sar:ih,setsar=1,scale=1080:606,fps=30/1," +
        "tpad=stop_mode=clone:stop_duration=5.000,trim=duration=5.000,setpts=PTS-STARTPTS,format=rgba,setpts=PTS+2.000/TB[ov1]",
    )
  })

  it("picture and sound keep the file's offset: a picture that starts after its sound holds its first frame that long", () => {
    // A B-frame MP4 without an edit list: its picture starts 0.067 s after its sound.
    const g = build({ layers: [videoLayer({ start: 2, end: 7, drawn: R, video: { fit: "contain", hasAudio: true, sound: { volume: 1 }, audioOffsetSec: -0.0667 } })] })
    expect(chains(g)[1]).toBe(
      "[1:v]scale=iw*sar:ih,setsar=1,scale=1080:606,setpts=PTS-STARTPTS,fps=30/1," +
        "tpad=start_mode=clone:start_duration=0.067:stop_mode=clone:stop_duration=5.000,trim=duration=5.000,setpts=PTS-STARTPTS,format=rgba,setpts=PTS+2.000/TB[ov1]",
    )
    // The sound starts at the window's start, as it does at the file's.
    expect(chains(g)[3]).toBe("[1:a:0]atrim=duration=5.000,asetpts=PTS-STARTPTS,aresample=async=1:min_hard_comp=0:first_pts=0,volume=1.000,adelay=2000:all=1[a1]")
  })

  it("picture and sound keep the file's offset: a sound that starts after its picture is delayed that long, and cut to the window", () => {
    const g = build({ layers: [videoLayer({ start: 2, end: 7, drawn: R, video: { fit: "contain", hasAudio: true, sound: { volume: 1 }, audioOffsetSec: 0.05 } })] })
    expect(chains(g)[1]).toBe(
      "[1:v]scale=iw*sar:ih,setsar=1,scale=1080:606,fps=30/1," +
        "tpad=stop_mode=clone:stop_duration=5.000,trim=duration=5.000,setpts=PTS-STARTPTS,format=rgba,setpts=PTS+2.000/TB[ov1]",
    )
    expect(chains(g)[3]).toBe("[1:a:0]atrim=duration=4.950,asetpts=PTS-STARTPTS,aresample=async=1:min_hard_comp=0:first_pts=0,volume=1.000,adelay=2050:all=1[a1]")
  })

  it("a sounding layer's timestamp gaps are filled with silence after its own reset, so the AAC mix cannot pull the sound after a gap early", () => {
    const g = build({ layers: [videoLayer({ start: 2, end: 7, drawn: R, video: { fit: "contain", hasAudio: true, sound: { volume: 1 } } })] })
    // From 0 (its reset), every gap over a millisecond is filled; async=1 alone fills only gaps over 0.1 s.
    expect(chains(g)[3]).toMatch(/^\[1:a:0\]atrim=duration=5\.000,asetpts=PTS-STARTPTS,aresample=async=1:min_hard_comp=0:first_pts=0,volume=/)
    // Nothing else resamples: not the base's audio, not a run whose sound is not mixed.
    expect(g.filterComplex.match(/aresample/g)).toHaveLength(1)
    for (const quiet of [
      build(),
      build({ layers: [videoLayer({ video: { fit: "contain", hasAudio: true } })] }),
      build({ layers: [videoLayer({ video: { fit: "contain", hasAudio: false, sound: { volume: 1 } } })] }),
    ]) expect(quiet.filterComplex).not.toContain("aresample")
  })

  it("the offset holds whether or not the sound is turned on: a silent-in-the-mix layer's picture is placed on the same origin", () => {
    const g = build({ layers: [videoLayer({ start: 2, end: 7, drawn: R, video: { fit: "contain", hasAudio: true, audioOffsetSec: -0.0667 } })] })
    expect(chains(g)[1]).toContain(",setpts=PTS-STARTPTS,fps=30/1,tpad=start_mode=clone:start_duration=0.067:stop_mode=clone:")
    expect(g.audioMixed).toBe(false)
  })

  it("an offset too small to write (under half a millisecond), or a sound longer gone than the window, changes nothing it should not", () => {
    const plain = build({ layers: [videoLayer({ start: 2, end: 7, drawn: R, video: { fit: "contain", hasAudio: true, sound: { volume: 1 } } })] })
    for (const audioOffsetSec of [0, 0.0004, -0.0004]) {
      const g = build({ layers: [videoLayer({ start: 2, end: 7, drawn: R, video: { fit: "contain", hasAudio: true, sound: { volume: 1 }, audioOffsetSec } })] })
      expect(g.filterComplex).toBe(plain.filterComplex)
    }
    // A sound starting after the whole window still trims to a positive length (0 would mean "no limit" to atrim).
    const late = build({ layers: [videoLayer({ start: 2, end: 2.1, drawn: R, video: { fit: "contain", hasAudio: true, sound: { volume: 1 }, audioOffsetSec: 0.5 } })] })
    expect(chains(late)[3]).toBe("[1:a:0]atrim=duration=0.001,asetpts=PTS-STARTPTS,aresample=async=1:min_hard_comp=0:first_pts=0,volume=1.000,adelay=2500:all=1[a1]")
  })

  it("a video layer keeps opacity and the animation after its own timing reset; the rate follows the base (VFR → avg_frame_rate)", () => {
    const g = build({ probe: { ...PROBE, rFrameRate: undefined, avgFrameRate: "30000/1001" }, layers: [videoLayer({ start: 1, end: 3, opacity: 0.5, animate: true })] })
    expect(chains(g)[1]).toMatch(/,fps=30000\/1001,tpad=stop_mode=clone:stop_duration=2\.000,trim=duration=2\.000,setpts=PTS-STARTPTS,format=rgba,colorchannelmixer=aa=0\.500,fade=t=in:st=0:d=0\.150:alpha=1,/)
    expect(chains(g)[1]).toMatch(/setpts=PTS\+1\.000\/TB\[ov1\]$/)
  })

  it("image and video layers share the render order: the image keeps its looped still input, the video is a bare -i", () => {
    const g = build({ layers: [CARD(0, 1, 2), videoLayer({ index: 1, start: 0, end: 4 })] })
    expect(g.args.slice(0, 16)).toEqual([
      "-y", "-i", "/w/input.mp4",
      "-f", "image2", "-loop", "1", "-framerate", "30/1", "-t", "1.000", "-i", "/w/layer-0.png",
      "-i", "/w/video-1.mp4",
      "-filter_complex",
    ])
    expect(chains(g)[1]).toMatch(/^\[1:v\]format=rgba,/)
    expect(chains(g)[3]).toMatch(/^\[2:v\]scale=iw\*sar:ih,setsar=1,/)
    expect(chains(g)[4]).toMatch(/^\[v1\]\[ov2\]overlay=/)
  })

  it("a video layer with no sound turned on: the base's audio exactly as an image-only run (copy, or AAC for a codec MP4 cannot carry)", () => {
    for (const video of [{ fit: "contain" as const, hasAudio: true }, { fit: "cover" as const, hasAudio: false }]) {
      const g = build({ layers: [videoLayer({ video })] })
      expect(g.args.slice(-17)).toEqual(["-map", "[v1]", "-map", "0:a:0?", ...OUTPUT_TAIL, "-c:a", "copy", "-movflags", "+faststart", "/w/output.mp4"])
      expect(g.filterComplex).not.toContain(":a:0]")
      expect(g.audioMixed).toBe(false)
      expect(g.audioReencoded).toBe(false)
    }
    const pcm = build({ probe: { ...PROBE, audioCodec: "pcm_s16le" }, layers: [videoLayer({ video: { fit: "contain", hasAudio: true } })] })
    expect(pcm.audioReencoded).toBe(true)
    expect(pcm.audioMixed).toBe(false)
    expect(pcm.args.join(" ")).toContain("-map 0:a:0? -c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p -c:a aac -b:a 128k")
  })

  it("an image-only run never mixes", () => {
    for (const probe of [PROBE, silentProbe, { ...PROBE, audioCodec: "pcm_s16le" }]) expect(build({ probe }).audioMixed).toBe(false)
  })

  it("the mix, exactly: the layer trimmed to its window, at its volume, delayed to its start; the base's first audio; summed unnormalised, cut at the base's length; AAC", () => {
    const g = build({ layers: [videoLayer({ start: 5.24, end: 7, video: { fit: "contain", hasAudio: true, sound: { volume: 0.8 } } })] })
    expect(chains(g).slice(3)).toEqual([
      "[1:a:0]atrim=duration=1.760,asetpts=PTS-STARTPTS,aresample=async=1:min_hard_comp=0:first_pts=0,volume=0.800,adelay=5240:all=1[a1]",
      "[0:a:0][a1]amix=inputs=2:duration=longest:normalize=0,alimiter=level=disabled:limit=0.891251:latency=enabled,apad=whole_dur=24.800,atrim=duration=24.800[aout]",
    ])
    expect(g.args.slice(-19)).toEqual([
      "-map", "[v1]", "-map", "[aout]", ...OUTPUT_TAIL, "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "/w/output.mp4",
    ])
    expect(g.audioMixed).toBe(true)
    expect(g.audioReencoded).toBe(false)
  })

  it("a silent base: the mix is the layer's sound alone, padded from 0 to its start", () => {
    const g = build({ probe: silentProbe, layers: [soundLayer] })
    expect(chains(g).slice(3)).toEqual([
      "[1:a:0]atrim=duration=5.000,asetpts=PTS-STARTPTS,aresample=async=1:min_hard_comp=0:first_pts=0,volume=1.000,adelay=2000:all=1[a1]",
      "[a1]amix=inputs=1:duration=longest:normalize=0,alimiter=level=disabled:limit=0.891251:latency=enabled,apad=whole_dur=24.800,atrim=duration=24.800[aout]",
    ])
    expect(g.args).toEqual(expect.arrayContaining(["-map", "[aout]"]))
  })

  it("the mixed sound passes a limiter at −1 dBFS — its own level never raised (level off), its lookahead delay compensated (latency on); a run with no mixed sound has none", () => {
    expect(VIDEO_OVERLAY_MIX_PEAK_DBFS).toBe(-1)
    // −1 dBFS as a linear peak, to 6 places.
    expect((10 ** (VIDEO_OVERLAY_MIX_PEAK_DBFS / 20)).toFixed(6)).toBe("0.891251")
    expect(build({ layers: [soundLayer] }).filterComplex).toContain("amix=inputs=2:duration=longest:normalize=0,alimiter=level=disabled:limit=0.891251:latency=enabled,apad=")
    expect(build({ probe: silentProbe, layers: [soundLayer] }).filterComplex).toContain("[a1]amix=inputs=1:duration=longest:normalize=0,alimiter=")
    for (const g of [build(), build({ layers: [videoLayer({ video: { fit: "contain", hasAudio: true } })] }), build({ probe: { ...PROBE, audioCodec: "pcm_s16le" } })]) {
      expect(g.filterComplex).not.toContain("alimiter")
    }
  })

  it("the mix is padded with silence to the base's length, then cut there — a silent base's audio is exactly as long as the video", () => {
    const silent = build({ probe: { ...silentProbe, streamDurationSec: 3 }, layers: [videoLayer({ start: 0.5, end: 2.5, video: { fit: "contain", hasAudio: true, sound: { volume: 1 } } })] })
    expect(silent.filterComplex).toContain("amix=inputs=1:duration=longest:normalize=0,alimiter=level=disabled:limit=0.891251:latency=enabled,apad=whole_dur=3.000,atrim=duration=3.000[aout]")
    expect(build({ layers: [soundLayer] }).filterComplex).toContain(",apad=whole_dur=24.800,atrim=duration=24.800[aout]")
    for (const g of [build(), build({ layers: [videoLayer({ video: { fit: "contain", hasAudio: true } })] })]) expect(g.filterComplex).not.toContain("apad")
  })

  it("a base whose codec MP4 cannot carry, mixed: AAC once, reported as a mix, not as a re-encode", () => {
    const g = build({ probe: { ...PROBE, audioCodec: "pcm_s16le" }, layers: [soundLayer] })
    expect(g.audioMixed).toBe(true)
    expect(g.audioReencoded).toBe(false)
    expect(g.args.filter((a) => a === "-c:a")).toHaveLength(1)
    expect(g.args.join(" ")).toContain("-c:a aac -b:a 128k")
  })

  it("each sound reads ITS OWN input — the render-order position, not the request index", () => {
    const top = videoLayer({ index: 0, zIndex: 5, start: 1, end: 3, video: { fit: "contain", hasAudio: true, sound: { volume: 0.5 } } })
    const under = videoLayer({ index: 1, start: 4, end: 6, video: { fit: "contain", hasAudio: true, sound: { volume: 1 } } })
    const g = build({ layers: [top, under] })
    expect(g.args.filter((a) => a.startsWith("/w/video-"))).toEqual(["/w/video-1.mp4", "/w/video-0.mp4"])
    const c = chains(g)
    expect(c).toContain("[1:a:0]atrim=duration=2.000,asetpts=PTS-STARTPTS,aresample=async=1:min_hard_comp=0:first_pts=0,volume=1.000,adelay=4000:all=1[a1]")
    expect(c).toContain("[2:a:0]atrim=duration=2.000,asetpts=PTS-STARTPTS,aresample=async=1:min_hard_comp=0:first_pts=0,volume=0.500,adelay=1000:all=1[a2]")
    expect(c[c.length - 1]).toBe("[0:a:0][a1][a2]amix=inputs=3:duration=longest:normalize=0,alimiter=level=disabled:limit=0.891251:latency=enabled,apad=whole_dur=24.800,atrim=duration=24.800[aout]")
  })

  it("only a layer with both sound and an audio track joins the mix", () => {
    const g = build({ layers: [soundLayer, videoLayer({ index: 1, video: { fit: "contain", hasAudio: true } }), videoLayer({ index: 2, video: { fit: "contain", hasAudio: false, sound: { volume: 1 } } })] })
    expect(g.filterComplex).toContain("[0:a:0][a1]amix=inputs=2:")
    expect(g.filterComplex).not.toContain("[2:a:0]")
    expect(g.filterComplex).not.toContain("[3:a:0]")
  })

  it("a placed base, exactly: the base's own frames, split — one scaled to the canvas and filled with the background colour, one fitted into the rect and laid on it", () => {
    const contain = build({ basePlacement: { drawn: R, fit: "contain" }, outputAspect: "9:16", backgroundColor: "#112233" })
    expect(chains(contain).slice(0, 4)).toEqual([
      "[0:v]scale=iw*sar:ih,setsar=1,split[bsrc][bfit]",
      "[bsrc]scale=1080:1920:flags=neighbor,setsar=1,format=rgb24,drawbox=x=0:y=0:w=iw:h=ih:color=0x112233:t=fill[bg]",
      "[bfit]scale=1080:606[b]",
      "[bg][b]overlay=0:1314[base]",
    ])
    expect(chains(contain)[5]).toMatch(/^\[base\]\[ov1\]overlay=/)
    const cover = build({ basePlacement: { drawn: { left: 0, top: 0, width: 1080, height: 960 }, fit: "cover" }, outputAspect: "9:16", baseFit: "contain", backgroundColor: "#FF0000" })
    expect(chains(cover).slice(0, 4)).toEqual([
      "[0:v]scale=iw*sar:ih,setsar=1,split[bsrc][bfit]",
      "[bsrc]scale=1080:1920:flags=neighbor,setsar=1,format=rgb24,drawbox=x=0:y=0:w=iw:h=ih:color=0xFF0000:t=fill[bg]",
      "[bfit]scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960[b]",
      "[bg][b]overlay=0:0[base]",
    ])
    expect(cover.filterComplex).not.toContain("pad=")
  })

  it("a placed base's canvas is filled in RGB, so the colour is right on a full-range base too; its scale is the cheapest, since every pixel is painted over", () => {
    const canvas = chains(build({ basePlacement: { drawn: R, fit: "contain" }, outputAspect: "9:16", backgroundColor: "#FFFFFF" }))[1]!
    expect(canvas).toMatch(/^\[bsrc\]scale=1080:1920:flags=neighbor,setsar=1,format=rgb24,drawbox=[^,]*:color=0xFFFFFF:t=fill\[bg\]$/)
    expect(canvas.indexOf("format=rgb24")).toBeLessThan(canvas.indexOf("drawbox="))
  })

  it("a placed base takes no rate, length or source of its own: the canvas inherits the base's timestamps, frame count and length", () => {
    for (const probe of [PROBE, { ...PROBE, rFrameRate: undefined, avgFrameRate: "30000/1001", streamDurationSec: 3.5 }]) {
      const base = chains(build({ probe, basePlacement: { drawn: R, fit: "contain" }, outputAspect: "9:16" })).slice(0, 4).join(";")
      expect(base).not.toMatch(/color=c=|:d=|:r=|fps=|trim|tpad|setpts/)
      expect(base).toBe(chains(build({ basePlacement: { drawn: R, fit: "contain" }, outputAspect: "9:16" })).slice(0, 4).join(";"))
    }
  })

  it("a placed base whose box pokes past the canvas edge is laid at its negative offset, clipped by the canvas", () => {
    const g = build({ basePlacement: { drawn: { left: -60, top: -34, width: 1200, height: 676 }, fit: "cover" }, outputAspect: "9:16" })
    expect(chains(g)[2]).toBe("[bfit]scale=1200:676:force_original_aspect_ratio=increase,crop=1200:676[b]")
    expect(chains(g)[3]).toBe("[bg][b]overlay=-60:-34[base]")
  })

  it("a video layer still has its pre-fit checked against its drawn rect (its prefit is its drawn size)", () => {
    expect(() => build({ layers: [videoLayer({ prefit: { width: 2, height: 2 } })] })).toThrow(/layer 0 was pre-fitted to 2x2 but is drawn at 540x304/)
  })

  it("golden: two 16:9 videos stacked whole on 9:16 with a card above, the lower one's sound on", async () => {
    const g = build({
      outputAspect: "9:16",
      basePlacement: { drawn: { left: 0, top: 354, width: 1080, height: 606 }, fit: "contain" },
      layers: [
        videoLayer({ index: 0, start: 0, end: 24.8, drawn: { left: 0, top: 960, width: 1080, height: 606 }, video: { fit: "contain", hasAudio: true, sound: { volume: 0.8 } } }),
        CARD(1, 2, 5),
      ],
    })
    await expect(golden(g)).toMatchFileSnapshot(GOLDEN("stack-video-sound"))
  })
})

describe("videoOverlayImageFramerate", () => {
  it.each([
    [{ rFrameRate: "30/1", avgFrameRate: "30/1" }, "30/1"],
    [{ rFrameRate: "30000/1001", avgFrameRate: "30/1" }, "30000/1001"],
    [{ rFrameRate: "90000/1", avgFrameRate: "25/1" }, "25/1"],
    [{ rFrameRate: "0/0", avgFrameRate: "24/1" }, "24/1"],
    [{ rFrameRate: "30/0", avgFrameRate: undefined }, "30"],
    [{ rFrameRate: undefined, avgFrameRate: undefined }, "30"],
  ])("%o → %s", (probe, rate) => {
    expect(videoOverlayImageFramerate(probe)).toBe(rate)
  })
})
