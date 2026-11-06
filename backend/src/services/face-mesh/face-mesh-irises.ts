/**
 * The irises' lines — pure, SVG only.
 *
 * The landmark model answers 478 points (`FACE_MESH_MODEL_POINTS`): the
 * face's 468, then each iris's centre and the four points round its rim —
 * 468 the right iris's centre (469–472 its rim), inside the right eye's outline
 * (`FACEMESH_RIGHT_EYE`: the person's right, on the image's left when they
 * face the camera), and 473 the left iris's (474–477), inside the left eye's.
 * Checked on a real clip: each centre falls inside its own eye's outline and
 * never inside the other.
 *
 * An iris is drawn as a circle at its centre, of the mean distance to its rim
 * points, and a dot at the centre (`FACE_MESH_IRIS`), both CLIPPED to the
 * eye's opening (the eye outline as a closed shape): an eyelid covers the
 * iris as it covers a real one, and a closed eye hides it — the model answers
 * an iris even when the eye is shut.
 */
import { FACEMESH_LEFT_EYE, FACEMESH_RIGHT_EYE } from "./face-mesh-topology.js"

export const FACE_MESH_IRIS = {
  /** The centre dot's radius × the iris's… */
  dotOfRadius: 0.3,
  /** …and never under this × the line's width. */
  dotMinOfWidth: 0.5,
} as const

/** Points per face with the irises: the face's 468 and the irises' 10. */
export const FACE_MESH_POINTS_WITH_IRISES = 478

/** The eye outline's points in order round the eye, from a list of its edges (each point on two). */
function loopOf(edges: readonly number[]): readonly number[] {
  const next = new Map<number, number[]>()
  for (let i = 0; i + 1 < edges.length; i += 2) {
    next.set(edges[i]!, [...(next.get(edges[i]!) ?? []), edges[i + 1]!])
    next.set(edges[i + 1]!, [...(next.get(edges[i + 1]!) ?? []), edges[i]!])
  }
  const start = edges[0]!
  const out = [start]
  for (let prev = -1, cur = start; ; ) {
    const step = next.get(cur)!.find((p) => p !== prev)!
    if (step === start) break
    out.push(step)
    prev = cur
    cur = step
  }
  return out
}

interface IrisOfEye {
  readonly centre: number
  readonly rim: readonly number[]
  /** The eye's opening, its outline's points in order. */
  readonly opening: readonly number[]
}

export const FACE_MESH_IRISES: { readonly left: IrisOfEye; readonly right: IrisOfEye } = {
  left: { centre: 473, rim: [474, 475, 476, 477], opening: loopOf(FACEMESH_LEFT_EYE) },
  right: { centre: 468, rim: [469, 470, 471, 472], opening: loopOf(FACEMESH_RIGHT_EYE) },
}

const r1 = (v: number): string => (Math.round(v * 10) / 10).toString()

/**
 * One iris (`side`) of a face whose points are `px` (pixels, `[x0, y0, …]`,
 * all 478), drawn `dx, dy` up and left of the frame: its clip and its lines,
 * `width` the line's width, `id` the clip's id (unique in its SVG). Empty when
 * the face has no iris points.
 */
export function irisSvg(px: ArrayLike<number>, side: "left" | "right", dx: number, dy: number, width: number, id: string): string {
  if (px.length < FACE_MESH_POINTS_WITH_IRISES * 2) return ""
  const iris = FACE_MESH_IRISES[side]
  const cx = px[2 * iris.centre]!, cy = px[2 * iris.centre + 1]!
  const r = iris.rim.reduce((s, p) => s + Math.hypot(px[2 * p]! - cx, px[2 * p + 1]! - cy), 0) / iris.rim.length
  if (!(r > 0)) return ""
  const opening = iris.opening.map((p, i) => `${i === 0 ? "M" : "L"}${r1(px[2 * p]! - dx)} ${r1(px[2 * p + 1]! - dy)}`).join("") + "Z"
  const dot = Math.max(FACE_MESH_IRIS.dotMinOfWidth * width, FACE_MESH_IRIS.dotOfRadius * r)
  const x = r1(cx - dx), y = r1(cy - dy)
  return (
    `<clipPath id="${id}"><path d="${opening}"/></clipPath>` +
    `<g clip-path="url(#${id})"><circle cx="${x}" cy="${y}" r="${r1(r)}" stroke-width="${r1(width)}"/>` +
    `<circle cx="${x}" cy="${y}" r="${r1(dot)}" fill="#FFFFFF" stroke="none"/></g>`
  )
}
