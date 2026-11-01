/**
 * FACE DETECTION ON ONE STILL PICTURE — lent to plugins as
 * `tk.media.detectFacesInImage`, beside `detectFaces` (a detection proxy's
 * window). Additive-optional in the contract, with no capability flag: a
 * plugin feature-detects the member.
 *
 * The same detector as `detectFaces`: the pinned YuNet model and the process's
 * one session (`yunet-session.ts`), the same input fill and decode
 * (`yunet-decode.ts`), on a single frame. What differs is the source:
 *   - the address is an https picture anywhere, so it is downloaded through
 *     the guarded public fetch (`safeFetchBytes`: SSRF checks on every hop,
 *     a decoded-byte cap), never read directly;
 *   - sharp decodes it in process (no ffmpeg child) and turns it upright by
 *     its EXIF orientation BEFORE detection, then brings it within
 *     `FACE_DETECT_IMAGE_MAX_SIDE` (never enlarged). Fractions do not change
 *     with scale, so `frame` is the UPRIGHT picture's own size and the boxes
 *     and landmarks are fractions of it.
 *   - the decode and the inference run inside ONE `withFfmpegSlot` hold, as a
 *     detection window's do, reserving the session's working set plus sharp's.
 *
 * Refusals come before any download or reservation where they can: a malformed
 * request (not https, a score floor outside (0, 1]) and a host that cannot
 * detect (no model, no native binary) are deterministic. A file that is not a
 * raster picture, or is past the caps, is refused deterministically after the
 * download, before the hold.
 */
import sharp from "sharp"
import { withFfmpegSlot } from "../../providers/video/ffmpeg-utils.js"
import { PublicDownloadTooLargeError, safeFetchBytes } from "../../lib/safe-fetch-bytes.js"
import { FaceDetectRequestError } from "./detect-faces.js"
import { FACE_DETECT_SESSION_PEAK_MIB_PER_THREAD, faceDetectTimeoutMs } from "./face-detect-budget.js"
import { decodeYunet, fillYunetInput, paddedSize, type YunetFace } from "./yunet-decode.js"
import { yunetSession } from "./yunet-session.js"

/** The largest download, bytes: the guarded fetch's own ceiling for a picture. */
export const FACE_DETECT_IMAGE_MAX_BYTES = 25 * 1024 * 1024

/**
 * The largest picture sharp will decode, pixels (its `limitInputPixels`): a
 * 48 MP camera's photo fits, a decompression bomb does not.
 */
export const FACE_DETECT_IMAGE_MAX_PIXELS = 50_000_000

/**
 * The detection picture's longer side, px: the detection proxy's width, so a
 * still is detected at about the size every detection figure was measured at
 * (a 960 × 540 proxy frame). A smaller picture is never enlarged.
 */
export const FACE_DETECT_IMAGE_MAX_SIDE = 960

/** sharp's fixed working set while it decodes, turns and resizes, MiB. */
export const FACE_DETECT_IMAGE_SHARP_BASE_MIB = 64

/** The raster formats taken. Never a vector or document format (svg, pdf). */
const PICTURE_FORMATS: ReadonlySet<string> = new Set(["jpeg", "png", "webp", "gif", "avif", "heif", "tiff"])

const MIB = 1024 * 1024

export interface DetectFacesInImageInput {
  /** An https picture. */
  readonly imageUrl: string
  /** Keep faces scoring at least this, in (0, 1]. */
  readonly minScore: number
}

export interface DetectFacesInImageResult {
  /** The detector, exactly as `detectFaces` reports it. */
  readonly detector: { readonly id: string; readonly version: string }
  /** The UPRIGHT picture's size (after its EXIF turn): what the fractions refer to. */
  readonly frame: { readonly w: number; readonly h: number }
  /** Highest score first. Top-left boxes and landmarks, fractions of `frame`. */
  readonly boxes: readonly YunetFace[]
}

/**
 * The hold's declared peak, MiB: the session's working set at the threads it
 * runs with, sharp's (the decoded picture as RGBA, twice: the turned copy),
 * and the detection input tensor.
 */
export function faceDetectImagePeakMemoryMiB(
  storedPixels: number,
  detect: { readonly width: number; readonly height: number },
  ortThreads: number,
): number {
  const { pw, ph } = paddedSize(detect.width, detect.height)
  const sharpMiB = FACE_DETECT_IMAGE_SHARP_BASE_MIB + Math.ceil((storedPixels * 4 * 2) / MIB)
  const inputMiB = Math.ceil((3 * pw * ph * 4) / MIB)
  return FACE_DETECT_SESSION_PEAK_MIB_PER_THREAD * Math.max(1, Math.ceil(ortThreads)) + sharpMiB + inputMiB
}

const round = (v: number, places: number) => Number(v.toFixed(places))

/** As `detectFaces` rounds: fractions to 6 places, scores to 4. */
function roundFace(f: YunetFace): YunetFace {
  return {
    x: round(f.x, 6),
    y: round(f.y, 6),
    w: round(f.w, 6),
    h: round(f.h, 6),
    score: round(f.score, 4),
    landmarks: f.landmarks.map(([lx, ly]) => [round(lx, 6), round(ly, 6)] as const),
  }
}

function validate(input: DetectFacesInImageInput): void {
  let protocol: string | undefined
  try {
    protocol = new URL(String(input?.imageUrl ?? "")).protocol
  } catch {
    protocol = undefined
  }
  if (protocol !== "https:") throw new FaceDetectRequestError("the picture's address is not an https URL")
  const { minScore } = input
  if (!(typeof minScore === "number" && minScore > 0 && minScore <= 1)) {
    throw new FaceDetectRequestError(`minScore ${String(minScore)} is not in (0, 1]`)
  }
}

async function download(url: string): Promise<Buffer> {
  try {
    return await safeFetchBytes(url, FACE_DETECT_IMAGE_MAX_BYTES)
  } catch (err) {
    if (err instanceof PublicDownloadTooLargeError) {
      throw new FaceDetectRequestError(`the picture is over the ${FACE_DETECT_IMAGE_MAX_BYTES}-byte cap`)
    }
    throw err
  }
}

/** The picture's stored size, format and upright size — the header only. */
async function readHeader(bytes: Buffer): Promise<{ storedPixels: number; upright: { w: number; h: number } }> {
  let meta: sharp.Metadata
  try {
    meta = await sharp(bytes, { limitInputPixels: FACE_DETECT_IMAGE_MAX_PIXELS }).metadata()
  } catch {
    throw new FaceDetectRequestError("the file is not a picture")
  }
  const { width, height, format, orientation } = meta
  if (!format || !PICTURE_FORMATS.has(format)) throw new FaceDetectRequestError(`a ${format ?? "file of no known"} format is not a picture taken here`)
  if (!(Number.isInteger(width) && Number.isInteger(height) && width! > 0 && height! > 0)) {
    throw new FaceDetectRequestError("the picture has no size")
  }
  if (width! * height! > FACE_DETECT_IMAGE_MAX_PIXELS) {
    throw new FaceDetectRequestError(`a ${width}×${height} picture is over the ${FACE_DETECT_IMAGE_MAX_PIXELS}-pixel cap`)
  }
  // EXIF orientations 5–8 turn the picture a quarter: its upright size is the stored one swapped.
  const quarter = typeof orientation === "number" && orientation >= 5 && orientation <= 8
  return { storedPixels: width! * height!, upright: quarter ? { w: height!, h: width! } : { w: width!, h: height! } }
}

/** The detection size: the upright picture within `FACE_DETECT_IMAGE_MAX_SIDE`, never enlarged. */
function detectionSize(upright: { w: number; h: number }): { width: number; height: number } {
  const scale = Math.min(1, FACE_DETECT_IMAGE_MAX_SIDE / Math.max(upright.w, upright.h))
  return { width: Math.max(1, Math.round(upright.w * scale)), height: Math.max(1, Math.round(upright.h * scale)) }
}

/** Decode upright at `size` as packed BGR (what YuNet was measured on: ffmpeg's `bgr24`). */
async function decodeUprightBgr(bytes: Buffer, size: { width: number; height: number }): Promise<Buffer> {
  let raw: { data: Buffer; info: sharp.OutputInfo }
  try {
    raw = await sharp(bytes, { limitInputPixels: FACE_DETECT_IMAGE_MAX_PIXELS })
      .rotate() // by the EXIF orientation, before anything else
      .resize({ width: size.width, height: size.height, fit: "fill" })
      .flatten({ background: { r: 0, g: 0, b: 0 } })
      .toColourspace("srgb")
      .raw({ depth: "uchar" })
      .toBuffer({ resolveWithObject: true })
  } catch {
    throw new FaceDetectRequestError("the picture could not be decoded")
  }
  const { data, info } = raw
  if (info.width !== size.width || info.height !== size.height || info.channels !== 3 || data.length !== size.width * size.height * 3) {
    throw new FaceDetectRequestError(`the picture decoded as ${info.width}×${info.height}×${info.channels}, not ${size.width}×${size.height} RGB`)
  }
  // sharp answers RGB; swap to BGR in place (the buffer is ours).
  for (let i = 0; i < data.length; i += 3) {
    const r = data[i]!
    data[i] = data[i + 2]!
    data[i + 2] = r
  }
  return data
}

/**
 * `tk.media.detectFacesInImage`: the faces in one https picture, at or above
 * `minScore`, as fractions of the upright picture.
 */
export async function detectFacesInImage(input: DetectFacesInImageInput): Promise<DetectFacesInImageResult> {
  validate(input)
  const { imageUrl, minScore } = input
  // Refuse before downloading: no model or no native module is a deterministic refusal.
  const session = await yunetSession()
  const bytes = await download(imageUrl)
  const { storedPixels, upright } = await readHeader(bytes)
  const size = detectionSize(upright)
  const { pw, ph } = paddedSize(size.width, size.height)
  const timeoutMs = faceDetectTimeoutMs(1)
  const peakMemoryMiB = faceDetectImagePeakMemoryMiB(storedPixels, size, session.intraOpThreads)

  const boxes = await withFfmpegSlot(async () => {
    const bgr = await decodeUprightBgr(bytes, size)
    const tensor = new Float32Array(3 * pw * ph)
    fillYunetInput(bgr, size.width, size.height, pw, ph, tensor)
    const outputs = await session.run(tensor, pw, ph)
    return decodeYunet(outputs, { pw, ph, width: size.width, height: size.height, minScore }).map(roundFace)
  }, { timeoutMs, peakMemoryMiB, label: "face-detect" })

  return { detector: session.detector, frame: upright, boxes }
}
