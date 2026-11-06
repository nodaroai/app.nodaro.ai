/**
 * What a face mesh run draws, as layers — pure, no drawing.
 *
 * A run names a `parts` value (`VideoFaceMeshParts`) or a set of layers
 * (`VideoFaceMeshLayers`, `@nodaro/shared`): the wireframe, the eye outlines,
 * the lip outline, the contours (the face oval, the brows and the nose), the
 * irises, and bold lines. Every `parts` value is one set
 * (`videoFaceMeshLayersOfParts`), and each set's lines are listed here in the
 * order that value has always drawn them, so a set that is a `parts` value's
 * draws its exact bytes:
 *   - the outlines are ONE list (`outlineEdgesOf`): the lips, then the eyes,
 *     then the oval, the brows and the nose — each taken when its layer is on;
 *   - with the contours on, every line leaves out what the face hides
 *     (`hidesFarSide`), so the depths are read and the visibility is worked
 *     out over `visibilityLayoutOf`'s layout: the outlines first (the
 *     contours' own layout, `CONTOUR_EDGES`, when the set is `"contours"`),
 *     then the two eyes' outlines again for the irises (an iris fades with its
 *     eye), then the wireframe's points. With the contours off nothing is
 *     left out.
 */
import {
  VIDEO_FACE_MESH_LAYERS,
  videoFaceMeshLayersOfParts,
  type VideoFaceMeshLayer,
  type VideoFaceMeshLayers,
  type VideoFaceMeshParts,
} from "@nodaro/shared/media"
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
import { FACE_MESH_POINTS } from "./face-mesh-model.js"
import { FACE_MESH_VISIBILITY, edgeVisibility } from "./face-mesh-visibility.js"

/** What a run draws: a `parts` value, or a set of layers (`{ layers }`). Left out: `"full"`. */
export type FaceMeshDrawing = VideoFaceMeshParts | { readonly layers: VideoFaceMeshLayers }

/** A set of layers, every one named: on or off. */
export type FaceMeshLayerSet = { readonly [K in VideoFaceMeshLayer]: boolean }

/** The layers `drawing` draws, each named (`videoFaceMeshLayersOfParts` for a `parts` value). A new object. */
export function layerSetOf(drawing: FaceMeshDrawing = "full"): FaceMeshLayerSet {
  const layers = typeof drawing === "string" ? videoFaceMeshLayersOfParts(drawing) : drawing.layers
  return Object.fromEntries(VIDEO_FACE_MESH_LAYERS.map((l) => [l, layers[l] === true])) as FaceMeshLayerSet
}

/** Whether the set leaves out what the face hides (the contours on): only then are the points' depths needed. */
export const hidesFarSide = (set: FaceMeshLayerSet): boolean => set.contours

/** Whether the set draws the irises: only then are the model's 10 iris points (468–477) kept. */
export const drawsIrises = (set: FaceMeshLayerSet): boolean => set.irises

/** Each undirected edge once (the tesselation lists the edge two triangles share twice). */
export function uniqueEdges(flat: readonly number[]): Uint16Array {
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

/** The wireframe's edges. */
export const MESH_EDGES = uniqueEdges(FACEMESH_TESSELATION)
/** Each eye's outline, as an iris's visibility reads it. */
export const LEFT_EYE_EDGES = uniqueEdges(FACEMESH_LEFT_EYE)
export const RIGHT_EYE_EDGES = uniqueEdges(FACEMESH_RIGHT_EYE)

const outlineCache = new Map<string, Uint16Array>()

/**
 * The set's outline edges, in the order the `parts` values draw them: the
 * lips', the eyes' (left, right), then the oval's, the brows' (left, right)
 * and the nose's. Memoised: the same array for the same set.
 */
export function outlineEdgesOf(set: FaceMeshLayerSet): Uint16Array {
  const key = `${+set.lips}${+set.eyes}${+set.contours}`
  const cached = outlineCache.get(key)
  if (cached) return cached
  const edges = uniqueEdges([
    ...(set.lips ? FACEMESH_LIPS : []),
    ...(set.eyes ? [...FACEMESH_LEFT_EYE, ...FACEMESH_RIGHT_EYE] : []),
    ...(set.contours ? [...FACEMESH_FACE_OVAL, ...FACEMESH_LEFT_EYEBROW, ...FACEMESH_RIGHT_EYEBROW, ...FACEMESH_NOSE] : []),
  ])
  outlineCache.set(key, edges)
  return edges
}

/** A run of edges in a visibility layout: `[from, to)` in EDGE indices (each edge holds `pieces` values). */
export type EdgeSpan = readonly [number, number]

/**
 * Where each layer's lines sit in a face's visibility (`visibilityOfLayout`):
 * first `pieces` values per edge of `edges` (the outlines, then each eye's
 * outline again for its iris), then — the wireframe drawn — one value per
 * point of the face (`meshPointsFrom` on): the wireframe's 1,300-odd edges
 * judged piece by piece would cost ten times the contours' (about 30 ms a
 * face a frame), so each of its edges is drawn as far as the less visible of
 * its two points is.
 */
export interface FaceMeshVisibilityLayout {
  /** The edges judged piece by piece, in order. */
  readonly edges: Uint16Array
  readonly outline: EdgeSpan
  /** Each eye's outline, for its iris, when the irises are drawn. */
  readonly leftIris?: EdgeSpan
  readonly rightIris?: EdgeSpan
  /** The wireframe drawn: the index of the first point's value (one per point, `FACE_MESH_POINTS` of them). */
  readonly meshPointsFrom?: number
}

const layoutCache = new Map<string, FaceMeshVisibilityLayout>()

/** The visibility layout of a set that hides its far side (`hidesFarSide`). Memoised. */
export function visibilityLayoutOf(set: FaceMeshLayerSet): FaceMeshVisibilityLayout {
  const key = VIDEO_FACE_MESH_LAYERS.map((l) => +set[l]).join("")
  const cached = layoutCache.get(key)
  if (cached) return cached
  const outline = outlineEdgesOf(set)
  const n = outline.length / 2
  const iris = set.irises ? [LEFT_EYE_EDGES, RIGHT_EYE_EDGES] : []
  const edges = new Uint16Array(outline.length + iris.reduce((s, e) => s + e.length, 0))
  edges.set(outline, 0)
  if (set.irises) {
    edges.set(LEFT_EYE_EDGES, outline.length)
    edges.set(RIGHT_EYE_EDGES, outline.length + LEFT_EYE_EDGES.length)
  }
  const l = LEFT_EYE_EDGES.length / 2, r = RIGHT_EYE_EDGES.length / 2
  const layout: FaceMeshVisibilityLayout = {
    edges,
    outline: [0, n],
    ...(set.irises ? { leftIris: [n, n + l] as const, rightIris: [n + l, n + l + r] as const } : {}),
    ...(set.wireframe ? { meshPointsFrom: (edges.length / 2) * FACE_MESH_VISIBILITY.pieces } : {}),
  }
  layoutCache.set(key, layout)
  return layout
}

/** Each of the face's 468 points as an edge of its own, judged in one piece: what the wireframe's visibility reads. */
const POINT_EDGES = Uint16Array.from({ length: 2 * FACE_MESH_POINTS }, (_, i) => i >> 1)

/**
 * A face's visibility in `layout`'s order (`points` `[x0, y0, …]` and `depth`
 * in the same units, as `edgeVisibility` takes them): the edges' pieces, then
 * the points' when the wireframe is drawn. For a set whose layout holds only
 * its outlines (the contours' own) it is `edgeVisibility` over them.
 */
export function visibilityOfLayout(points: ArrayLike<number>, depth: ArrayLike<number>, layout: FaceMeshVisibilityLayout): Float32Array {
  const edges = edgeVisibility(points, depth, layout.edges)
  if (layout.meshPointsFrom === undefined) return edges
  const out = new Float32Array(edges.length + FACE_MESH_POINTS)
  out.set(edges, 0)
  out.set(edgeVisibility(points, depth, POINT_EDGES, 1), edges.length)
  return out
}
