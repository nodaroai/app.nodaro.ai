/**
 * Where the landmark model looks, and how its answer maps back — pure.
 *
 * A face found by YuNet (a box and five landmarks, fractions of the frame) is
 * cropped SQUARE around its box's centre, `FACE_MESH_ROI_SCALE` times the
 * box's longer side, and turned so the eye line is level (the crop's x axis
 * runs from the person's right eye — on the image's left when they face the
 * camera — to their left eye). That is the region of interest MediaPipe's own
 * face pipeline gives its landmark model. The crop is sampled bilinearly into
 * the model's 256 × 256 RGB input (`FACE_MESH_INPUT_SIZE`; outside the frame
 * reads black), and the first 468 of the 478 points the model answers in crop
 * pixels (the face; the irises are not drawn) map back through the same turn.
 */
import type { YunetFace } from "../face-detect/yunet-decode.js"
import { FACE_MESH_INPUT_SIZE, FACE_MESH_MODEL_POINTS, FACE_MESH_POINTS } from "./face-mesh-model.js"

/** The crop's side over the face box's longer side. */
export const FACE_MESH_ROI_SCALE = 1.5

/** The crop: its centre and side in pixels of the frame, its turn in radians. */
export interface FaceRoi {
  readonly cx: number
  readonly cy: number
  readonly size: number
  /** The eye line's angle in the frame (0 = level); the crop is turned by it. */
  readonly angle: number
}

/** The crop around a YuNet face (fractions of a `width × height` frame). */
export function roiOfFace(face: Pick<YunetFace, "x" | "y" | "w" | "h" | "landmarks">, width: number, height: number): FaceRoi {
  const bw = face.w * width
  const bh = face.h * height
  const cx = face.x * width + bw / 2
  const cy = face.y * height + bh / 2
  const right = face.landmarks[0]
  const left = face.landmarks[1]
  const angle = right && left ? Math.atan2((left[1] - right[1]) * height, (left[0] - right[0]) * width) : 0
  return { cx, cy, size: Math.max(bw, bh) * FACE_MESH_ROI_SCALE, angle }
}

/** A point of the crop (pixels of the `n × n` input, continuous) in pixels of the frame. */
export function cropToFrame(roi: FaceRoi, u: number, v: number, n = FACE_MESH_INPUT_SIZE): readonly [number, number] {
  const lx = (u / n - 0.5) * roi.size
  const ly = (v / n - 0.5) * roi.size
  const c = Math.cos(roi.angle)
  const s = Math.sin(roi.angle)
  return [roi.cx + c * lx - s * ly, roi.cy + s * lx + c * ly]
}

/**
 * Sample the crop of a packed BGR `width × height` frame into the model's
 * input `out` (NHWC, `n × n × 3`, RGB, each channel / 255): bilinear, a
 * sample outside the frame black. Each output pixel is read at its centre.
 */
export function fillFaceMeshInput(
  bgr: Uint8Array,
  width: number,
  height: number,
  roi: FaceRoi,
  out: Float32Array,
  n = FACE_MESH_INPUT_SIZE,
): void {
  if (bgr.length !== width * height * 3) {
    throw new Error(`face mesh: a ${bgr.length}-byte buffer is not one ${width}×${height} BGR frame`)
  }
  if (out.length !== n * n * 3) throw new Error(`face mesh: the input holds ${out.length} values, not ${n * n * 3}`)
  const c = Math.cos(roi.angle)
  const s = Math.sin(roi.angle)
  const step = roi.size / n
  // Frame position of the crop's pixel (0, 0) centre, and the steps along a row and down a column.
  const half = (0.5 / n - 0.5) * roi.size
  const x0 = roi.cx + c * half - s * half
  const y0 = roi.cy + s * half + c * half
  const k = 1 / 255
  // A pixel's value sits at its integer index; a sample at (fx, fy) is between the four around it.
  const px = (xi: number, yi: number, ch: number): number =>
    xi < 0 || yi < 0 || xi >= width || yi >= height ? 0 : bgr[(yi * width + xi) * 3 + ch]!
  let o = 0
  for (let v = 0; v < n; v++) {
    let fx = x0 - s * step * v
    let fy = y0 + c * step * v
    for (let u = 0; u < n; u++, fx += c * step, fy += s * step) {
      // Pixel centres at +0.5: the sample's position in index space.
      const sx = fx - 0.5
      const sy = fy - 0.5
      const xi = Math.floor(sx)
      const yi = Math.floor(sy)
      const ax = sx - xi
      const ay = sy - yi
      for (let ch = 0; ch < 3; ch++) {
        // BGR in, RGB out: output channel ch reads input channel 2 - ch.
        const src = 2 - ch
        const top = px(xi, yi, src) * (1 - ax) + px(xi + 1, yi, src) * ax
        const bottom = px(xi, yi + 1, src) * (1 - ax) + px(xi + 1, yi + 1, src) * ax
        out[o++] = (top * (1 - ay) + bottom * ay) * k
      }
    }
  }
}

/**
 * The face's 468 points of the model's 478 (x, y in pixels of the `n × n`
 * crop; z ignored) as fractions of a `width × height` frame, interleaved
 * `[x0, y0, x1, y1, …]`: the first 468 (x, y, z) triples are read, the
 * irises after them (468–477) never.
 */
export function landmarksToFrame(
  landmarks: ArrayLike<number>,
  roi: FaceRoi,
  width: number,
  height: number,
  n = FACE_MESH_INPUT_SIZE,
): Float64Array {
  if (landmarks.length !== FACE_MESH_MODEL_POINTS * 3) {
    throw new Error(`face mesh: ${landmarks.length} landmark values are not the model's ${FACE_MESH_MODEL_POINTS} × 3`)
  }
  const out = new Float64Array(FACE_MESH_POINTS * 2)
  for (let i = 0; i < FACE_MESH_POINTS; i++) {
    const [x, y] = cropToFrame(roi, landmarks[3 * i]!, landmarks[3 * i + 1]!, n)
    out[2 * i] = x / width
    out[2 * i + 1] = y / height
  }
  return out
}

/**
 * The depths of the face's 468 points (the model's z, in pixels of the crop)
 * in pixels of the frame, `[z0, z1, …]`: scaled as `landmarksToFrame` scales
 * x and y (the crop's side over the model's), so a depth and a distance
 * across the frame are in the same units. Smaller is nearer the camera (the
 * model's own convention: the nose tip is the least). A turn of the crop
 * (`roi.angle`) is about the camera's axis, so it leaves z as it is.
 */
export function landmarkDepths(landmarks: ArrayLike<number>, roi: FaceRoi, n = FACE_MESH_INPUT_SIZE): Float64Array {
  if (landmarks.length !== FACE_MESH_MODEL_POINTS * 3) {
    throw new Error(`face mesh: ${landmarks.length} landmark values are not the model's ${FACE_MESH_MODEL_POINTS} × 3`)
  }
  const k = roi.size / n
  const out = new Float64Array(FACE_MESH_POINTS)
  for (let i = 0; i < FACE_MESH_POINTS; i++) out[i] = landmarks[3 * i + 2]! * k
  return out
}

/** The logistic function: the presence logit as a probability. */
export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x))
}

/** A face's presence under this probability draws nothing for it in that frame. */
export const FACE_MESH_MIN_PRESENCE = 0.5
