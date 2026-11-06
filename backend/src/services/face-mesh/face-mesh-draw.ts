/**
 * The lines drawn on a frame — rasterised from SVG with sharp, then toned
 * against the picture under them.
 *
 * Per face (its 468 points as fractions of the frame, 478 with the irises),
 * the layers the request draws (`face-mesh-layers.ts`: a `parts` value is one
 * set of them):
 *   - the wireframe: the tesselation, thin (`FACE_MESH_STYLE.mesh`);
 *   - the outlines, darker and a little thicker (`FACE_MESH_STYLE.outline`):
 *     the eyes', the lips' (outer and inner), and the contours (the face
 *     oval, both eyebrows and the nose), each its own layer;
 *   - the irises: a circle and a centre dot each, in the outlines' tone and
 *     width, clipped to the eye's opening (`face-mesh-irises.ts`);
 *   - bold (a modifier, no line of its own): every line `FACE_MESH_STYLE.bold`
 *     × as wide, in a deeper tone (`boldMesh`, `boldOutline`).
 * `"full"` (the default) is the wireframe and the eye and lip outlines;
 * `"features"` the eye and lip outlines; `"mouth"` the lip outline;
 * `"contours"` (2026-11-06) the eye and lip outlines and the contours. An
 * outline is drawn exactly as in the full mesh (its tone, its width, the
 * face's box), whatever else is drawn.
 * With the contours on, every line is drawn only where the face does not hide
 * it (given each face's visibility, `edgeVisibility` in
 * `face-mesh-visibility.ts`, over `visibilityLayoutOf`'s edges): a turned
 * face's far side is left out, and a line slipping behind the cheek or the
 * nose is drawn fainter as it goes (`CONTOUR_FADE_LEVELS`); an iris fades as
 * its eye's outline does. With the contours off nothing is left out.
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
 * the resolution, never thicker than 1 px per 100 px of the face's height
 * (`widthPerFacePx`), never under 1 px; the outlines 1.5 × that; bold lines
 * twice each.
 *
 * Each layer is ONE `<path>` per face, rasterised to a coverage (a stroke is
 * painted once where its segments overlap, so the mesh's shared edges never
 * darken twice), over only the faces' box — a frame with no face is passed
 * through untouched.
 */
import sharp from "sharp"
import { FACE_MESH_VISIBILITY } from "./face-mesh-visibility.js"
import { FACE_MESH_POINTS } from "./face-mesh-model.js"
import { irisSvg } from "./face-mesh-irises.js"
import {
  MESH_EDGES,
  layerSetOf,
  outlineEdgesOf,
  visibilityLayoutOf,
  type EdgeSpan,
  type FaceMeshDrawing,
  type FaceMeshLayerSet,
} from "./face-mesh-layers.js"

export type { FaceMeshDrawing } from "./face-mesh-layers.js"

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
  /**
   * Bold lines (the `bold` layer): every width × `widthScale` (the wireframe 2 px at 720p, at most 2 px per 100 px of
   * face height), and deeper tones — the wireframe about as deep as the usual outlines, the outlines near black.
   */
  bold: {
    widthScale: 2,
    mesh: { factor: 0.4, minDarken: 28, lighten: 32 },
    outline: { factor: 0.15, minDarken: 56, lighten: 64 },
  },
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

/** Each layer's tone for every whole luminance, and bold's. */
const MESH_TONES = Float32Array.from({ length: 256 }, (_, l) => lineTone(l, FACE_MESH_STYLE.mesh))
const OUTLINE_TONES = Float32Array.from({ length: 256 }, (_, l) => lineTone(l, FACE_MESH_STYLE.outline))
const BOLD_MESH_TONES = Float32Array.from({ length: 256 }, (_, l) => lineTone(l, FACE_MESH_STYLE.bold.mesh))
const BOLD_OUTLINE_TONES = Float32Array.from({ length: 256 }, (_, l) => lineTone(l, FACE_MESH_STYLE.bold.outline))

/**
 * The contours (`parts: "contours"`): the eye and lip outlines first, as drawn in the full mesh, then the oval, the
 * brows and the nose. A face's visibility (`edgeVisibility`, `face-mesh-visibility.ts`) is given per piece of these,
 * in this order, for that value (`visibilityLayoutOf`'s for its set).
 */
export const CONTOUR_EDGES = outlineEdgesOf(layerSetOf("contours"))

/**
 * Where the lines go on the frame: two SVGs over the same box, white on
 * transparent — the wireframe (`meshSvg`; empty when the request draws no
 * wireframe) and the outlines (`outlineSvg`: the eyes', the lips', the
 * contours' and the irises', as drawn) — whose coverage `compositeFaceMesh`
 * tones.
 */
export interface FaceMeshOverlay {
  readonly meshSvg: string
  readonly outlineSvg: string
  /**
   * The outlines' fading pieces (the contours on, with a visibility): one
   * SVG per strength present, white on transparent over the same box, drawn
   * as part of the outlines at `alpha` × their coverage — where one meets a
   * line of the outlines, the stronger wins (never darker than either).
   * Absent when nothing fades.
   */
  readonly fadedSvgs?: readonly FaceMeshFadedLayer[]
  /** The wireframe's fading pieces, as `fadedSvgs` are the outlines'. Absent when nothing of it fades. */
  readonly meshFadedSvgs?: readonly FaceMeshFadedLayer[]
  /** Bold lines (`FACE_MESH_STYLE.bold`): toned deeper. Absent: the usual tones. */
  readonly bold?: true
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/** A layer of fading pieces, all at one strength. */
export interface FaceMeshFadedLayer {
  readonly svg: string
  /** 1 / `CONTOUR_FADE_LEVELS` … (`CONTOUR_FADE_LEVELS` − 1) / `CONTOUR_FADE_LEVELS`. */
  readonly alpha: number
}

/**
 * A piece's visibility is drawn at the nearest of this many strengths: the
 * nearest to 1 with its layer, 0 (under half a step) not at all, each one
 * between in a layer of its own (`FaceMeshFadedLayer`) — so a fade is a
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

const levelOf = (v: number | undefined): number => Math.round(Math.min(1, Math.max(0, v ?? 1)) * CONTOUR_FADE_LEVELS)

/**
 * The `edges` of one face drawn as far as `visibility` says, its pieces for
 * those edges starting at edge `from` of the layout: `d` for each strength
 * level, index `CONTOUR_FADE_LEVELS` the whole lines. Each edge's pieces at
 * one level in a row are one segment, so an edge drawn whole is its own
 * "M a L b", exactly as `pathOf` draws it.
 */
function fadingPathsOf(edges: Uint16Array, visibility: ArrayLike<number>, from: number, px: Float64Array, dx: number, dy: number): string[] {
  const pieces = FACE_MESH_VISIBILITY.pieces
  const d: string[] = Array.from({ length: CONTOUR_FADE_LEVELS + 1 }, () => "")
  const at = (a: number, b: number, t: number, k: 0 | 1): number => (t === 0 ? px[2 * a + k]! : t === 1 ? px[2 * b + k]! : px[2 * a + k]! + (px[2 * b + k]! - px[2 * a + k]!) * t)
  for (let e = 0; e < edges.length; e += 2) {
    const a = edges[e]!, b = edges[e + 1]!
    const base = (from + (e >> 1)) * pieces
    for (let k = 0; k < pieces; ) {
      const level = levelOf(visibility[base + k])
      let end = k + 1
      while (end < pieces && levelOf(visibility[base + end]) === level) end++
      if (level > 0) {
        const t0 = k / pieces, t1 = end / pieces
        d[level] += `M${r1(at(a, b, t0, 0) - dx)} ${r1(at(a, b, t0, 1) - dy)}L${r1(at(a, b, t1, 0) - dx)} ${r1(at(a, b, t1, 1) - dy)}`
      }
      k = end
    }
  }
  return d
}

/**
 * The wireframe of one face drawn as far as its points' visibility (one value
 * per point, from `from`) says: each edge whole, at the strength of the less
 * visible of its two points; `d` for each strength level as `fadingPathsOf`.
 */
function meshPathsOf(visibility: ArrayLike<number>, from: number, px: Float64Array, dx: number, dy: number): string[] {
  const d: string[] = Array.from({ length: CONTOUR_FADE_LEVELS + 1 }, () => "")
  for (let e = 0; e < MESH_EDGES.length; e += 2) {
    const a = MESH_EDGES[e]!, b = MESH_EDGES[e + 1]!
    const level = Math.min(levelOf(visibility[from + a]), levelOf(visibility[from + b]))
    if (level > 0) d[level] += `M${r1(px[2 * a]! - dx)} ${r1(px[2 * a + 1]! - dy)}L${r1(px[2 * b]! - dx)} ${r1(px[2 * b + 1]! - dy)}`
  }
  return d
}

/** The strength an iris is drawn at: the mean of its eye's pieces (`span` of the layout), as a level. */
function irisLevelOf(visibility: ArrayLike<number>, span: EdgeSpan | undefined): number {
  if (!span) return CONTOUR_FADE_LEVELS
  const pieces = FACE_MESH_VISIBILITY.pieces
  let sum = 0
  for (let i = span[0] * pieces; i < span[1] * pieces; i++) sum += Math.min(1, Math.max(0, visibility[i] ?? 1))
  return levelOf(sum / ((span[1] - span[0]) * pieces))
}

const svgOf = (w: number, h: number, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
  `<g fill="none" stroke="#FFFFFF" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>`

/** Each strength level's body as a faded layer (levels 1 … `CONTOUR_FADE_LEVELS` − 1 that hold anything). */
const fadedLayersOf = (bodies: readonly string[], w: number, h: number): FaceMeshFadedLayer[] =>
  bodies.flatMap((body, level) => (body && level > 0 && level < CONTOUR_FADE_LEVELS ? [{ svg: svgOf(w, h, body), alpha: level / CONTOUR_FADE_LEVELS }] : []))

/**
 * The overlay for `faces` (each `[x0, y0, …]` fractions: 468 points, or 478
 * with the irises) on a `width × height` frame, or null when there is nothing
 * to draw on it (no face, or every face entirely off the frame). `drawing`
 * (left out: `"full"`) decides which layers are drawn (`layerSetOf`); the box
 * and the widths are worked out from the face's 468 points either way, so an
 * outline is the same line in each. `visibility` (per face, in `faces`'
 * order; `edgeVisibility` over `visibilityLayoutOf`'s edges) is read only
 * with the contours on: what a face hides is left out, what fades is drawn
 * fainter (`fadedSvgs`, `meshFadedSvgs`). A face with none is drawn whole.
 */
export function faceMeshOverlay(
  faces: readonly ArrayLike<number>[],
  width: number,
  height: number,
  drawing: FaceMeshDrawing = "full",
  visibility?: readonly (ArrayLike<number> | undefined)[],
): FaceMeshOverlay | null {
  if (faces.length === 0) return null
  const set: FaceMeshLayerSet = layerSetOf(drawing)
  const frameWidth = Math.min(width, height) * FACE_MESH_STYLE.widthPerShortSidePx
  const scale = set.bold ? FACE_MESH_STYLE.bold.widthScale : 1
  const drawn = faces.map((f) => {
    const px = new Float64Array(f.length)
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (let i = 0; i + 1 < f.length; i += 2) {
      const x = f[i]! * width, y = f[i + 1]! * height
      px[i] = x
      px[i + 1] = y
      // The box is the face's 468 points' (the irises are inside it).
      if (i >= 2 * FACE_MESH_POINTS) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
    const mesh = Math.max(FACE_MESH_STYLE.minWidth, Math.min(frameWidth, (y1 - y0) * FACE_MESH_STYLE.widthPerFacePx)) * scale
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
  const outlineEdges = outlineEdgesOf(set)
  const layout = set.contours ? visibilityLayoutOf(set) : undefined
  let mesh = ""
  let outline = ""
  const faded: string[] = Array.from({ length: CONTOUR_FADE_LEVELS }, () => "")
  const meshFaded: string[] = Array.from({ length: CONTOUR_FADE_LEVELS }, () => "")
  drawn.forEach((d, i) => {
    const outlineWidth = d.mesh * FACE_MESH_STYLE.outline.widthFactor
    const stroke = `stroke-width="${r1(outlineWidth)}"`
    const meshStroke = `stroke-width="${r1(d.mesh)}"`
    const seen = layout ? visibility?.[i] : undefined
    if (set.wireframe) {
      if (seen && layout?.meshPointsFrom !== undefined) {
        const paths = meshPathsOf(seen, layout.meshPointsFrom, d.px, left, top)
        mesh += `<path d="${paths[CONTOUR_FADE_LEVELS]}" ${meshStroke}/>`
        for (let level = 1; level < CONTOUR_FADE_LEVELS; level++) if (paths[level]) meshFaded[level] += `<path d="${paths[level]}" ${meshStroke}/>`
      } else {
        mesh += `<path d="${pathOf(MESH_EDGES, d.px, left, top)}" ${meshStroke}/>`
      }
    }
    if (outlineEdges.length > 0) {
      if (!seen) {
        outline += `<path d="${pathOf(outlineEdges, d.px, left, top)}" ${stroke}/>`
      } else {
        const paths = fadingPathsOf(outlineEdges, seen, 0, d.px, left, top)
        outline += `<path d="${paths[CONTOUR_FADE_LEVELS]}" ${stroke}/>`
        for (let level = 1; level < CONTOUR_FADE_LEVELS; level++) if (paths[level]) faded[level] += `<path d="${paths[level]}" ${stroke}/>`
      }
    }
    if (set.irises) {
      for (const side of ["left", "right"] as const) {
        const level = seen ? irisLevelOf(seen, side === "left" ? layout?.leftIris : layout?.rightIris) : CONTOUR_FADE_LEVELS
        if (level === 0) continue
        // Each SVG it may go in gets its own copy of the clip, so the ids are unique per SVG.
        const svg = irisSvg(d.px, side, left, top, outlineWidth, `iris-${i}-${side}`)
        if (level === CONTOUR_FADE_LEVELS) outline += svg
        else faded[level] += svg
      }
    }
  })
  const fadedSvgs = fadedLayersOf(faded, w, h)
  const meshFadedSvgs = fadedLayersOf(meshFaded, w, h)
  return {
    meshSvg: set.wireframe ? svgOf(w, h, mesh) : "",
    outlineSvg: svgOf(w, h, outline),
    ...(fadedSvgs.length > 0 ? { fadedSvgs } : {}),
    ...(meshFadedSvgs.length > 0 ? { meshFadedSvgs } : {}),
    ...(set.bold ? { bold: true as const } : {}),
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
 * A layer's coverage with its fading pieces in it: each layer's
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
  // No wireframe: no coverage of it — every pixel's wireframe share is 0.
  const [meshLines, lines] = await Promise.all([overlay.meshSvg ? coverageOf(overlay.meshSvg, w, h) : null, coverageOf(overlay.outlineSvg, w, h)])
  const mesh = meshLines && overlay.meshFadedSvgs ? await withFaded(meshLines, overlay.meshFadedSvgs, w, h) : meshLines
  const outline = overlay.fadedSvgs ? await withFaded(lines, overlay.fadedSvgs, w, h) : lines
  const meshTones = overlay.bold ? BOLD_MESH_TONES : MESH_TONES
  const outlineTones = overlay.bold ? BOLD_OUTLINE_TONES : OUTLINE_TONES
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
        const withMesh = g + (meshTones[g]! - g) * am
        const idx = withMesh + (outlineTones[g]! - withMesh) * ao
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
      const tm = meshTones[l]!
      const to = outlineTones[l]!
      for (let k = 0; k < 3; k++) {
        const v = rgb[i + k]!
        const withMesh = v + (tm - v) * am
        out[i + k] = Math.round(withMesh + (to - withMesh) * ao)
      }
    }
  }
  return out
}
