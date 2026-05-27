import { describe, expect, it } from "vitest"
import { isValidWorkflowConnection } from "../connection-validation"

describe("isValidWorkflowConnection (generate-video dispatch)", () => {
  it("dispatches to generate-video validator for generate-video target", () => {
    const ok = isValidWorkflowConnection(
      {
        source: "src",
        target: "gv1",
        sourceHandle: "image",
        targetHandle: "startFrame",
      },
      (id: string) => (id === "gv1" ? "generate-video" : "generate-image"),
    )
    expect(ok).toBe(true)
  })

  it("refuses video producer on startFrame (image-only)", () => {
    const ok = isValidWorkflowConnection(
      {
        source: "src",
        target: "gv1",
        sourceHandle: "video",
        targetHandle: "startFrame",
      },
      // Both src + target are generate-video — source produces video,
      // and startFrame is image-only.
      (_id: string) => "generate-video",
    )
    expect(ok).toBe(false)
  })

  it("accepts video producer on videoReferences", () => {
    const ok = isValidWorkflowConnection(
      {
        source: "src",
        target: "gv1",
        sourceHandle: "video",
        targetHandle: "videoReferences",
      },
      (_id: string) => "generate-video",
    )
    expect(ok).toBe(true)
  })

  it("still dispatches to generate-image for generate-image target", () => {
    // Sanity: the new arm doesn't break the existing image dispatch.
    const ok = isValidWorkflowConnection(
      {
        source: "src",
        target: "gi1",
        sourceHandle: "image",
        targetHandle: "references",
      },
      (id: string) => (id === "gi1" ? "generate-image" : "generate-image"),
    )
    expect(ok).toBe(true)
  })
})
