/**
 * The face photo a Face Swap run sends: a plain upright JPEG of a size the swap
 * model handles.
 *
 * The swap model failed on a large face photo (1536x2048, 4.5 MB PNG) while the
 * same face cropped to 1236x1236 and saved as JPEG swapped fine (2026-11-22).
 * So a face photo is sent as it is only when it already is a JPEG no longer
 * than {@link FACE_SWAP_FACE_MAX_SIDE} on its long side, with no transparency
 * and no rotation flag. Any other photo is redrawn once: turned upright (a
 * phone photo's rotation flag applied, so the face is not sideways), laid on
 * white where it is transparent, fitted inside the limit and saved as JPEG,
 * in the running job's scratch folder (emptied when the job ends).
 *
 * Best-effort: a photo that cannot be downloaded or read is sent as it is, as
 * every run did before, so this step never fails a run on its own.
 */
import sharp from "sharp"
import { fetchOwnMedia } from "./fetch-own-media.js"
import { uploadJobScratchBuffer } from "./job-scratch.js"

/** The longest side of the face photo sent to the swap model, in pixels. */
export const FACE_SWAP_FACE_MAX_SIDE = 1280

/** The largest face photo read, in bytes: a bigger one is sent as it is. */
export const FACE_SWAP_FACE_MAX_READ_BYTES = 40 * 1024 * 1024

const READ_TIMEOUT_MS = 30_000

/** Whether a face photo with this metadata can be sent as it is. */
export function faceImageFits(meta: sharp.Metadata): boolean {
  const longSide = Math.max(meta.width ?? 0, meta.height ?? 0)
  return (
    meta.format === "jpeg" &&
    longSide > 0 &&
    longSide <= FACE_SWAP_FACE_MAX_SIDE &&
    meta.hasAlpha !== true &&
    (meta.orientation === undefined || meta.orientation === 1)
  )
}

/** The photo redrawn as an upright JPEG within the limit, on white where it was transparent. */
export async function fitFaceImage(bytes: Buffer): Promise<Buffer> {
  return sharp(bytes)
    .rotate()
    .resize(FACE_SWAP_FACE_MAX_SIDE, FACE_SWAP_FACE_MAX_SIDE, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer()
}

async function readBounded(url: string): Promise<Buffer | undefined> {
  const res = await fetchOwnMedia(url, { timeoutMs: READ_TIMEOUT_MS })
  if (!res.ok || !res.body) {
    void res.body?.cancel().catch(() => {})
    return undefined
  }
  const declared = Number(res.headers.get("content-length") ?? "")
  if (Number.isFinite(declared) && declared > FACE_SWAP_FACE_MAX_READ_BYTES) {
    void res.body.cancel().catch(() => {})
    return undefined
  }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > FACE_SWAP_FACE_MAX_READ_BYTES) {
      await reader.cancel().catch(() => {})
      return undefined
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks, total)
}

/** The face photo's address to send: the photo itself, or its fitted JPEG in the job's scratch folder. */
export async function faceSwapFaceImage(url: string, jobId: string): Promise<string> {
  try {
    const bytes = await readBounded(url)
    if (!bytes) return url
    if (faceImageFits(await sharp(bytes).metadata())) return url
    const fitted = await fitFaceImage(bytes)
    return await uploadJobScratchBuffer(fitted, "face-swap-face", "jpg", "image/jpeg", jobId)
  } catch (err) {
    console.warn(
      `[worker] face-swap ${jobId}: could not fit the face photo, sending it as it is: ${err instanceof Error ? err.message : String(err)}`,
    )
    return url
  }
}
