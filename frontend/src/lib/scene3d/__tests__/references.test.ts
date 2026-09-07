import { describe, it, expect } from "vitest"
import { resolveScene3DReferences, checkScene3DReferenceLimit } from "../references"
import { SCENE3D_LIMITS } from "@nodaro/shared"

const isVideoUrl = (url: string) => /\.(mp4|mov|webm)$/i.test(url)

const OUTPUTS: Record<string, string> = {
  img1: "https://cdn.example.com/a.png",
  vid1: "https://cdn.example.com/b.mp4",
  txt1: "just some text",
}
const outputOf = (id: string) => OUTPUTS[id]

describe("resolveScene3DReferences", () => {
  const edges = [
    { source: "img1", target: "scene", targetHandle: "references" },
    { source: "vid1", target: "scene", targetHandle: "references" },
    { source: "txt1", target: "scene", targetHandle: "references" },
    { source: "img1", target: "other", targetHandle: "references" },
    { source: "vid1", target: "scene", targetHandle: "scene" },
  ]

  it("keeps only resolvable media wired to THIS node's references handle", () => {
    const refs = resolveScene3DReferences({ nodeId: "scene", edges, outputOf, isVideoUrl })
    expect(refs.map((r) => r.id)).toEqual(["img1", "vid1"])
    expect(refs[0]).toMatchObject({ url: OUTPUTS.img1, kind: "image", role: "appearance" })
    expect(refs[1]).toMatchObject({ url: OUTPUTS.vid1, kind: "video", role: "motion" })
  })

  it("retains imported references and lets a live wire replace its own reference ID", () => {
    const manual = { id: "manual", url: "https://example.com/manual.png", kind: "image" as const, role: "appearance" as const }
    const refs = resolveScene3DReferences({ nodeId: "scene", edges, outputOf, isVideoUrl,
      references: [manual, { ...manual, id: "img1", url: "https://example.com/old.png" }] })
    expect(refs[0]).toEqual(manual)
    expect(refs.find((reference) => reference.id === "img1")?.url).toBe(OUTPUTS.img1)
    expect(refs.filter((reference) => reference.id === "img1")).toHaveLength(1)
  })

  it("applies the panel's per-source role and object binding", () => {
    const refs = resolveScene3DReferences({
      nodeId: "scene",
      edges,
      outputOf,
      roles: { img1: "layout", vid1: "motion" },
      objectIds: { vid1: "hero" },
      isVideoUrl,
    })
    expect(refs[0].role).toBe("layout")
    expect(refs[1].role).toBe("motion")
    expect(refs[1].objectId).toBe("hero")
    expect(refs[0].objectId).toBeUndefined()
  })

  it("falls back to appearance for a role that is not in the vocabulary", () => {
    const refs = resolveScene3DReferences({
      nodeId: "scene",
      edges,
      outputOf,
      roles: { img1: "vibes" },
      isVideoUrl,
    })
    expect(refs[0].role).toBe("appearance")
  })

  it("de-duplicates a source wired twice", () => {
    const refs = resolveScene3DReferences({
      nodeId: "scene",
      edges: [...edges, { source: "img1", target: "scene", targetHandle: "references" }],
      outputOf,
      isVideoUrl,
    })
    expect(refs.filter((r) => r.id === "img1")).toHaveLength(1)
  })

  it("skips a source whose output is not a URL — an unresolved handle would 400 the route", () => {
    const refs = resolveScene3DReferences({ nodeId: "scene", edges, outputOf, isVideoUrl })
    expect(refs.some((r) => r.id === "txt1")).toBe(false)
  })
})

describe("checkScene3DReferenceLimit", () => {
  const make = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `r${i}`,
      url: `https://cdn.example.com/${i}.png`,
      kind: "image" as const,
      role: "appearance" as const,
    }))

  it("passes a set within the wire limit", () => {
    expect(checkScene3DReferenceLimit(make(SCENE3D_LIMITS.maxReferences)).ok).toBe(true)
  })

  /**
   * REFUSES rather than trims. Silently sending the first 8 of 11 references
   * charges the user for a run they did not wire, and the three that got
   * dropped are the ones they added last — the failure is invisible in the
   * result. The message has to say how many to detach.
   */
  it("refuses an over-wired set BEFORE the request, and says what to do", () => {
    const result = checkScene3DReferenceLimit(make(SCENE3D_LIMITS.maxReferences + 3))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain(String(SCENE3D_LIMITS.maxReferences))
    expect(result.message).toContain("Detach 3")
  })
})
