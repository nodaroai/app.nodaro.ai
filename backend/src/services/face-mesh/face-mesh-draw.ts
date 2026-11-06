/**
 * The lines drawn on a frame — rasterised from SVG with sharp, then toned
 * against the picture under them.
 *
 * Per face (its 468 points as fractions of the frame):
 *   - the tesselation: a thin wireframe (`FACE_MESH_STYLE.mesh`);
 *   - the eye outlines and the lip outline, outer and inner: darker and a
 *     little thicker (`FACE_MESH_STYLE.outline`).
 * What is drawn is the request's `parts` (`VideoFaceMeshParts`): `"full"`
 * (the default) both layers; `"features"` the eye and lip outlines alone;
 * `"mouth"` the lip outline alone; `"contours"` (2026-11-06) the eye and lip
 * outlines, the face oval, both eyebrows and the nose, all in the outline
 * layer's tone and width, no wireframe. An outline is drawn exactly as in the
 * full mesh (its tone, its width, the face's box), so `"full"` is unchanged.
 * The contours are the one part that runs round the face's sides, so they
 * are drawn only where the face does not hide them (given each face's
 * visibility, `edgeVisibility` in `face-mesh-visibility.ts`): a turned face's
 * far side is left out, and a line slipping behind the cheek or the nose is
 * drawn fainter as it goes (`CONTOUR_FADE_LEVELS`).
 * No colour of their own (decided by the admin 2026-11-01: a video model
 * copied the former blue / green lines into its result): every line is a tone
 * of the picture under it (`lineTone`) — the wireframe × 0.6, the outlines
 * × 0.35 — so it reads as part of that picture:
 *   - on a gray depth map, or a blurred face, a darker GRAY of the pixel's
 *     own luminance (on a face, a darker neutral version of the skin);
 *   - on a coloured depth map (given the gray depth render beside it and the
 *     map, `FaceMeshDepth`), the MAP's colour at that tone of the depth under
 *     it: on turbo a "deeper" turbo of the same spot.
 * Where the picture is near black there is nothing to darken, so the lines
 * lighten instead, with a smooth hand-over (no jump in tone as the depth
 * drifts across it).
 *
 * Widths: the wireframe is 1 px at 720p (the frame's SHORT side), scaled with
 * the resolution, never thicker than 1 px per 100 px of the face's height,
 * never under 1 px; the outlines 1.5 × that.
 *
 * Each layer is ONE `<path>` per face, rasterised to a coverage (a stroke is
 * painted once where its segments overlap, so the mesh's shared edges never
 * darken twice), over only the faces' box — a frame with no face is passed
 * through untouched.
 */
import sharp from "sharp"
import type { VideoFaceMeshParts } from "@nodaro/shared/media"
import { FACE_MESH_VISIBILITY } from "./face-mesh-visibility.js"
import {
  FACEMESH_FACE_OVAL,
  FACEMESH_LEFT_EYE,
  FACEMESH_LEFT_EYEBROW,
  FACEMESH_LIPS,
  FACEMESH_NOSE,
  FACEMESH_RIGHT_EYE,
  FACEMESH_RIGHT_EYEBROW,
  FACEMESH_TESSELATION,
} from "./face-mesh-topology.js"

/** How one layer's gray is worked out from the luminance `L` (0–255) under it (`lineTone`). */
export interface FaceMeshTone {
  /** Bright enough to darken: the line is `L × factor`… */
  readonly factor: number
  /** …but always at least this many levels below `L` (as far as 0 allows). */
  readonly minDarken: number
  /** Near black: the line is this many levels ABOVE `L`. */
  readonly lighten: number
}

export const FACE_MESH_STYLE = {
  mesh: { factor: 0.6, minDarken: 16, lighten: 20 },
  outline: { factor: 0.35, minDarken: 32, lighten: 40, widthFactor: 1.5 },
  /** At or below this luminance the lines lighten… */
  lightenAt: 16,
  /** …at or above this one they darken; in between, a smoothstep from one to the other. */
  darkenAt: 32,
  /** The wireframe's width per pixel of the frame's short side (1 px at 720p). */
  widthPerShortSidePx: 1 / 720,
  /** …and at most this per pixel of face height (1 px per 100 px), so a small face is not filled in. */
  widthPerFacePx: 0.01,
  /** No line is thinner than this, px. */
  minWidth: 1,
} as const

const smoothstep = (t: number): number => {
  const x = Math.min(1, Math.max(0, t))
  return x * x * (3 - 2 * x)
}

/**
 * The gray (0–255) a line of `tone` is drawn in over a pixel of luminance
 * `l`: darkened (`l × factor`, at least `minDarken` below, never under 0)
 * where the picture is bright enough, lightened (`l + lighten`) where it is
 * near black, and a smooth blend of the two between `lightenAt` and
 * `darkenAt` — continuous in `l`, so a line never flips tone from one frame
 * to the next. The blend passes the background's own tone once, a few levels
 * above black, where the line briefly fades.
 */
export function lineTone(l: number, tone: FaceMeshTone): number {
  const dark = Math.max(0, l - Math.max(l * (1 - tone.factor), tone.minDarken))
  const light = Math.min(255, l + tone.lighten)
  const t = smoothstep((l - FACE_MESH_STYLE.lightenAt) / (FACE_MESH_STYLE.darkenAt - FACE_MESH_STYLE.lightenAt))
  return light + (dark - light) * t
}

/** The luminance (Rec. 709 weights) of an RGB pixel, 0–255. */
export const lumaOf = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b

/** Each layer's tone for every whole luminance. */
const MESH_TONES = Float32Array.from({ length: 256 }, (_, l) => lineTone(l, FACE_MESH_STYLE.mesh))
const OUTLINE_TONES = Float32Array.from({ length: 256 }, (_, l) => lineTone(l, FACE_MESH_STYLE.outline))

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
const OUTLINE_EDGES = uniqueEdges([...FACEMESH_LIPS, ...FACEMESH_LEFT_EYE, ...FACEMESH_RIGHT_EYE])
/** The lip outline alone, outer and inner (`parts: "mouth"`). */
const LIP_EDGES = uniqueEdges(FACEMESH_LIPS)
/**
 * The contours (`parts: "contours"`): the eye and lip outlines first, as drawn above, then the oval, the brows and the
 * nose. A face's visibility (`edgeVisibility`, `face-mesh-visibility.ts`) is given per piece of these, in this order.
 */
export const CONTOUR_EDGES = uniqueEdges([
  ...FACEMESH_LIPS,
  ...FACEMESH_LEFT_EYE,
  ...FACEMESH_RIGHT_EYE,
  ...FACEMESH_FACE_OVAL,
  ...FACEMESH_LEFT_EYEBROW,
  ...FACEMESH_RIGHT_EYEBROW,
  ...FACEMESH_NOSE,
])

/**
 * Where the lines go on the frame: two SVGs over the same box, white on
 * transparent — the wireframe (`meshSvg`; empty when the request draws no
 * wireframe: `parts` `"features"`, `"mouth"` or `"contours"`) and the outlines
 * (`outlineSvg`: the eyes' and the lips', the lips' alone for `"mouth"`, and
 * also the oval, brows and nose for `"contours"`) —
 * whose coverage `compositeFaceMesh` tones.
 */
export interface FaceMeshOverlay {
  readonly meshSvg: string
  readonly outlineSvg: string
  /**
   * The contours' fading pieces (`parts: "contours"` with a visibility): one
   * SVG per strength present, white on transparent over the same box, drawn
   * as part of the outlines at `alpha` × their coverage — where one meets a
   * line of the outlines, the stronger wins (never darker than either).
   * Absent when nothing fades.
   */
  readonly fadedSvgs?: readonly FaceMeshFadedLayer[]
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/** A layer of the contours' fading pieces, all at one strength. */
export interface FaceMeshFadedLayer {
  readonly svg: string
  /** 1 / `CONTOUR_FADE_LEVELS` … (`CONTOUR_FADE_LEVELS` − 1) / `CONTOUR_FADE_LEVELS`. */
  readonly alpha: number
}

/**
 * A contour piece's visibility is drawn at the nearest of this many strengths:
 * the nearest to 1 with the outlines, 0 (under half a step) not at all, each
 * one between in a layer of its own (`FaceMeshFadedLayer`) — so a fade is a
 * handful of paths, not one per piece.
 */
export const CONTOUR_FADE_LEVELS = 8

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
 * The contours of one face drawn as far as `visibility` (`edgeVisibility`'s
 * layout over `CONTOUR_EDGES`) says: `d` for each strength level, index
 * `CONTOUR_FADE_LEVELS` the whole lines. Each edge's pieces at one level in a
 * row are one segment, so an edge drawn whole is its own "M a L b", exactly
 * as `pathOf` draws it.
 */
function contourPathsOf(visibility: ArrayLike<number>, px: Float64Array, dx: number, dy: number): string[] {
  const pieces = FACE_MESH_VISIBILITY.pieces
  const d: string[] = Array.from({ length: CONTOUR_FADE_LEVELS + 1 }, () => "")
  const at = (a: number, b: number, t: number, k: 0 | 1): number => (t === 0 ? px[2 * a + k]! : t === 1 ? px[2 * b + k]! : px[2 * a + k]! + (px[2 * b + k]! - px[2 * a + k]!) * t)
  for (let e = 0; e < CONTOUR_EDGES.length; e += 2) {
    const a = CONTOUR_EDGES[e]!, b = CONTOUR_EDGES[e + 1]!
    const base = (e >> 1) * pieces
    const levelOf = (k: number) => Math.round(Math.min(1, Math.max(0, visibility[base + k] ?? 1)) * CONTOUR_FADE_LEVELS)
    for (let k = 0; k < pieces; ) {
      const level = levelOf(k)
      let end = k + 1
      while (end < pieces && levelOf(end) === level) end++
      if (level > 0) {
        const t0 = k / pieces, t1 = end / pieces
        d[level] += `M${r1(at(a, b, t0, 0) - dx)} ${r1(at(a, b, t0, 1) - dy)}L${r1(at(a, b, t1, 0) - dx)} ${r1(at(a, b, t1, 1) - dy)}`
      }
      k = end
    }
  }
  return d
}

const svgOf = (w: number, h: number, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
  `<g fill="none" stroke="#FFFFFF" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>`

/**
 * The overlay for `faces` (each `[x0, y0, …]` fractions) on a `width × height`
 * frame, or null when there is nothing to draw on it (no face, or every face
 * entirely off the frame). `parts` (left out: `"full"`) decides which layers
 * are drawn; the box and the widths are worked out from every point either
 * way, so an outline is the same line in each. `visibility` (per face, in
 * `faces`' order; `edgeVisibility` over `CONTOUR_EDGES`) is read for
 * `"contours"` alone: what a face hides is left out, what fades is drawn
 * fainter (`fadedSvgs`). A face with none is drawn whole.
 */
export function faceMeshOverlay(
  faces: readonly ArrayLike<number>[],
  width: number,
  height: number,
  parts: VideoFaceMeshParts = "full",
  visibility?: readonly (ArrayLike<number> | undefined)[],
): FaceMeshOverlay | null {
  if (faces.length === 0) return null
  const frameWidth = Math.min(width, height) * FACE_MESH_STYLE.widthPerShortSidePx
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
    const mesh = Math.max(FACE_MESH_STYLE.minWidth, Math.min(frameWidth, (y1 - y0) * FACE_MESH_STYLE.widthPerFacePx))
    return { px, mesh, box: [x0, y0, x1, y1] as const }
  })
  // The faces' box, widened by the thickest line, clipped to the frame.
  const pad = Math.ceil(Math.max(...drawn.map((d) => d.mesh)) * FACE_MESH_STYLE.outline.widthFactor) + 1
  const left = Math.max(0, Math.floor(Math.min(...drawn.map((d) => d.box[0])) - pad))
  const top = Math.max(0, Math.floor(Math.min(...drawn.map((d) => d.box[1])) - pad))
  const right = Math.min(width, Math.ceil(Math.max(...drawn.map((d) => d.box[2])) + pad))
  const bottom = Math.min(height, Math.ceil(Math.max(...drawn.map((d) => d.box[3])) + pad))
  if (right - left < 1 || bottom - top < 1) return null
  const w = right - left
  const h = bottom - top
  const wireframe = parts === "full"
  const outlineEdges = parts === "mouth" ? LIP_EDGES : parts === "contours" ? CONTOUR_EDGES : OUTLINE_EDGES
  let mesh = ""
  let outline = ""
  const faded: string[] = Array.from({ length: CONTOUR_FADE_LEVELS }, () => "")
  drawn.forEach((d, i) => {
    const stroke = `stroke-width="${r1(d.mesh * FACE_MESH_STYLE.outline.widthFactor)}"`
    if (wireframe) mesh += `<path d="${pathOf(MESH_EDGES, d.px, left, top)}" stroke-width="${r1(d.mesh)}"/>`
    const seen = parts === "contours" ? visibility?.[i] : undefined
    if (!seen) {
      outline += `<path d="${pathOf(outlineEdges, d.px, left, top)}" ${stroke}/>`
      return
    }
    const paths = contourPathsOf(seen, d.px, left, top)
    outline += `<path d="${paths[CONTOUR_FADE_LEVELS]}" ${stroke}/>`
    for (let level = 1; level < CONTOUR_FADE_LEVELS; level++) if (paths[level]) faded[level] += `<path d="${paths[level]}" ${stroke}/>`
  })
  const fadedSvgs = faded.flatMap((body, level) => (body ? [{ svg: svgOf(w, h, body), alpha: level / CONTOUR_FADE_LEVELS }] : []))
  return {
    meshSvg: wireframe ? svgOf(w, h, mesh) : "",
    outlineSvg: svgOf(w, h, outline),
    ...(fadedSvgs.length > 0 ? { fadedSvgs } : {}),
    left,
    top,
    width: w,
    height: h,
  }
}

/** An SVG's coverage (its alpha, 0–255) at exactly `width × height`. */
async function coverageOf(svg: string, width: number, height: number): Promise<Buffer> {
  const out = await sharp(Buffer.from(svg)).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true })
  if (out.info.width !== width || out.info.height !== height || out.info.channels !== 1) {
    throw new Error(`face mesh: the lines rasterised to ${out.info.width}×${out.info.height}×${out.info.channels}, not ${width}×${height}×1`)
  }
  return out.data
}

/**
 * The outlines' coverage with the contours' fading pieces in it: each layer's
 * coverage × its strength, the stronger of the two at each pixel — so where a
 * faint piece meets a whole line (or another faint one) it is never painted
 * twice, never darker than the stronger.
 */
async function withFaded(outline: Buffer, layers: readonly FaceMeshFadedLayer[], w: number, h: number): Promise<Buffer> {
  const out = Buffer.from(outline)
  const coverages = await Promise.all(layers.map((l) => coverageOf(l.svg, w, h)))
  layers.forEach((l, j) => {
    const c = coverages[j]!
    for (let i = 0; i < out.length; i++) {
      const v = Math.round(c[i]! * l.alpha)
      if (v > out[i]!) out[i] = v
    }
  })
  return out
}

/**
 * The depth under the lines, for a line that is a colour OF the depth map it
 * is drawn on: the gray depth render of the same frame (`rgb`, packed RGB,
 * `width × height`, any size: read at the same place as a fraction of the
 * frame, its luminance the depth) and the map's colours (`table`,
 * `depthColormapTable`).
 */
export interface FaceMeshDepth {
  readonly rgb: Uint8Array
  readonly width: number
  readonly height: number
  readonly table: Uint8Array
}

/**
 * Draw `overlay` onto a packed RGB `width × height` frame. Returns a new
 * RGB buffer of the same size (the input is not changed). Both layers' tones
 * are worked out from the ORIGINAL picture under the line (an outline over the
 * wireframe is never darkened twice), the wireframe's applied then the
 * outlines', each by its coverage:
 *   - no `depth`: the gray tone of the pixel's own luminance, blended into the
 *     pixel — gray on a gray map, a darker neutral over a blurred face;
 *   - with `depth`: the line is the map's colour at the line's tone of the
 *     depth `g` under it, blended IN THE MAP'S INDEX (`g` → the tone by the
 *     coverage), so on the map every pixel drawn, its anti-aliased edges
 *     included, is a colour of the map — on turbo a "deeper" turbo of the
 *     same spot. It is applied as a step from the map's colour at `g`, so a
 *     pixel no line covers is the clip's own, and the clip's own deviations
 *     from the map (its encoding) are kept. With the grayscale map this is
 *     exactly the first case on a gray depth clip.
 */
export async function compositeFaceMesh(
  rgb: Buffer,
  width: number,
  height: number,
  overlay: FaceMeshOverlay,
  depth?: FaceMeshDepth,
): Promise<Buffer> {
  if (rgb.length !== width * height * 3) {
    throw new Error(`face mesh: the frame holds ${rgb.length} bytes, not ${width}×${height}×3`)
  }
  if (depth && (depth.rgb.length !== depth.width * depth.height * 3 || depth.table.length !== 768)) {
    throw new Error(`face mesh: the depth frame holds ${depth.rgb.length} bytes, not ${depth.width}×${depth.height}×3, or its map is not 256 colours`)
  }
  const { left, top, width: w, height: h } = overlay
  if (left < 0 || top < 0 || left + w > width || top + h > height) {
    throw new Error(`face mesh: the lines' box ${w}×${h} at ${left},${top} is outside the ${width}×${height} frame`)
  }
  // No wireframe (`parts` other than "full"): no coverage of it — every pixel's wireframe share is 0.
  const [mesh, lines] = await Promise.all([overlay.meshSvg ? coverageOf(overlay.meshSvg, w, h) : null, coverageOf(overlay.outlineSvg, w, h)])
  const outline = overlay.fadedSvgs ? await withFaded(lines, overlay.fadedSvgs, w, h) : lines
  const out = Buffer.from(rgb)
  for (let y = 0; y < h; y++) {
    const dy = depth ? Math.min(depth.height - 1, Math.floor(((top + y + 0.5) * depth.height) / height)) : 0
    for (let x = 0; x < w; x++) {
      const c = y * w + x
      const am = mesh ? mesh[c]! / 255 : 0
      const ao = outline[c]! / 255
      if (am === 0 && ao === 0) continue
      const i = ((top + y) * width + left + x) * 3
      if (depth) {
        const dx = Math.min(depth.width - 1, Math.floor(((left + x + 0.5) * depth.width) / width))
        const d = (dy * depth.width + dx) * 3
        const g = Math.round(lumaOf(depth.rgb[d]!, depth.rgb[d + 1]!, depth.rgb[d + 2]!))
        const withMesh = g + (MESH_TONES[g]! - g) * am
        const idx = withMesh + (OUTLINE_TONES[g]! - withMesh) * ao
        // The map's colour at `idx` (between two neighbouring entries: still a colour of it), applied as
        // the step from the map's colour at `g`: the clip's own pixel where nothing covers it, the map's
        // colour at the line's tone where a line covers it whole (the pixel being the map's colour at `g`).
        const lo = Math.max(0, Math.min(255, Math.floor(idx)))
        const hi = Math.min(255, lo + 1)
        const f = idx - lo
        for (let k = 0; k < 3; k++) {
          const at = depth.table[3 * lo + k]! + (depth.table[3 * hi + k]! - depth.table[3 * lo + k]!) * f
          out[i + k] = Math.max(0, Math.min(255, Math.round(rgb[i + k]! + at - depth.table[3 * g + k]!)))
        }
        continue
      }
      const l = Math.round(lumaOf(rgb[i]!, rgb[i + 1]!, rgb[i + 2]!))
      const tm = MESH_TONES[l]!
      const to = OUTLINE_TONES[l]!
      for (let k = 0; k < 3; k++) {
        const v = rgb[i + k]!
        const withMesh = v + (tm - v) * am
        out[i + k] = Math.round(withMesh + (to - withMesh) * ao)
      }
    }
  }
  return out
}
