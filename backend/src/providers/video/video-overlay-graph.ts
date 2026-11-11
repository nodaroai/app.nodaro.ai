/**
 * Video Overlay — the ffmpeg invocation, as a PURE function of what the worker
 * has already established (spec §4.3): the base probe, the output canvas, and
 * every kept layer with its window and its drawn rect. An IMAGE layer is the
 * path of its PRE-FITTED PNG (decision D1 — already exactly `drawn`-sized, so
 * the graph carries no fit scale/crop for it); a VIDEO layer has no pre-fit,
 * so its fit lives here. The geometry (drawn rects, a placed base's rect) is
 * the worker's; nothing here computes it. No I/O; golden-tested.
 *
 *   inputs   0 = the base (the CLI's autorotate stays on — a rotation-tagged
 *            base or video layer reaches its [n:v] upright; never
 *            `-noautorotate`, never `-copyts`, no PTS reset: layer times are on
 *            the file's player clock), then per layer, in render order: an
 *            image is `-f image2 -loop 1 -framerate <base rate> -t <end − start>
 *            -i layer.png`, a video a plain `-i layer.mp4`;
 *   base     SAR resolved first (`iw*sar`), even-rounded; or fitted into the
 *            target canvas (cover crops, contain pads with the colour); or,
 *            PLACED, fitted into its drawn rect and laid on a canvas of the
 *            background colour made from the base's own frames (its exact
 *            timestamps, frame count and length — no source of its own);
 *   video    SAR resolved → fitted to the drawn rect (contain = scaled to it,
 *            the rect already has the video's aspect; cover = scaled up and
 *            centre-cropped) → the base's rate → its last frame held and the
 *            whole cut to the window → its own clock reset to 0; then the
 *            image body below. Picture and sound keep the file's offset
 *            (`audioOffsetSec`): whichever starts later waits that long — the
 *            picture on its first frame, the sound in silence;
 *   layer    format=rgba → opacity (colorchannelmixer) → alpha fades →
 *            per-frame scale 0.96 → 1 → 0.96 (`eval=frame`; the `isnan(t)`
 *            guard makes configure-time evaluation the full size) →
 *            setpts onto the base clock;
 *   chain    overlay centred on the drawn rect, `eof_action=pass` — the `-t`
 *            bound (an image) or the trim (a video) and the setpts shift ARE
 *            the window (no `enable`);
 *   sound    only a video layer with its sound on AND an audio track: its
 *            first audio cut to the window, its timestamp gaps filled with
 *            silence, at its volume, delayed to its
 *            start, summed (unnormalised) with the base's first audio when the
 *            base has one, padded with silence to the base's length and cut
 *            there (a silent base's audio is as long as the video) → AAC. No
 *            such layer: the base's audio exactly as below;
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
  type VideoOverlaySound,
} from "@nodaro/shared/video"
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
/**
 * The highest peak a MIXED sound may reach, dBFS. Layers at volume 1 over a
 * loud base sum to +5 to +11.5 dBFS (measured), which would clip; the mix
 * passes a limiter at this level (`MIX_LIMITER`). A run that mixes nothing
 * keeps the base's audio untouched.
 */
export const VIDEO_OVERLAY_MIX_PEAK_DBFS = -1

/** What makes a graph layer a video layer: its file is a video, fitted and timed in the graph. */
export interface VideoOverlayGraphVideo {
  readonly fit: VideoOverlayFit
  /** The layer's file has an audio stream (from its probe). */
  readonly hasAudio: boolean
  /** On = mixed with the base during the window; only heard when `hasAudio`. */
  readonly sound?: VideoOverlaySound
  /**
   * In the layer's file, its sound's start minus its picture's start, seconds
   * (from its probe). Picture and sound share the file's earlier start as one
   * origin, so the offset between them is kept: a picture that starts later
   * (a B-frame MP4 without an edit list, −0.067) holds its first frame that
   * long from the window's start; a sound that starts later is delayed that
   * long. Absent / under half a millisecond: they start together.
   */
  readonly audioOffsetSec?: number
}

export interface VideoOverlayGraphLayer {
  /** 0-based index in the request's layers[] (messages / warnings). */
  readonly index: number
  readonly slot?: number
  /** 1-based layer-plan entry (instead of `slot`); orders the plan under the slot layers. */
  readonly planLayer?: number
  /** The pre-fitted PNG, or the video layer's downloaded file. */
  readonly path: string
  /** What the pre-fit actually wrote — must equal `drawn`. A video layer has no pre-fit: it carries its `drawn` size. */
  readonly prefit: { readonly width: number; readonly height: number }
  readonly start: number
  /** Already clamped to the base's duration. */
  readonly end: number
  readonly drawn: VideoOverlayRect
  readonly opacity: number
  readonly animate: boolean
  readonly zIndex?: number
  /** Present = a video layer. */
  readonly video?: VideoOverlayGraphVideo
}

/** Where the base sits when it is placed in a box: its drawn rect on the canvas and how it fills it. */
export interface VideoOverlayGraphBasePlacement {
  readonly drawn: VideoOverlayRect
  readonly fit: VideoOverlayFit
}

export interface VideoOverlayGraphSpec {
  readonly inputPath: string
  readonly outputPath: string
  readonly probe: VideoOverlayBaseProbe
  readonly canvas: VideoOverlayCanvas
  readonly outputAspect?: VideoOverlayOutputAspect
  readonly baseFit: VideoOverlayFit
  readonly backgroundColor: string
  /** Present = the base is drawn in this rect on a `canvas` of `backgroundColor`; `baseFit` is then unused. */
  readonly basePlacement?: VideoOverlayGraphBasePlacement
  readonly layers: ReadonlyArray<VideoOverlayGraphLayer>
}

export interface VideoOverlayGraph {
  readonly args: string[]
  readonly filterComplex: string
  /** The base's audio is transcoded to AAC because MP4 cannot carry its codec (warning `audio_reencoded`). Never with `audioMixed`. */
  readonly audioReencoded: boolean
  /** A layer's sound is mixed with the base's audio; the output's audio is that mix, in AAC. */
  readonly audioMixed: boolean
}

const t3 = (n: number): string => n.toFixed(3)

/** A sounding layer's audio, from 0, on its timestamps: every gap over a millisecond filled with silence, any overlap trimmed (`mixChains`). */
const FILL_AUDIO_GAPS = "aresample=async=1:min_hard_comp=0:first_pts=0"

/**
 * The mix's peak limiter at `VIDEO_OVERLAY_MIX_PEAK_DBFS`: only peaks above it
 * are turned down — `level=disabled` keeps the limiter from raising the whole
 * mix to the limit, so normal levels and the base's loudness stay as they
 * are — and `latency=enabled` compensates its lookahead, so the sound stays on
 * the picture's timestamps. Every option is on the pinned ffmpeg's alimiter.
 */
const MIX_LIMITER = `alimiter=level=disabled:limit=${(10 ** (VIDEO_OVERLAY_MIX_PEAK_DBFS / 20)).toFixed(6)}:latency=enabled`

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

/** A video layer whose sound joins the mix, with the input number it was given in render order. */
interface SoundingLayer {
  readonly input: number
  readonly layer: VideoOverlayGraphLayer
  readonly sound: VideoOverlaySound
}

/** A picture fitted to a rect: contain = scaled to it (the rect already has the picture's aspect), cover = scaled up and centre-cropped. */
function fitTo(fit: VideoOverlayFit, { width, height }: VideoOverlayRect): string {
  return fit === "cover"
    ? `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`
    : `scale=${width}:${height}`
}

/**
 * The base chain. A PLACED base makes its background canvas from its own
 * frames (split → scaled to the canvas → filled with the colour), so the
 * canvas has exactly the base's timestamps, frame count, VFR timing and
 * length — a separate `color` source starting at 0 would show the background
 * where the base's video starts late (an edit list, video after audio) and cut
 * the base's last frames. The `setsar=1` after the canvas scale matters: a
 * scale to another aspect changes the SAR, and the canvas is the overlay's
 * main input, whose SAR the output inherits. The canvas is filled in RGB:
 * drawbox writes limited-range YUV values even into a full-range (yuvj420p /
 * pc) frame, which turns #000000 into (16,16,16); from RGB, ffmpeg converts the
 * fill into the base's own range. Its scale uses `neighbor` because every
 * pixel is painted over (the output is byte-identical to bicubic). Both inputs
 * of that overlay are split from the same frames, so they end together and the
 * default end handling is right; a rect past the canvas edge is clipped by the
 * overlay.
 */
function baseChain(spec: VideoOverlayGraphSpec): string {
  if (spec.basePlacement) {
    const { drawn, fit } = spec.basePlacement
    const { w, h } = spec.canvas
    return [
      "[0:v]scale=iw*sar:ih,setsar=1,split[bsrc][bfit]",
      `[bsrc]scale=${w}:${h}:flags=neighbor,setsar=1,format=rgb24,drawbox=x=0:y=0:w=iw:h=ih:color=${padHexToFfmpeg(spec.backgroundColor)}:t=fill[bg]`,
      `[bfit]${fitTo(fit, drawn)}[b]`,
      `[bg][b]overlay=${drawn.left}:${drawn.top}[base]`,
    ].join(";")
  }
  if (!spec.outputAspect) return "[0:v]scale=trunc(iw*sar/2)*2:trunc(ih/2)*2,setsar=1[base]"
  const { w, h } = spec.canvas
  if (spec.baseFit === "contain") {
    return `[0:v]scale=iw*sar:ih,setsar=1,scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=${padHexToFfmpeg(spec.backgroundColor)}[base]`
  }
  return `[0:v]scale=iw*sar:ih,setsar=1,scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}[base]`
}

/**
 * How long a video layer's picture and sound each wait, from the window's
 * start, for their first frame / sample: the file's offset between them, on the
 * earlier one's clock. Both "0.000" when they start together (or within half a
 * millisecond, which `t3` cannot write).
 */
function videoLeads(video: VideoOverlayGraphVideo): { readonly picture: string; readonly sound: number } {
  const offset = video.audioOffsetSec ?? 0
  const picture = t3(Math.max(0, -offset))
  const sound = t3(Math.max(0, offset))
  return { picture, sound: Number(sound) }
}

/**
 * A video layer before the image body: fitted to its drawn rect, on the base's
 * rate, its last frame held, cut to the window, its clock reset to 0. A picture
 * that starts after its sound in the file is first reset to its own first
 * frame and then held on that frame for the lead (tpad's start pad counts from
 * 0), so its frames land where the file puts them against its sound.
 */
function videoPrelude(l: VideoOverlayGraphLayer, video: VideoOverlayGraphVideo, rate: string): string[] {
  const dur = t3(l.end - l.start)
  const lead = videoLeads(video).picture
  const late = lead !== "0.000"
  return [
    "scale=iw*sar:ih",
    "setsar=1",
    fitTo(video.fit, l.drawn),
    ...(late ? ["setpts=PTS-STARTPTS"] : []),
    `fps=${rate}`,
    `tpad=${late ? `start_mode=clone:start_duration=${lead}:` : ""}stop_mode=clone:stop_duration=${dur}`,
    `trim=duration=${dur}`,
    "setpts=PTS-STARTPTS",
  ]
}

function layerChain(l: VideoOverlayGraphLayer, input: number, label: string, rate: string): string {
  const dur = l.end - l.start
  const parts = [...(l.video ? videoPrelude(l, l.video, rate) : []), "format=rgba"]
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
  const sounding: SoundingLayer[] = []
  let prev = "base"
  videoOverlayRenderOrder(spec.layers).forEach((layerIndex, k) => {
    const l = spec.layers[layerIndex]!
    const input = k + 1
    if (l.video) args.push("-i", l.path)
    else args.push("-f", "image2", "-loop", "1", "-framerate", rate, "-t", t3(l.end - l.start), "-i", l.path)
    if (l.video?.sound && l.video.hasAudio) sounding.push({ input, layer: l, sound: l.video.sound })
    const ov = `ov${input}`
    const next = `v${input}`
    chains.push(layerChain(l, input, ov, rate))
    const { left, top, width, height } = l.drawn
    chains.push(`[${prev}][${ov}]overlay=x='${left}+(${width}-overlay_w)/2':y='${top}+(${height}-overlay_h)/2':eof_action=pass[${next}]`)
    prev = next
  })
  const codec = spec.probe.audioCodec
  const audioMixed = sounding.length > 0
  if (audioMixed) chains.push(...mixChains(spec, sounding))
  const filterComplex = chains.join(";")
  const audioReencoded = !audioMixed && codec !== null && !VIDEO_OVERLAY_COPYABLE_AUDIO_CODECS.has(codec)
  args.push(
    "-filter_complex", filterComplex,
    "-map", `[${prev}]`,
    "-map", audioMixed ? "[aout]" : "0:a:0?",
    "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
    ...(audioMixed || audioReencoded ? ["-c:a", "aac", "-b:a", "128k"] : ["-c:a", "copy"]),
    "-movflags", "+faststart",
    spec.outputPath,
  )
  return { args, filterComplex, audioReencoded, audioMixed }
}

/**
 * Each sounding layer's first audio cut to its window, at its volume, delayed
 * to its start; summed unnormalised with the base's first audio (when it has
 * one); held under `VIDEO_OVERLAY_MIX_PEAK_DBFS` by a limiter (`MIX_LIMITER`);
 * padded with silence to the base's length and cut there, so the audio is
 * exactly as long as the video → `[aout]`. A sound that starts after its
 * picture in the file is delayed by that lead too, and cut to what is left of
 * the window (never to 0, which atrim reads as no limit). After its reset, a
 * layer's sound has every timestamp gap over a millisecond filled with silence
 * (`aresample=async=1:min_hard_comp=0:first_pts=0`; `async=1` alone fills only
 * gaps over 0.1 s): the mix and the AAC encode go by sample count, so a gap —
 * an MP4 without an edit list stretches its first audio packet over 45 ms —
 * would otherwise be closed and the sound after it would play early.
 */
function mixChains(
  spec: VideoOverlayGraphSpec,
  sounding: ReadonlyArray<SoundingLayer>,
): string[] {
  const layerChains = sounding.map(({ input, layer, sound }) => {
    const lead = videoLeads(layer.video!).sound
    const heard = Math.max(0.001, layer.end - layer.start - lead)
    return `[${input}:a:0]atrim=duration=${t3(heard)},asetpts=PTS-STARTPTS,${FILL_AUDIO_GAPS},volume=${t3(sound.volume)},adelay=${Math.round((layer.start + lead) * 1000)}:all=1[a${input}]`
  })
  const mixed = [...(spec.probe.audioCodec !== null ? ["[0:a:0]"] : []), ...sounding.map(({ input }) => `[a${input}]`)]
  const baseDur = t3(spec.probe.streamDurationSec)
  return [...layerChains, `${mixed.join("")}amix=inputs=${mixed.length}:duration=longest:normalize=0,${MIX_LIMITER},apad=whole_dur=${baseDur},atrim=duration=${baseDur}[aout]`]
}
