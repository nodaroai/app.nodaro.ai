/**
 * Video Overlay — the ffmpeg invocation, as a PURE function of what the worker
 * has already established (spec §4.3): the base probe, the output canvas, and
 * every kept layer with its window, its drawn rect and the path of its
 * PRE-FITTED PNG (decision D1 — each layer is already exactly `drawn`-sized, so
 * the graph carries no per-layer fit scale/crop). No I/O; golden-tested.
 *
 *   inputs   0 = the base (the CLI's autorotate stays on — a rotation-tagged
 *            base reaches [0:v] upright; never `-noautorotate`, never
 *            `-copyts`, no PTS reset: layer times are on the file's player
 *            clock), then one `-f image2 -loop 1 -framerate <base rate> -t
 *            <end − start> -i layer.png` per layer, in render order;
 *   base     SAR resolved first (`iw*sar`), even-rounded; or fitted into the
 *            target canvas (cover crops, contain pads with the colour);
 *   layer    format=rgba → opacity (colorchannelmixer) → alpha fades →
 *            per-frame scale 0.96 → 1 → 0.96 (`eval=frame`; the `isnan(t)`
 *            guard makes configure-time evaluation the full size) →
 *            setpts onto the base clock;
 *   chain    overlay centred on the drawn rect, `eof_action=pass` — the `-t`
 *            bound and the setpts shift ARE the window (no `enable`);
 *   output   libx264 fast crf 18 yuv420p +faststart; the FIRST audio stream
 *            (optional) copied when its codec muxes into MP4 as-is, else AAC.
 */
import {
  VIDEO_OVERLAY_ANIMATION_MIN_SCALE,
  VIDEO_OVERLAY_ANIMATION_SEC,
  videoOverlayRenderOrder,
  type VideoOverlayCanvas,
  type VideoOverlayFit,
  type VideoOverlayOutputAspect,
  type VideoOverlayRect,
} from "@nodaro/shared"
import type { VideoOverlayBaseProbe } from "./ffmpeg-utils.js"
import { padHexToFfmpeg } from "./still-segment.js"

/** Audio codecs `-c:a copy` can put into an MP4 unchanged. Decided from the PROBE — a PCM copy into MP4 "succeeds" silently, so a retry-on-failure fallback would never fire. */
export const VIDEO_OVERLAY_COPYABLE_AUDIO_CODECS: ReadonlySet<string> = new Set(["aac", "mp3", "ac3", "opus"])
/** A frame rate above this is not a real cadence (a bogus `90000/1` timebase). */
export const VIDEO_OVERLAY_MAX_IMAGE_FPS = 240
/**
 * Shortest window that takes the fade + scale animation. Below it the ramp R
 * (half the window) rounds to "0.000", and ffmpeg cannot configure `fade d=0`
 * with a scale expression dividing by `t/0.000` — the render fails every retry.
 * At 2 ms R is at least "0.001". A shorter layer renders as a plain still; the
 * demuxer yields at most one frame for it anyway.
 */
export const VIDEO_OVERLAY_MIN_ANIMATED_SEC = 0.002

export interface VideoOverlayGraphLayer {
  /** 0-based index in the request's layers[] (messages / warnings). */
  readonly index: number
  readonly slot?: number
  /** The pre-fitted PNG. */
  readonly path: string
  /** What the pre-fit actually wrote — must equal `drawn`. */
  readonly prefit: { readonly width: number; readonly height: number }
  readonly start: number
  /** Already clamped to the base's duration. */
  readonly end: number
  readonly drawn: VideoOverlayRect
  readonly opacity: number
  readonly animate: boolean
  readonly zIndex?: number
}

export interface VideoOverlayGraphSpec {
  readonly inputPath: string
  readonly outputPath: string
  readonly probe: VideoOverlayBaseProbe
  readonly canvas: VideoOverlayCanvas
  readonly outputAspect?: VideoOverlayOutputAspect
  readonly baseFit: VideoOverlayFit
  readonly backgroundColor: string
  readonly layers: ReadonlyArray<VideoOverlayGraphLayer>
}

export interface VideoOverlayGraph {
  readonly args: string[]
  readonly filterComplex: string
  /** The base's audio is transcoded to AAC (warning `audio_reencoded`). */
  readonly audioReencoded: boolean
}

const t3 = (n: number): string => n.toFixed(3)

function usableRate(rate: string | undefined): string | undefined {
  if (typeof rate !== "string") return undefined
  const trimmed = rate.trim()
  const [num, den] = trimmed.split("/")
  const n = Number(num)
  const d = den === undefined ? 1 : Number(den)
  if (!Number.isFinite(n) || !Number.isFinite(d) || n <= 0 || d <= 0) return undefined
  const fps = n / d
  return fps > 0 && fps <= VIDEO_OVERLAY_MAX_IMAGE_FPS ? trimmed : undefined
}

/** The still inputs' `-framerate`: the base's r_frame_rate → avg_frame_rate → 30. */
export function videoOverlayImageFramerate(probe: Pick<VideoOverlayBaseProbe, "rFrameRate" | "avgFrameRate">): string {
  return usableRate(probe.rFrameRate) ?? usableRate(probe.avgFrameRate) ?? "30"
}

function baseChain(spec: VideoOverlayGraphSpec): string {
  if (!spec.outputAspect) return "[0:v]scale=trunc(iw*sar/2)*2:trunc(ih/2)*2,setsar=1[base]"
  const { w, h } = spec.canvas
  if (spec.baseFit === "contain") {
    return `[0:v]scale=iw*sar:ih,setsar=1,scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=${padHexToFfmpeg(spec.backgroundColor)}[base]`
  }
  return `[0:v]scale=iw*sar:ih,setsar=1,scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}[base]`
}

function layerChain(l: VideoOverlayGraphLayer, input: number, label: string): string {
  const dur = l.end - l.start
  const parts = ["format=rgba"]
  if (l.opacity < 1) parts.push(`colorchannelmixer=aa=${t3(l.opacity)}`)
  // The 1e-9 slack keeps a nominal 2 ms window (2.002 − 2 = 0.00199999…) animated; its R still rounds to 0.001.
  if (l.animate && dur >= VIDEO_OVERLAY_MIN_ANIMATED_SEC - 1e-9) {
    const r = Math.min(VIDEO_OVERLAY_ANIMATION_SEC, dur / 2)
    const R = t3(r)
    const outAt = t3(dur - r)
    const lo = String(VIDEO_OVERLAY_ANIMATION_MIN_SCALE)
    const span = (1 - VIDEO_OVERLAY_ANIMATION_MIN_SCALE).toFixed(2)
    const s = `(${lo}+${span}*min(1,t/${R})-${span}*max(0,(t-${outAt})/${R}))`
    const { width: dw, height: dh } = l.drawn
    parts.push(
      `fade=t=in:st=0:d=${R}:alpha=1`,
      `fade=t=out:st=${outAt}:d=${R}:alpha=1`,
      `scale=w='if(isnan(t),${dw},trunc(${dw}*${s}/2)*2)':h='if(isnan(t),${dh},trunc(${dh}*${s}/2)*2)':eval=frame`,
    )
  }
  parts.push(`setpts=PTS+${t3(l.start)}/TB`)
  return `[${input}:v]${parts.join(",")}[${label}]`
}

/** Spec §4.3 as argv. Throws on a programming error (a pre-fit that disagrees with `drawn`, an empty window) — never on user input, which the validator and the clamp have already settled. A window shorter than 2 ms (`VIDEO_OVERLAY_MIN_ANIMATED_SEC`) is drawn without the animation even when `animate` is on: its ramp would round to zero, which ffmpeg cannot run. */
export function buildVideoOverlayGraph(spec: VideoOverlayGraphSpec): VideoOverlayGraph {
  if (spec.layers.length === 0) throw new Error("buildVideoOverlayGraph: no layers to draw")
  for (const l of spec.layers) {
    if (l.prefit.width !== l.drawn.width || l.prefit.height !== l.drawn.height) {
      throw new Error(`buildVideoOverlayGraph: layer ${l.index} was pre-fitted to ${l.prefit.width}x${l.prefit.height} but is drawn at ${l.drawn.width}x${l.drawn.height}`)
    }
    if (!(l.end > l.start)) throw new Error(`buildVideoOverlayGraph: layer ${l.index} has an empty window`)
  }
  const rate = videoOverlayImageFramerate(spec.probe)
  const args = ["-y", "-i", spec.inputPath]
  const chains = [baseChain(spec)]
  let prev = "base"
  videoOverlayRenderOrder(spec.layers).forEach((layerIndex, k) => {
    const l = spec.layers[layerIndex]!
    const input = k + 1
    args.push("-f", "image2", "-loop", "1", "-framerate", rate, "-t", t3(l.end - l.start), "-i", l.path)
    const ov = `ov${input}`
    const next = `v${input}`
    chains.push(layerChain(l, input, ov))
    const { left, top, width, height } = l.drawn
    chains.push(`[${prev}][${ov}]overlay=x='${left}+(${width}-overlay_w)/2':y='${top}+(${height}-overlay_h)/2':eof_action=pass[${next}]`)
    prev = next
  })
  const filterComplex = chains.join(";")
  const codec = spec.probe.audioCodec
  const audioReencoded = codec !== null && !VIDEO_OVERLAY_COPYABLE_AUDIO_CODECS.has(codec)
  args.push(
    "-filter_complex", filterComplex,
    "-map", `[${prev}]`,
    "-map", "0:a:0?",
    "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
    ...(audioReencoded ? ["-c:a", "aac", "-b:a", "128k"] : ["-c:a", "copy"]),
    "-movflags", "+faststart",
    spec.outputPath,
  )
  return { args, filterComplex, audioReencoded }
}
