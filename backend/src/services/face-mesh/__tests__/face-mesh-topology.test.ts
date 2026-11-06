import { describe, expect, it } from "vitest"
import {
  FACEMESH_FACE_OVAL,
  FACEMESH_LEFT_EYE,
  FACEMESH_LEFT_EYEBROW,
  FACEMESH_LIPS,
  FACEMESH_NOSE,
  FACEMESH_OPENINGS,
  FACEMESH_RIGHT_EYE,
  FACEMESH_RIGHT_EYEBROW,
  FACEMESH_TESSELATION,
  FACEMESH_TRIANGLES,
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

describe("face mesh topology: the triangles and the openings", () => {
  it("the tesselation lists each triangle as its three edges in turn (a, b, b, c, c, a): FACEMESH_TRIANGLES reads them off", () => {
    expect(FACEMESH_TESSELATION.length % 6).toBe(0)
    for (let i = 0; i < FACEMESH_TESSELATION.length; i += 6) {
      const [a, b, b2, c, c2, a2] = FACEMESH_TESSELATION.slice(i, i + 6)
      expect([b2, c2, a2]).toEqual([b, c, a])
    }
    expect(FACEMESH_TRIANGLES.length).toBe(852 * 3)
    expect(Array.from(FACEMESH_TRIANGLES.slice(0, 6))).toEqual([127, 34, 139, 11, 0, 37])
  })

  it("the triangles are wound alike: every edge two triangles share runs one way in one and the other way in the other", () => {
    const directed = new Map<string, number>()
    for (let t = 0; t < FACEMESH_TRIANGLES.length; t += 3) {
      const [a, b, c] = FACEMESH_TRIANGLES.slice(t, t + 3)
      for (const [u, v] of [[a, b], [b, c], [c, a]]) directed.set(`${u}>${v}`, (directed.get(`${u}>${v}`) ?? 0) + 1)
    }
    // Wound alike, no directed edge is in two triangles (a shared edge runs each way once).
    for (const n of directed.values()) expect(n).toBe(1)
  })

  it("the openings close the eyes and the mouth: their rims are the eye outlines and the inner lip line, the oval left open", () => {
    const rims = new Map<string, number>()
    const undirected = (u: number, v: number) => `${Math.min(u, v)}-${Math.max(u, v)}`
    for (let t = 0; t < FACEMESH_OPENINGS.length; t += 3) {
      const [a, b, c] = FACEMESH_OPENINGS.slice(t, t + 3)
      for (const [u, v] of [[a!, b!], [b!, c!], [c!, a!]]) rims.set(undirected(u, v), (rims.get(undirected(u, v)) ?? 0) + 1)
    }
    // Rim edges are in one cap triangle; the fans' inner edges in two.
    const rim = new Set([...rims].filter(([, n]) => n === 1).map(([k]) => k))
    const edges = (flat: readonly number[]) => Array.from({ length: flat.length / 2 }, (_, i) => undirected(flat[2 * i]!, flat[2 * i + 1]!))
    const eyes = [...edges(FACEMESH_LEFT_EYE), ...edges(FACEMESH_RIGHT_EYE)]
    const lips = edges(FACEMESH_LIPS).filter((e) => rim.has(e))
    expect(rim.size).toBe(16 + 16 + 20)
    for (const e of eyes) expect(rim.has(e)).toBe(true)
    expect(lips).toHaveLength(20) // the inner lip line; the outer one runs over the mesh
    for (const e of edges(FACEMESH_FACE_OVAL)) expect(rim.has(e)).toBe(false)
    // 14 + 14 + 18 triangles fan the three rims (16, 16 and 20 points).
    expect(FACEMESH_OPENINGS.length / 3).toBe(14 + 14 + 18)
  })

  it("each opening is wound as the mesh is: its rim edge runs against the mesh triangle beside it", () => {
    const meshDirected = new Set<string>()
    for (let t = 0; t < FACEMESH_TRIANGLES.length; t += 3) {
      const [a, b, c] = FACEMESH_TRIANGLES.slice(t, t + 3)
      for (const [u, v] of [[a, b], [b, c], [c, a]]) meshDirected.add(`${u}>${v}`)
    }
    let rimEdges = 0
    for (let t = 0; t < FACEMESH_OPENINGS.length; t += 3) {
      const [a, b, c] = FACEMESH_OPENINGS.slice(t, t + 3)
      for (const [u, v] of [[a, b], [b, c], [c, a]]) {
        if (meshDirected.has(`${v}>${u}`)) rimEdges++
        expect(meshDirected.has(`${u}>${v}`)).toBe(false)
      }
    }
    expect(rimEdges).toBe(16 + 16 + 20)
  })
})
