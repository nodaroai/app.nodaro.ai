/**
 * YuNet's input layout, output decode and NMS — pure, no onnxruntime.
 *
 * This is the decode the P3.0b holdout measured (its onnxruntime-node probe,
 * 2026-10-06), which reproduced OpenCV's `FaceDetectorYN` to 1e-5 of the frame
 * over 33,730 detections. It is not ours to tune: the threshold is the
 * caller's (`minScore`), and everything else here is the model's own geometry.
 *
 * INPUT. The frame is zero-padded on the right and bottom to a multiple of 32
 * (as `FaceDetectorYN` does) and run at that native size — never resized to
 * the upstream graph's 640×640, which would be a different, unmeasured
 * detector (`model/README.md`). Planar BGR, unnormalized 0..255.
 *
 * OUTPUT. For each stride s ∈ {8, 16, 32} the head scores every anchor cell
 * (row r, col c) of the padded input: `cls` and `obj` (clamped to [0, 1];
 * score = √(cls × obj)), a box (centre `(c + dx, r + dy) × s`, size
 * `exp(lw, lh) × s`) and five landmarks (`(c + kx, r + ky) × s`).
 *
 * NMS. Greedy, highest score first, dropping any box whose IoU with a kept one
 * exceeds 0.3. Filtering at `minScore` first gives the same faces as NMS over
 * a lower floor followed by the filter: a lower-scored box never suppresses a
 * higher-scored one.
 *
 * Boxes come back TOP-LEFT (`x`, `y`, `w`, `h`), as fractions of the unpadded
 * display frame — the `SpeakerTrackBox` convention. They are not clipped: a
 * face at the edge may extend past it (`normalizeSpeakerTracks` crops).
 */

/** The head's strides. */
export const YUNET_STRIDES = [8, 16, 32] as const
/** The probe's NMS overlap: a box overlapping a kept one past this is dropped. */
export const YUNET_NMS_IOU = 0.3

export type YunetOutputName = `${"cls" | "obj" | "bbox" | "kps"}_${(typeof YUNET_STRIDES)[number]}`
/** The model's twelve outputs, flattened (as onnxruntime returns them). */
export type YunetOutputs = Readonly<Record<YunetOutputName, ArrayLike<number>>>

export interface YunetFace {
  /** Top-left corner and size, fractions of the display frame. */
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly score: number
  /** Right eye, left eye, nose tip, right and left mouth corners (the model's
   *  order), as [x, y] fractions of the display frame. */
  readonly landmarks: ReadonlyArray<readonly [number, number]>
}

/** The padded input size for a `width × height` frame. */
export function paddedSize(width: number, height: number): { pw: number; ph: number } {
  return { pw: Math.ceil(width / 32) * 32, ph: Math.ceil(height / 32) * 32 }
}

/**
 * Write one `width × height` packed BGR frame into the planar input tensor
 * `out` (3 × ph × pw). Only the picture is written: the padding stays as it
 * is, so `out` must be zeroed once and then only ever reused for frames of the
 * same size (the caller allocates it per window).
 */
export function fillYunetInput(bgr: Uint8Array, width: number, height: number, pw: number, ph: number, out: Float32Array): void {
  if (bgr.length !== width * height * 3) {
    throw new Error(`face detect: a ${bgr.length}-byte buffer is not one ${width}×${height} BGR frame`)
  }
  const plane = pw * ph
  for (let y = 0; y < height; y++) {
    let src = y * width * 3
    let dst = y * pw
    for (let x = 0; x < width; x++, src += 3, dst++) {
      out[dst] = bgr[src]!
      out[plane + dst] = bgr[src + 1]!
      out[2 * plane + dst] = bgr[src + 2]!
    }
  }
}

interface Candidate {
  /** Pixel box: left, top, width, height. */
  readonly b: readonly [number, number, number, number]
  readonly s: number
  readonly kps: readonly number[]
}

function iou(a: readonly number[], b: readonly number[]): number {
  const x0 = Math.max(a[0]!, b[0]!), y0 = Math.max(a[1]!, b[1]!)
  const x1 = Math.min(a[0]! + a[2]!, b[0]! + b[2]!), y1 = Math.min(a[1]! + a[3]!, b[1]! + b[3]!)
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0)
  const union = a[2]! * a[3]! + b[2]! * b[3]! - inter
  return union > 0 ? inter / union : 0
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** Decode the model's outputs into faces at or above `minScore`, after NMS. */
export function decodeYunet(
  outputs: YunetOutputs,
  opts: { pw: number; ph: number; width: number; height: number; minScore: number },
): YunetFace[] {
  const { pw, width, height, minScore } = opts
  const candidates: Candidate[] = []
  for (const st of YUNET_STRIDES) {
    const cols = pw / st
    const cls = outputs[`cls_${st}`], obj = outputs[`obj_${st}`]
    const bb = outputs[`bbox_${st}`], kp = outputs[`kps_${st}`]
    for (let i = 0; i < cls.length; i++) {
      const s = Math.sqrt(clamp01(cls[i]!) * clamp01(obj[i]!))
      if (s < minScore) continue
      const r = Math.floor(i / cols), c = i % cols
      const cx = (c + bb[4 * i]!) * st, cy = (r + bb[4 * i + 1]!) * st
      const bw = Math.exp(bb[4 * i + 2]!) * st, bh = Math.exp(bb[4 * i + 3]!) * st
      const kps: number[] = []
      for (let n = 0; n < 5; n++) kps.push((c + kp[10 * i + 2 * n]!) * st, (r + kp[10 * i + 2 * n + 1]!) * st)
      candidates.push({ b: [cx - bw / 2, cy - bh / 2, bw, bh], s, kps })
    }
  }
  // Stable: equal scores keep stride-then-anchor order, as the probe did.
  candidates.sort((a, b) => b.s - a.s)
  const kept: Candidate[] = []
  for (const cand of candidates) if (kept.every((k) => iou(k.b, cand.b) <= YUNET_NMS_IOU)) kept.push(cand)
  return kept.map(({ b, s, kps }) => ({
    x: b[0] / width,
    y: b[1] / height,
    w: b[2] / width,
    h: b[3] / height,
    score: s,
    landmarks: [0, 1, 2, 3, 4].map((n) => [kps[2 * n]! / width, kps[2 * n + 1]! / height] as const),
  }))
}

/**
 * A tiny RGB picture of a packed BGR frame: `tw × th` cells, each the mean of
 * the pixels it covers (cell bounds rounded down). Structural only — the
 * camera-setup signature P3-30 (b) groups shots by; whatever masking or
 * comparison it needs is the caller's.
 */
export function rgbThumb(bgr: Uint8Array, width: number, height: number, tw: number, th: number): Uint8Array {
  const out = new Uint8Array(tw * th * 3)
  for (let ty = 0; ty < th; ty++) {
    const y0 = Math.floor((ty * height) / th), y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * height) / th))
    for (let tx = 0; tx < tw; tx++) {
      const x0 = Math.floor((tx * width) / tw), x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * width) / tw))
      let b = 0, g = 0, r = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0, o = (y * width + x0) * 3; x < x1; x++, o += 3) {
          b += bgr[o]!
          g += bgr[o + 1]!
          r += bgr[o + 2]!
        }
      }
      const n = (y1 - y0) * (x1 - x0)
      const at = (ty * tw + tx) * 3
      out[at] = Math.round(r / n)
      out[at + 1] = Math.round(g / n)
      out[at + 2] = Math.round(b / n)
    }
  }
  return out
}
