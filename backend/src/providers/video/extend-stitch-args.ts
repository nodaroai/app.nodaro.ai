/**
 * The extend stitch's ffmpeg arguments (pure): the one filter graph and the
 * one encode that join a source and its extension, and the boundary proxies'
 * encode. `extend-stitch.ts` probes the clips, finds the boundary and runs them.
 *
 * - The picture is ONE filter graph. The source is conformed to its nominal
 *   rate (`r_frame_rate`, its exact fraction, within 1–240; else its constant
 *   rate or 30, held to 1–60 as combineVideos' `pickTargetFps` clamps) and
 *   trimmed at its end by frame index: an even-rate clip's frames pass through
 *   unchanged, a variable-rate one is put on the grid it was shot on, as
 *   combineVideos always normalized every clip. The picture is delivered at
 *   the source's size as the graph receives it (upright after the CLI's
 *   autorotate, at its SAR), rounded down to even (`deliveredShape`: an
 *   odd-size source loses its last column and/or row). The extension is
 *   conformed to the source's rate, trimmed at its start by frame index at
 *   that rate, scaled to cover that delivered picture and centre-cropped to
 *   it. The picture is
 *   encoded once at the source's quality (`matched-encode.ts`): an H.264
 *   source's picture bitrate (at least a floor) in two passes and its colour
 *   tags; CRF 14 for any other codec, or when the bitrate is unreadable
 *   (`deliveryPicture`).
 * - The sound crossfades at the join (equal power, `audioFadeSec`). Each
 *   side's sound is first lined up with its own picture, wherever the two
 *   start in their container (`soundOffsetSec`). The source's sound runs the
 *   fade past its picture's cut (its own tail, else silence), so the
 *   extension's sound starts exactly on its picture. A side
 *   with no sound is silence of its picture's exact length, so the result's
 *   sound is as long as its picture, sample for sample. The sound is AAC at the
 *   source's sample rate and bitrate (at most `AAC_MAX_BIT_RATE`).
 * - The result is a delivery (`deliveryPicture`): H.264 4:2:0 and AAC in an
 *   MP4, whatever the source's pixel format, sound or container, so the
 *   upload takes it as it is (`needsTranscode`) and its picture is encoded
 *   once, never again at a fixed quality. A full-range source is delivered
 *   limited range, the extension's own: its levels are converted in the graph
 *   (`toLimited`). An HDR source (PQ or HLG) is delivered in SDR BT.709, the
 *   extension's own: its picture is tone-mapped in the graph (`toSdr`). The
 *   extension's picture is left as it is.
 *
 * Both pictures are held to the frame count their length gives at the output
 * rate: the last frame is cloned for as long as `fps` comes up short, so each
 * picture always reaches the count its sound is cut to, without decoding it
 * first.
 */
import { resolveAudioCrossfadeCurve } from "@nodaro/shared/edl"
import { COMBINE_DELIVERY_CRF } from "./ffmpeg-utils.js"
import { matchedHasBitRate, matchedPictureArgs, type MatchedProbe } from "./matched-encode.js"
import { parseFrameRate } from "./frame-rate.js"

/** What one stitch encode is built from (`extendStitchArgs`). */
export interface ExtendStitchEncode {
  sourcePath: string
  extensionPath: string
  outputPath: string
  source: MatchedProbe
  /** The source's picture as the graph receives it (`probeVideoOverlayBase`). Absent: the probe's size, square pixels. */
  picture?: PictureShape
  /** The source's frames at the output rate, before its end trim: what its picture is held to. */
  sourceFrames: number
  /** The extension's frames at the source's rate, before its start trim: what its picture is held to. */
  extensionFrames: number
  trimEndFrames: number
  trimStartFrames: number
  audioFadeSec: number
  sourceHasAudio: boolean
  extensionHasAudio: boolean
  /**
   * How far each side's sound starts after its own picture, in seconds
   * (negative: before it), as their container places them. Absent or 0: they
   * start together.
   */
  soundOffsetSec?: { source?: number; extension?: number }
  /** The result's sample rate: the source's. Absent: `DEFAULT_SAMPLE_RATE`. */
  audioSampleRate?: number
  /** One of the two passes, which share `log` (pass 1 measures the picture and writes nothing). */
  pass?: { n: 1 | 2; log: string }
}

/** The sound's sample rate when the source's is unreadable. */
const DEFAULT_SAMPLE_RATE = 48_000
/** The AAC bitrate when the source's is unreadable. */
const DEFAULT_AUDIO_BIT_RATE = 192_000
/** The most AAC is asked for: a source whose sound ran higher (PCM) gains nothing above it. */
const AAC_MAX_BIT_RATE = 320_000
const EQUAL_POWER = resolveAudioCrossfadeCurve("equal-power")

interface Size { width: number; height: number }

/**
 * The source's picture as the filter graph receives it: its size after the
 * ffmpeg CLI's autorotate (the axes swapped for 90° and 270°), and its sample
 * aspect as `num/den` in that orientation (absent: square pixels).
 */
export interface PictureShape { width: number; height: number; sarRatio?: string }

/** The output's frame rate: ffmpeg's spelling of it and its value. */
export interface StitchRate { spelling: string; fps: number }

/** The delivered picture's pixel format: the one the upload's browser-safe check passes (`needsTranscode`). */
const DELIVERY_PIX_FMT = "yuv420p"

/** The rates a fallback rate is held to, as combineVideos' `pickTargetFps` clamps them. */
const MIN_FPS = 1
const MAX_FPS = 60
/**
 * The highest nominal rate kept as the source's rate; above it, it is a time
 * base, not a frame rate. The lowest is `MIN_FPS`: below 1 fps the encode
 * cannot hold the picture to its count (its timestamps collapse).
 */
const MAX_NOMINAL_FPS = 240
/** The rate when the source reads none. */
const DEFAULT_FPS = 30

/**
 * The output's rate: the source's own. That is its nominal rate
 * (`r_frame_rate`), as its exact fraction and as it is, within
 * `MIN_FPS`–`MAX_NOMINAL_FPS`: never its average, which a clip off its grid
 * (a millisecond timescale, a phone clip that slows) reads off the grid too.
 *
 * Otherwise (it does not read, or reads outside that) the fallback is the
 * constant rate the probe reads (`fpsRational`), else 30, held to 1–60
 * (`pickTargetFps`'s clamp; a clamped rate is written as its number). The
 * probe reads a constant rate where the average agrees with the nominal
 * rate, where only the average reads (the nominal rate does not), and where
 * only the nominal rate reads (there is no average, and the nominal rate is
 * then the constant rate): so a slideshow below 1 fps falls to 1 and a clip
 * above 240 fps to 60, with or without an average, and a nominal rate that
 * reads as garbage beside a sane average falls to 30.
 */
export function stitchRate(source: MatchedProbe): StitchRate {
  const nominal = parseFrameRate(source.nominalFpsRational)
  if (source.nominalFpsRational && nominal !== undefined && nominal >= MIN_FPS && nominal <= MAX_NOMINAL_FPS) {
    return { spelling: source.nominalFpsRational, fps: nominal }
  }
  const constant = parseFrameRate(source.fpsRational)
  if (!source.fpsRational || constant === undefined) return { spelling: String(DEFAULT_FPS), fps: DEFAULT_FPS }
  if (constant >= MIN_FPS && constant <= MAX_FPS) return { spelling: source.fpsRational, fps: constant }
  const clamped = Math.min(MAX_FPS, Math.max(MIN_FPS, constant))
  return { spelling: String(clamped), fps: clamped }
}

/** A clip's picture size; a clear error when it has no picture (`probeMatched` reads nothing without one). */
export function pictureSize(probe: MatchedProbe, which: "source" | "extension"): Size {
  if (!probe.width || !probe.height) throw new Error(`Extend stitch: the ${which} has no video stream`)
  return { width: probe.width, height: probe.height }
}

const evenDown = (n: number): number => n - (n % 2)
const hasOddSide = ({ width, height }: Size): boolean => width % 2 !== 0 || height % 2 !== 0

/**
 * The size the stitch delivers, decided here and nowhere else: the source's
 * picture as the graph receives it (`shape`: upright, at its SAR), rounded
 * down to even, as H.264 4:2:0 needs (853×480 → 852×480, 853×481 → 852×480).
 * Its last column and/or row are cropped (`evenCrop`), its SAR kept; an
 * even-size source is delivered at its own size. The extension is covered and
 * cropped to it (`fitTo`), and the bitrate floor counts its pixels.
 */
export function deliveredShape<S extends Size>(shape: S): S {
  return hasOddSide(shape) ? { ...shape, width: evenDown(shape.width), height: evenDown(shape.height) } : shape
}

/** An odd-size source's picture cropped to `deliveredShape` from its top left: nothing for an even one. */
function evenCrop(shape: PictureShape): string[] {
  if (!hasOddSide(shape)) return []
  const { width, height } = deliveredShape(shape)
  return [`crop=${width}:${height}:0:0`]
}

/**
 * `evenCrop` for a picture whose sides the filter reads for itself (`iw`,
 * `ih`): the tail's `-vf`, which sees the source upright whichever way it is
 * rotated, while its probe reads the stored size.
 */
const EVEN_CROP_OF_ANY = "crop=trunc(iw/2)*2:trunc(ih/2)*2:0:0"

/** Frames [start, end) of a picture, its timestamps from zero. */
const frameSpan = (start: number, end: number): string =>
  `trim=${start > 0 ? `start_frame=${start}:` : ""}end_frame=${end},setpts=PTS-STARTPTS`

/** `fps` to the output rate, the last frame cloned without limit (as Apply EDL's grid hold): the span that follows ends it. */
const conformTo = (rate: StitchRate): string => `fps=${rate.spelling},tpad=stop_mode=clone:stop=-1`

/** The transfers that make a source HDR, whatever its primaries: PQ (HDR10) and HLG. */
const HDR_TRANSFERS = new Set(["smpte2084", "arib-std-b67"])

/** Whether `source` is HDR: delivered in SDR (`toSdr`, `deliveryPicture`). */
export const isHdr = (source: MatchedProbe): boolean => HDR_TRANSFERS.has(source.colorTransfer ?? "")

/** A colour tag the probe really read: not absent, "unknown" or "reserved". */
const readTag = (tag: string | undefined): string | undefined => (tag && tag !== "unknown" && tag !== "reserved" ? tag : undefined)

/** A full-range picture: one reporting `pc`, or a yuvj one, whose format says so. */
const isFullRange = (source: MatchedProbe): boolean => readTag(source.colorRange) === "pc" || Boolean(source.pixFmt?.startsWith("yuvj"))

/**
 * An HDR source's picture taken to SDR BT.709 4:2:0, limited range, the
 * extension's own (every extend model generates SDR): nothing for any other source.
 * Its frames are first tagged as the probe reads the file (BT.2020 primaries
 * and matrix, and limited range, where it reads none), so zscale converts
 * from what the file says whatever the decoder set; then linear light at a
 * 100-nit reference, BT.709 primaries, the Hable curve, and BT.709 again,
 * error-diffusion dithered on that step from float down to 8 bits so smooth
 * gradients (a sky) do not band.
 */
function toSdr(source: MatchedProbe): string[] {
  if (!isHdr(source)) return []
  const primaries = readTag(source.colorPrimaries) ?? "bt2020"
  const matrix = readTag(source.colorSpace) ?? "bt2020nc"
  const range = isFullRange(source) ? "pc" : "tv"
  return [
    `setparams=color_primaries=${primaries}:color_trc=${source.colorTransfer}:colorspace=${matrix}:range=${range}`,
    "zscale=t=linear:npl=100",
    "format=gbrpf32le",
    "zscale=p=bt709",
    "tonemap=tonemap=hable:desat=0",
    "zscale=t=bt709:m=bt709:r=tv:d=error_diffusion",
    `format=${DELIVERY_PIX_FMT}`,
  ]
}

/**
 * A full-range SDR source's picture taken to limited range, 4:2:0, the
 * extension's own: nothing for any other source. Its frames are first tagged
 * full range, as the probe reads the file, so the levels are converted from
 * what the file says whatever the decoder set.
 */
function toLimited(source: MatchedProbe): string[] {
  if (isHdr(source) || !isFullRange(source)) return []
  return ["setparams=range=pc", "scale=out_range=tv", `format=${DELIVERY_PIX_FMT}`]
}

/**
 * The source's picture as the stitch delivers it: an HDR source's in SDR
 * (`toSdr`), a full-range one's in limited range (`toLimited`), any other
 * source's as it is (no filter).
 */
const deliveredChain = (source: MatchedProbe): string[] => (isHdr(source) ? toSdr(source) : toLimited(source))

/**
 * `deliveredChain` as one filter (`-vf`): what the source's picture goes
 * through wherever the extend reads it, so the extend's tail
 * (`extendTailPicture`) is the very picture the stitch delivers. An odd-size
 * source (its probe's stored size) is first rounded down to even
 * (`deliveredShape`, read from the sides the filter is given). Undefined for a
 * source delivered as it is.
 */
export function deliveredPictureFilter(source: MatchedProbe): string | undefined {
  const odd = hasOddSide({ width: source.width ?? 0, height: source.height ?? 0 })
  const chain = [...(odd ? [EVEN_CROP_OF_ANY] : []), ...deliveredChain(source)]
  return chain.length > 0 ? chain.join(",") : undefined
}

/**
 * The source's picture over frames [start, end), conformed to the output rate
 * (its own), at the delivered size (`evenCrop` of `shape`, the picture as the
 * graph receives it), as the stitch delivers it (`deliveredChain`): the encode
 * and the boundary proxy read it alike. The crop comes before the colour
 * conversion, whose 4:2:0 then sees even sides.
 */
export function sourcePicture(source: MatchedProbe, shape: PictureShape, rate: StitchRate, start: number, end: number): string {
  return [conformTo(rate), frameSpan(start, end), ...evenCrop(shape), ...deliveredChain(source)].join(",")
}

/**
 * Cover the delivered picture (`deliveredShape`) and centre-crop to it. Square
 * pixels: at its size. Non-square: at its displayed width (its width at its
 * SAR), then stored at its size and SAR, so the result keeps the source's
 * size (rounded down to even) and shape.
 */
function fitTo(shape: PictureShape): string[] {
  const { width: w, height: h, sarRatio } = deliveredShape(shape)
  if (!sarRatio) return [`scale=${w}:${h}:force_original_aspect_ratio=increase`, `crop=${w}:${h}`, "setsar=1"]
  const [num, den] = sarRatio.split("/").map(Number)
  const shown = Math.round((w * num!) / den!)
  return [`scale=${shown}:${h}:force_original_aspect_ratio=increase`, `crop=${shown}:${h}`, `scale=${w}:${h}`, `setsar=${sarRatio}`]
}

/** The extension's picture over frames [start, end) at the output rate, fitted to the source's delivered picture. */
export function extensionPicture(rate: StitchRate, shape: PictureShape, start: number, end: number): string {
  return [conformTo(rate), frameSpan(start, end), ...fitTo(shape)].join(",")
}

/**
 * A sound lined up with its own picture's start: silence ahead of it when it
 * starts `offsetSec` after the picture, its head before the picture dropped
 * when it starts before it; nothing when they start together (to the sample).
 */
function lineUp(offsetSec: number | undefined, sampleRate: number): string[] {
  const shift = Math.round((offsetSec ?? 0) * sampleRate)
  if (shift > 0) return [`adelay=${shift}S:all=1`]
  if (shift < 0) return [`atrim=start_sample=${-shift}`, "asetpts=PTS-STARTPTS"]
  return []
}

/**
 * The sound: each side lined up with its own picture, then cut by sample
 * count (exact), the source's running the fade past its picture, the
 * extension's starting at its start trim; a side with no sound is silence.
 * The total is the picture's length.
 */
function soundGraph(p: ExtendStitchEncode, rate: StitchRate, kept: { source: number; extension: number }): string {
  const sampleRate = p.audioSampleRate ?? DEFAULT_SAMPLE_RATE
  const samples = (frames: number) => Math.round((frames / rate.fps) * sampleRate)
  const sourceSamples = samples(kept.source)
  const extensionSamples = samples(kept.extension)
  const fade = Math.max(0, Math.min(Math.round(p.audioFadeSec * sampleRate), extensionSamples))
  const shape = `aresample=${sampleRate},aformat=channel_layouts=stereo`
  const silence = `anullsrc=r=${sampleRate}:cl=stereo`
  const source = p.sourceHasAudio
    ? [`[0:a:0]${shape}`, ...lineUp(p.soundOffsetSec?.source, sampleRate), "apad"].join(",")
    : silence
  const extension = p.extensionHasAudio
    ? [
      `[1:a:0]${shape}`, ...lineUp(p.soundOffsetSec?.extension, sampleRate),
      `atrim=start_sample=${samples(p.trimStartFrames)}`, "asetpts=PTS-STARTPTS", "apad",
    ].join(",")
    : silence
  return [
    `${source},atrim=end_sample=${sourceSamples + fade}[sa]`,
    `${extension},atrim=end_sample=${extensionSamples}[ea]`,
    fade > 0 ? `[sa][ea]acrossfade=ns=${fade}:c1=${EQUAL_POWER}:c2=${EQUAL_POWER}[a]` : "[sa][ea]concat=n=2:v=0:a=1[a]",
  ].join(";")
}

/** The sound's codec: AAC at the source's bitrate (capped), a PCM source's (a chained raw MOV) too. */
function soundCodecArgs(source: MatchedProbe): string[] {
  return ["-c:a", "aac", "-b:a", String(Math.min(Math.round(source.audioBitRate ?? DEFAULT_AUDIO_BIT_RATE), AAC_MAX_BIT_RATE))]
}

/** An HDR source's delivered colour: SDR BT.709, limited range, as `toSdr` makes its picture. */
const SDR_TAGS = { colorPrimaries: "bt709", colorTransfer: "bt709", colorSpace: "bt709", colorRange: "tv" } as const

/** The one codec whose bitrate is the delivery's own measure of quality: the delivery is H.264 too. */
const BITRATE_MATCHED_CODEC = "h264"

/**
 * The floor under an H.264 source's matched bitrate, in bits per pixel per
 * frame at the output's size and rate: about what a CRF 18 encode spends on
 * moving footage (1080p at 30 fps: 6.2 Mb/s). A source below it (a
 * near-static clip, a heavily compressed upload) is encoded at the floor, so
 * the generated extension after it is not starved of bits (ruling AI,
 * decided 2026-11-12). A source above it keeps its own rate.
 */
const MIN_BITS_PER_PIXEL_PER_FRAME = 0.1

/**
 * The bitrate an H.264 source is encoded at: its own, at least the floor
 * (`MIN_BITS_PER_PIXEL_PER_FRAME` at the delivered size, `deliveredShape`,
 * and the output rate, `stitchRate`).
 */
function flooredBitRate(source: MatchedProbe, own: number, delivered: Size): number {
  const pixels = delivered.width * delivered.height
  return Math.max(own, Math.round(pixels * stitchRate(source).fps * MIN_BITS_PER_PIXEL_PER_FRAME))
}

/**
 * The source as the delivered picture is encoded from it: at its colour tags,
 * in `DELIVERY_PIX_FMT` whatever its own (4:2:2, 4:4:4, 10-bit, yuvj). The
 * shared matched rule, which keeps 4:4:4, stays the reference re-encode's
 * (`reference-video-reencode.ts`).
 *
 * Its quality: an H.264 source is encoded at its own bitrate (in two passes),
 * raised to a floor when it is lower (`flooredBitRate`). Any other codec (HEVC, VP9, AV1, ProRes, or one the probe does not name)
 * is encoded at the near-lossless constant quality (`MATCHED_FALLBACK_CRF`,
 * one pass), as is an H.264 source that reports no bitrate: another codec's
 * bitrate does not carry its quality over to H.264 (HEVC, VP9 and AV1 hold
 * the same picture in fewer bits, an intra codec in far more).
 *
 * Its range: a full-range source (`isFullRange`) is delivered limited range
 * (`tv`). A full-range H.264 result probes as yuvj420p, which `needsTranscode`
 * would send through a second encode at a fixed quality. Its picture reaches
 * the encoder already limited range (`toLimited`, 0–255 to 16–235), so the
 * `tv` asked for here converts nothing more: the levels are converted once.
 * Any other range is the one the source reports, and none when it reports
 * none.
 *
 * An HDR source's picture reaches the encoder in SDR BT.709, limited range
 * (`toSdr`), and is tagged so (`SDR_TAGS`).
 *
 * `delivered`: the delivered size (`deliveredShape`), the floor's pixel count.
 */
function deliveryPicture(source: MatchedProbe, delivered: Size): MatchedProbe {
  const { videoBitRate, ...rest } = source
  const quality = videoBitRate !== undefined && source.videoCodec === BITRATE_MATCHED_CODEC
    ? { videoBitRate: flooredBitRate(source, videoBitRate, delivered) }
    : {}
  if (isHdr(source)) return { ...rest, ...quality, pixFmt: DELIVERY_PIX_FMT, ...SDR_TAGS }
  const reported = source.colorRange && source.colorRange !== "unknown" ? source.colorRange : undefined
  const colorRange = isFullRange(source) ? "tv" : reported
  return { ...rest, ...quality, pixFmt: DELIVERY_PIX_FMT, ...(colorRange ? { colorRange } : {}) }
}

/**
 * Whether the stitch encodes `source` at a bitrate, and so in two passes,
 * rather than at the constant quality (one pass): the rule `extendStitchArgs`
 * follows (`deliveryPicture`).
 */
export function stitchEncodesAtBitRate(source: MatchedProbe): boolean {
  return matchedHasBitRate(deliveryPicture(source, deliveredShape({ width: source.width ?? 0, height: source.height ?? 0 })))
}

/**
 * The ffmpeg arguments of one stitch encode (pure). Pass 1 runs the picture
 * graph alone and writes nothing; pass 2, or the single constant-quality pass,
 * writes `outputPath`. Both passes build the picture graph the same way.
 */
export function extendStitchArgs(p: ExtendStitchEncode): string[] {
  const rate = stitchRate(p.source)
  const shape = p.picture ?? pictureSize(p.source, "source")
  const kept = { source: p.sourceFrames - p.trimEndFrames, extension: p.extensionFrames - p.trimStartFrames }
  const picture = [
    `[0:v:0]${sourcePicture(p.source, shape, rate, 0, kept.source)}[sv]`,
    `[1:v:0]${extensionPicture(rate, shape, p.trimStartFrames, p.extensionFrames)}[ev]`,
    "[sv][ev]concat=n=2:v=1:a=0[v]",
  ].join(";")
  const inputs = ["-y", "-i", p.sourcePath, "-i", p.extensionPath]
  const encode = matchedPictureArgs(deliveryPicture(p.source, deliveredShape(shape)), { pass: p.pass })
  if (p.pass?.n === 1) return [...inputs, "-filter_complex", picture, "-map", "[v]", "-an", ...encode, "-f", "null", "-"]
  const sound = p.sourceHasAudio || p.extensionHasAudio
  return [
    ...inputs,
    "-filter_complex", sound ? `${picture};${soundGraph(p, rate, kept)}` : picture,
    "-map", "[v]",
    ...(sound ? ["-map", "[a]", ...soundCodecArgs(p.source)] : ["-an"]),
    ...encode,
    "-movflags", "+faststart",
    p.outputPath,
  ]
}

/** A boundary proxy's encode: the shape combineVideos gives the matcher (H.264 4:2:0 at CRF 18), picture only. */
export function stitchProxyArgs(input: string, picture: string, output: string): string[] {
  return [
    "-y", "-i", input, "-map", "0:v:0", "-vf", picture, "-an", "-fps_mode", "passthrough",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "fast", "-crf", COMBINE_DELIVERY_CRF,
    output,
  ]
}
