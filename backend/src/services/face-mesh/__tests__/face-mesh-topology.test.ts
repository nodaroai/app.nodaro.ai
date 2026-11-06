import { describe, expect, it } from "vitest"
import {
  FACEMESH_FACE_OVAL,
  FACEMESH_LEFT_EYEBROW,
  FACEMESH_NOSE,
  FACEMESH_RIGHT_EYEBROW,
  FACEMESH_TESSELATION,
} from "../face-mesh-topology.js"

// The contours' lists (MediaPipe's FACEMESH_FACE_OVAL, LEFT/RIGHT_EYEBROW and NOSE): each a list of whole edges, and
// every edge one of the tesselation's — the lines run along the mesh, over the same 468 points.
describe("face mesh topology: the contours", () => {
  const edgesOf = (flat: readonly number[]) => {
    const out: string[] = []
    for (let i = 0; i < flat.length; i += 2) out.push(`${Math.min(flat[i]!, flat[i + 1]!)}-${Math.max(flat[i]!, flat[i + 1]!)}`)
    return out
  }
  const tesselation = new Set(edgesOf(FACEMESH_TESSELATION))

  it.each([
    ["FACE_OVAL", FACEMESH_FACE_OVAL, 36],
    ["LEFT_EYEBROW", FACEMESH_LEFT_EYEBROW, 8],
    ["RIGHT_EYEBROW", FACEMESH_RIGHT_EYEBROW, 8],
    ["NOSE", FACEMESH_NOSE, 25],
  ] as const)("%s: its edges, each on the tesselation, each point one of the 468", (_name, list, edges) => {
    expect(list.length).toBe(2 * edges)
    for (const p of list) expect(p >= 0 && p < 468).toBe(true)
    for (const e of edgesOf(list)) expect(tesselation.has(e)).toBe(true)
  })

  it("the face oval is one closed loop", () => {
    const degree = new Map<number, number>()
    for (const p of FACEMESH_FACE_OVAL) degree.set(p, (degree.get(p) ?? 0) + 1)
    expect([...degree.values()].every((d) => d === 2)).toBe(true)
  })
})
