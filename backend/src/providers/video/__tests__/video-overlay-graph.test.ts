import { describe, it, expect } from "vitest"
import { VIDEO_OVERLAY_PRESETS, resolveVideoOverlayGeometry, videoOverlayCanvas, type VideoOverlayCanvas } from "@nodaro/shared"
import {
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
