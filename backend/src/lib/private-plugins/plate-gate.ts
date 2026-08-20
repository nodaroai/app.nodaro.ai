/**
 * Identity-plate gate (gvp stage 3, 2026-08-02).
 *
 * The gvp engine rides a Topaz-2x'd copy of a boundary anchor frame as an
 * extra "person identity" reference. That plate is only safe when it is the
 * EXACT same frame at higher quality — a provider that crops, pads, shifts,
 * or snaps to a resolution box would feed the model contradictory
 * conditioning (user requirement, 2026-08-02: "exact the same frame, just
 * with better quality"). This module is the guarantee:
 *
 *   1. dims:      result must be EXACTLY 2x the source width and height
 *                 (Topaz `topaz-image-upscale` is factor-based — see
 *                 providers/kie/models.ts `upscale_factor: "2"`).
 *   2. alignment: the result downscaled back to source size must match the
 *                 source at >= PLATE_ALIGN_MIN_PSNR_DB — a real 2x upscale
 *                 round-trips comfortably above the floor, while any crop or
 *                 shift collapses well below it.
 *
 * Pure buffer-in verification — the toolkit wrapper owns fetching/hosting.
 */
import sharp from "sharp"

/** Alignment floor, calibrated from both sides: real Topaz plates measure
 *  40-44 dB (2026-08-02 probes, 6/6), a lanczos round trip on harsh synthetic
 *  edges ~34, while any actual crop/stretch/shift collapses below ~25. 30 dB
 *  keeps ≥10 dB of margin to real plates and a clear gap to every failure
 *  mode the gate exists to catch. */
export const PLATE_ALIGN_MIN_PSNR_DB = 30

export interface PlateGateResult {
  width: number
  height: number
  /** Detected source format of the verified plate bytes ("png", "jpeg", …). */
  format: string
  alignPsnrDb: number
}

export async function assertExact2xAligned(src: Buffer, ups: Buffer): Promise<PlateGateResult> {
  const sMeta = await sharp(src).metadata()
  const uMeta = await sharp(ups).metadata()
  if (!sMeta.width || !sMeta.height || !uMeta.width || !uMeta.height) {
    throw new Error("plate gate: could not read image dimensions")
  }
  if (uMeta.width !== sMeta.width * 2 || uMeta.height !== sMeta.height * 2) {
    throw new Error(
      `plate gate: not an exact 2x upscale (${sMeta.width}x${sMeta.height} -> ${uMeta.width}x${uMeta.height})`,
    )
  }
  const w = sMeta.width
  const h = sMeta.height
  const a = await sharp(src).removeAlpha().raw().toBuffer()
  const b = await sharp(ups).resize(w, h, { kernel: "lanczos3" }).removeAlpha().raw().toBuffer()
  if (a.length !== b.length) throw new Error("plate gate: raw buffer size mismatch")
  let se = 0
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i]
    se += d * d
  }
  const mse = se / a.length
  const alignPsnrDb = mse === 0 ? 99 : 10 * Math.log10((255 * 255) / mse)
  if (alignPsnrDb < PLATE_ALIGN_MIN_PSNR_DB) {
    throw new Error(
      `plate gate: misaligned upscale (PSNR ${alignPsnrDb.toFixed(1)} dB < ${PLATE_ALIGN_MIN_PSNR_DB} dB floor — not the same frame)`,
    )
  }
  return { width: uMeta.width, height: uMeta.height, format: uMeta.format ?? "png", alignPsnrDb }
}

/** Fetch a hosted image into a Buffer (plate-gate companion — kept here so the
 *  toolkit wrapper stays a thin composition). */
export async function fetchImageBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`plate gate: fetch ${res.status} for ${url}`)
  return Buffer.from(await res.arrayBuffer())
}
