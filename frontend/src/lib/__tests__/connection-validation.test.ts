import { describe, expect, it } from "vitest"
import { isValidWorkflowConnection } from "../connection-validation"
import { resolveTargetHandle, getCompatibleNodes } from "../node-compatibility"
import { NODE_DEFINITIONS } from "@/types/nodes"

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

// ─── cinematic-avatar ref-* connectivity (drop-time validator) ──────────
// Regression: cinematic-avatar renders ref-video / ref-audio / ref-image
// target handles, each accepting one media producer. The bug was that
// NODE_DEFINITIONS.inputs only listed "prompt", so source-direction
// enumeration never offered cinematic-avatar and resolveTargetHandle
// pointed at a non-existent "in" handle.
describe("cinematic-avatar ref-* connection validity", () => {
  const getType = (target: string, source: string) => (id: string) =>
    id === "ca1" ? "cinematic-avatar" : (id === "src" ? source : target)

  it("accepts a video producer on ref-video", () => {
    const ok = isValidWorkflowConnection(
      { source: "src", target: "ca1", sourceHandle: "video", targetHandle: "ref-video" },
      getType("cinematic-avatar", "generate-video"),
    )
    expect(ok).toBe(true)
  })

  it("accepts an audio producer on ref-audio", () => {
    const ok = isValidWorkflowConnection(
      { source: "src", target: "ca1", sourceHandle: "audio", targetHandle: "ref-audio" },
      getType("cinematic-avatar", "text-to-speech"),
    )
    expect(ok).toBe(true)
  })

  it("accepts an image producer on ref-image", () => {
    const ok = isValidWorkflowConnection(
      { source: "src", target: "ca1", sourceHandle: "image", targetHandle: "ref-image" },
      getType("cinematic-avatar", "generate-image"),
    )
    expect(ok).toBe(true)
  })

  it("rejects an audio producer on ref-video (wrong media type)", () => {
    const ok = isValidWorkflowConnection(
      { source: "src", target: "ca1", sourceHandle: "audio", targetHandle: "ref-video" },
      getType("cinematic-avatar", "text-to-speech"),
    )
    expect(ok).toBe(false)
  })
})

// ─── ai-avatar typed input connectivity (drop-time validator) ───────────
describe("ai-avatar typed input connection validity", () => {
  const getType = (source: string) => (id: string) =>
    id === "aa1" ? "ai-avatar" : (id === "src" ? source : "preview")

  it("accepts a text producer on script", () => {
    const ok = isValidWorkflowConnection(
      { source: "src", target: "aa1", sourceHandle: "text", targetHandle: "script" },
      getType("text-prompt"),
    )
    expect(ok).toBe(true)
  })

  it("rejects a parameter picker (mood) on script (verbatim text only, no picker prose)", () => {
    const ok = isValidWorkflowConnection(
      { source: "src", target: "aa1", sourceHandle: "out", targetHandle: "script" },
      getType("mood"),
    )
    expect(ok).toBe(false)
  })

  it("accepts an image producer on image", () => {
    const ok = isValidWorkflowConnection(
      { source: "src", target: "aa1", sourceHandle: "image", targetHandle: "image" },
      getType("generate-image"),
    )
    expect(ok).toBe(true)
  })

  it("accepts an audio producer on audio", () => {
    const ok = isValidWorkflowConnection(
      { source: "src", target: "aa1", sourceHandle: "audio", targetHandle: "audio" },
      getType("text-to-speech"),
    )
    expect(ok).toBe(true)
  })
})

// ─── Source-direction enumeration + handle resolution ───────────────────
// Mirrors dragging a wire OUT of a producer: cinematic-avatar must surface
// as a candidate consumer AND resolveTargetHandle must point the wire at
// the correct ref-* handle (not the non-existent "in").
describe("cinematic-avatar source-direction connectivity", () => {
  const options = NODE_DEFINITIONS.map((d) => ({
    type: d.type,
    label: d.label,
    icon: null,
    category: d.category,
  }))

  it("resolveTargetHandle maps video → ref-video", () => {
    expect(resolveTargetHandle("cinematic-avatar", "video", "source")).toBe("ref-video")
  })

  it("resolveTargetHandle maps audio → ref-audio", () => {
    expect(resolveTargetHandle("cinematic-avatar", "audio", "source")).toBe("ref-audio")
  })

  it("resolveTargetHandle maps image → ref-image", () => {
    expect(resolveTargetHandle("cinematic-avatar", "image", "source")).toBe("ref-image")
  })

  it("a video producer dragging out offers cinematic-avatar as a candidate", () => {
    const { directTypes } = getCompatibleNodes("video", "source", options)
    expect(directTypes.has("cinematic-avatar")).toBe(true)
  })

  it("an image producer dragging out offers cinematic-avatar as a candidate", () => {
    const { directTypes } = getCompatibleNodes("image", "source", options)
    expect(directTypes.has("cinematic-avatar")).toBe(true)
  })

  it("an audio producer dragging out offers cinematic-avatar as a candidate", () => {
    const { directTypes } = getCompatibleNodes("audio", "source", options)
    expect(directTypes.has("cinematic-avatar")).toBe(true)
  })
})

// Phase 4: the motion-graphics `lottie` source handle (lottie engine) carries
// the authored Lottie JSON URL and may ONLY feed a lottie-overlay `lottie`
// target. Symmetric to the `composition` source rule.
describe("motion-graphics lottie source handle connectivity", () => {
  const typeOf = (id: string) =>
    id === "mg" ? "motion-graphics" : id === "lo" ? "lottie-overlay" : id === "rv" ? "render-video" : "generate-image"

  it("allows motion-graphics lottie → lottie-overlay lottie", () => {
    const ok = isValidWorkflowConnection(
      { source: "mg", target: "lo", sourceHandle: "lottie", targetHandle: "lottie" },
      typeOf,
    )
    expect(ok).toBe(true)
  })

  it("rejects the lottie source onto render-video (composition consumer)", () => {
    const ok = isValidWorkflowConnection(
      { source: "mg", target: "rv", sourceHandle: "lottie", targetHandle: "composition" },
      typeOf,
    )
    expect(ok).toBe(false)
  })

  it("rejects the lottie source onto a non-lottie target handle of lottie-overlay", () => {
    const ok = isValidWorkflowConnection(
      { source: "mg", target: "lo", sourceHandle: "lottie", targetHandle: "video" },
      typeOf,
    )
    expect(ok).toBe(false)
  })

  it("lottie-overlay lottie target accepts motion-graphics but not arbitrary producers", () => {
    expect(
      isValidWorkflowConnection(
        { source: "mg", target: "lo", sourceHandle: "lottie", targetHandle: "lottie" },
        typeOf,
      ),
    ).toBe(true)
    // An image producer dragging into the lottie target (no sourceHandle "lottie"
    // restriction on its side) must be rejected by the target predicate.
    expect(
      isValidWorkflowConnection(
        { source: "gi", target: "lo", sourceHandle: "image", targetHandle: "lottie" },
        (id: string) => (id === "lo" ? "lottie-overlay" : "generate-image"),
      ),
    ).toBe(false)
  })

  it("a motion-graphics node dragging out offers lottie-overlay as a candidate", () => {
    const options = NODE_DEFINITIONS.map((d) => ({ type: d.type, label: d.label, icon: null, category: d.category }))
    const { directTypes } = getCompatibleNodes("lottie", "source", options)
    expect(directTypes.has("lottie-overlay")).toBe(true)
  })

  it("the lottie target's add-node popup offers motion-graphics as a candidate", () => {
    const options = NODE_DEFINITIONS.map((d) => ({ type: d.type, label: d.label, icon: null, category: d.category }))
    const { directTypes } = getCompatibleNodes("lottie", "target", options, "lottie-overlay")
    expect(directTypes.has("motion-graphics")).toBe(true)
  })
})
