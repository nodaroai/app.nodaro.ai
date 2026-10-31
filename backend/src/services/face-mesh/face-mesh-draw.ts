/**
 * The lines drawn on a frame — an SVG per frame, composited with sharp.
 *
 * Per face (its 468 points as fractions of the frame):
 *   - the tesselation: thin blue lines (`FACE_MESH_STYLE.mesh`), about 1 px
 *     per 100 px of the face's height, at 60 % opacity;
 *   - the lip outline, outer and inner: solid blue, twice as thick;
 *   - the eye outlines: solid green, as thick as the lips.
 * No brows or iris beyond what the tesselation draws. Each style is ONE
 * `<path>` (a stroke is painted once where its segments overlap, so the
 * mesh's shared edges never darken), and the SVG covers only the faces' box,
 * composited at its place — a frame with no face is passed through untouched.
 */
import sharp from "sharp"
import { FACEMESH_LEFT_EYE, FACEMESH_LIPS, FACEMESH_RIGHT_EYE, FACEMESH_TESSELATION } from "./face-mesh-topology.js"

export const FACE_MESH_STYLE = {
  mesh: { color: "#3D7BFF", opacity: 0.6 },
  lips: { color: "#3D7BFF", widthFactor: 2 },
  eyes: { color: "#2BD96B", widthFactor: 2 },
  /** Line width per pixel of face height (1 px per 100 px). */
  widthPerFacePx: 0.01,
  /** No line is thinner than this, px. */
  minWidth: 1,
} as const

/** Each undirected edge once (the tesselation lists the edge two triangles share twice). */
function uniqueEdges(flat: readonly number[]): Uint16Array {
  const seen = new Set<number>()
  const out: number[] = []
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const a = Math.min(flat[i]!, flat[i + 1]!)
    const b = Math.max(flat[i]!, flat[i + 1]!)
    const key = a * 1000 + b
    if (a === b || seen.has(key)) continue
    seen.add(key)
    out.push(a, b)
  }
  return Uint16Array.from(out)
}

const MESH_EDGES = uniqueEdges(FACEMESH_TESSELATION)
const LIP_EDGES = uniqueEdges(FACEMESH_LIPS)
const EYE_EDGES = uniqueEdges([...FACEMESH_LEFT_EYE, ...FACEMESH_RIGHT_EYE])

/** Where an SVG goes on the frame, and the SVG. */
export interface FaceMeshOverlay {
  readonly svg: string
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

const r1 = (v: number): string => (Math.round(v * 10) / 10).toString()

function pathOf(edges: Uint16Array, px: Float64Array, dx: number, dy: number): string {
  let d = ""
  for (let i = 0; i < edges.length; i += 2) {
    const a = edges[i]!, b = edges[i + 1]!
    d += `M${r1(px[2 * a]! - dx)} ${r1(px[2 * a + 1]! - dy)}L${r1(px[2 * b]! - dx)} ${r1(px[2 * b + 1]! - dy)}`
  }
  return d
}

/**
 * The overlay for `faces` (each `[x0, y0, …]` fractions) on a `width × height`
 * frame, or null when there is nothing to draw on it (no face, or every face
 * entirely off the frame).
 */
export function faceMeshOverlay(faces: readonly ArrayLike<number>[], width: number, height: number): FaceMeshOverlay | null {
  if (faces.length === 0) return null
  const drawn = faces.map((f) => {
    const px = new Float64Array(f.length)
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (let i = 0; i + 1 < f.length; i += 2) {
      const x = f[i]! * width, y = f[i + 1]! * height
      px[i] = x
      px[i + 1] = y
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
    const mesh = Math.max(FACE_MESH_STYLE.minWidth, (y1 - y0) * FACE_MESH_STYLE.widthPerFacePx)
    return { px, mesh, box: [x0, y0, x1, y1] as const }
  })
  // The faces' box, widened by the thickest line, clipped to the frame.
  const pad = Math.ceil(Math.max(...drawn.map((d) => d.mesh)) * Math.max(FACE_MESH_STYLE.lips.widthFactor, FACE_MESH_STYLE.eyes.widthFactor)) + 1
  const left = Math.max(0, Math.floor(Math.min(...drawn.map((d) => d.box[0])) - pad))
  const top = Math.max(0, Math.floor(Math.min(...drawn.map((d) => d.box[1])) - pad))
  const right = Math.min(width, Math.ceil(Math.max(...drawn.map((d) => d.box[2])) + pad))
  const bottom = Math.min(height, Math.ceil(Math.max(...drawn.map((d) => d.box[3])) + pad))
  if (right - left < 1 || bottom - top < 1) return null
  const w = right - left
  const h = bottom - top
  let body = ""
  for (const d of drawn) {
    const lip = d.mesh * FACE_MESH_STYLE.lips.widthFactor
    const eye = d.mesh * FACE_MESH_STYLE.eyes.widthFactor
    body +=
      `<path d="${pathOf(MESH_EDGES, d.px, left, top)}" stroke="${FACE_MESH_STYLE.mesh.color}" stroke-opacity="${FACE_MESH_STYLE.mesh.opacity}" stroke-width="${r1(d.mesh)}"/>` +
      `<path d="${pathOf(LIP_EDGES, d.px, left, top)}" stroke="${FACE_MESH_STYLE.lips.color}" stroke-width="${r1(lip)}"/>` +
      `<path d="${pathOf(EYE_EDGES, d.px, left, top)}" stroke="${FACE_MESH_STYLE.eyes.color}" stroke-width="${r1(eye)}"/>`
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<g fill="none" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>`
  return { svg, left, top, width: w, height: h }
}

/**
 * Draw `overlay` onto a packed RGB `width × height` frame. Returns a new
 * RGB buffer of the same size (the input is not changed).
 */
export async function compositeFaceMesh(rgb: Buffer, width: number, height: number, overlay: FaceMeshOverlay): Promise<Buffer> {
  const out = await sharp(rgb, { raw: { width, height, channels: 3 } })
    .composite([{ input: Buffer.from(overlay.svg), left: overlay.left, top: overlay.top }])
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  if (out.info.width !== width || out.info.height !== height || out.info.channels !== 3) {
    throw new Error(`face mesh: the drawn frame is ${out.info.width}×${out.info.height}×${out.info.channels}, not ${width}×${height}×3`)
  }
  return out.data
}
