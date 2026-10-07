import { describe, it, expect } from "vitest"
// Through the package index: the shared handle typing both canvas validators
// and the server's edge normalization read (decided 2026-10-07).
import {
  RENDER_NODE_TYPES,
  jsonInputKind,
  jsonKindMismatch,
  jsonKindMismatchMessage,
  jsonOutputKind,
  type RenderNodeDescriptor,
} from "../index.js"

describe("jsonOutputKind — what a json output carries", () => {
  it("Edit Plan's edl and Camera Switch's edl are EDLs; Camera Switch's transcript is a Transcript", () => {
    expect(jsonOutputKind("edit-plan", "edl")).toBe("edl")
    expect(jsonOutputKind("camera-switch", "edl")).toBe("edl")
    expect(jsonOutputKind("camera-switch", "transcript")).toBe("transcript")
  })

  it("a Transcribe's json is a Transcript (decided 2026-10-08), its text is not a kind", () => {
    expect(jsonOutputKind("transcribe", "json")).toBe("transcript")
    expect(jsonOutputKind("transcribe", undefined)).toBe("transcript")
    expect(jsonOutputKind("transcribe", "text")).toBeUndefined()
  })

  it("reads a render's json pip from the render registry (jsonKind), never a node-name list", () => {
    expect(jsonOutputKind("apply-edl", "json")).toBe("transcript")
    // a render registered later with an EDL-emitting json (Speaker View)
    const speakerLike = { ...RENDER_NODE_TYPES["apply-edl"]!, jsonKind: "edl" } as RenderNodeDescriptor
    expect(jsonOutputKind("speaker-view", "json", { "speaker-view": speakerLike })).toBe("edl")
    expect(jsonOutputKind("speaker-view", undefined, { "speaker-view": speakerLike })).toBe("edl")
  })

  it("every registered render's json pip answers its own jsonKind", () => {
    for (const [type, d] of Object.entries(RENDER_NODE_TYPES)) {
      expect(jsonOutputKind(type, "json")).toBe(d.jsonKind)
    }
  })

  it("an edge with no sourceHandle reads the node's primary pip", () => {
    expect(jsonOutputKind("edit-plan", undefined)).toBe("edl")
    expect(jsonOutputKind("camera-switch", null)).toBe("edl")
    expect(jsonOutputKind("apply-edl", undefined)).toBe("transcript")
  })

  it("is undefined for anything it does not know", () => {
    expect(jsonOutputKind("transcribe", "text")).toBeUndefined()
    expect(jsonOutputKind("edit-plan", "nope")).toBeUndefined()
    expect(jsonOutputKind("constructor", "json")).toBeUndefined()
    expect(jsonOutputKind(undefined, "json")).toBeUndefined()
  })
})

describe("jsonInputKind — what a json input expects", () => {
  it("a `transcript` input expects a Transcript, an `edl` input an EDL", () => {
    expect(jsonInputKind("add-captions", "transcript")).toBe("transcript")
    expect(jsonInputKind("apply-edl", "transcript")).toBe("transcript")
    expect(jsonInputKind("camera-switch", "transcript")).toBe("transcript")
    expect(jsonInputKind("edit-plan", "transcript")).toBe("transcript")
    expect(jsonInputKind("apply-edl", "edl")).toBe("edl")
  })

  it("is undefined for every other input", () => {
    expect(jsonInputKind("add-captions", "in")).toBeUndefined()
    expect(jsonInputKind("add-captions", "captionPlan")).toBeUndefined()
    expect(jsonInputKind("edit-plan", "silence")).toBeUndefined()
    expect(jsonInputKind("add-captions", undefined)).toBeUndefined()
  })
})

describe("jsonKindMismatch — an EDL is not a transcript", () => {
  it("blocks every EDL output into a Transcript input", () => {
    for (const [src, srcHandle] of [["edit-plan", "edl"], ["camera-switch", "edl"]] as const) {
      for (const [tgt, tgtHandle] of [["add-captions", "transcript"], ["apply-edl", "transcript"], ["camera-switch", "transcript"], ["edit-plan", "transcript"]] as const) {
        expect(jsonKindMismatch(src, srcHandle, tgt, tgtHandle), `${src}.${srcHandle} -> ${tgt}.${tgtHandle}`).toEqual({ output: "edl", input: "transcript" })
      }
    }
  })

  it("still lets a Transcript into a Transcript input, and an EDL into an EDL input", () => {
    expect(jsonKindMismatch("camera-switch", "transcript", "add-captions", "transcript")).toBeNull()
    expect(jsonKindMismatch("apply-edl", "json", "add-captions", "transcript")).toBeNull()
    expect(jsonKindMismatch("edit-plan", "edl", "apply-edl", "edl")).toBeNull()
    expect(jsonKindMismatch("camera-switch", "edl", "camera-switch", "edl")).toBeNull()
  })

  it("judges only what it can tell: an unknown source, a bare source handle, or another input is left alone", () => {
    expect(jsonKindMismatch("web-scrape", "json", "add-captions", "transcript")).toBeNull()
    expect(jsonKindMismatch("web-scrape", "json", "apply-edl", "edl")).toBeNull()
    expect(jsonKindMismatch("transcribe", "text", "apply-edl", "edl")).toBeNull()
    expect(jsonKindMismatch("transcribe", "json", "apply-edl", "sources")).toBeNull()
    expect(jsonKindMismatch("edit-plan", "edl", "add-captions", "captionPlan")).toBeNull()
    expect(jsonKindMismatch("edit-plan", "edl", "add-captions", "in")).toBeNull()
    expect(jsonKindMismatch("edit-plan", "edl", "add-captions", undefined)).toBeNull()
  })

  it("blocks every Transcript output into an EDL input (decided 2026-10-08), from the same table", () => {
    for (const [src, srcHandle] of [["transcribe", "json"], ["camera-switch", "transcript"], ["apply-edl", "json"]] as const) {
      for (const [tgt, tgtHandle] of [["apply-edl", "edl"], ["camera-switch", "edl"]] as const) {
        expect(jsonKindMismatch(src, srcHandle, tgt, tgtHandle), `${src}.${srcHandle} -> ${tgt}.${tgtHandle}`).toEqual({ output: "transcript", input: "edl" })
      }
    }
  })

  it("a Transcript-emitting render's json is blocked from an EDL input too (registry-driven)", () => {
    const d = { ...RENDER_NODE_TYPES["apply-edl"]!, jsonKind: "transcript" } as RenderNodeDescriptor
    expect(jsonKindMismatch("r", "json", "apply-edl", "edl", { r: d })).toEqual({ output: "transcript", input: "edl" })
  })

  it("an EDL-emitting render's json is blocked from a Transcript input too", () => {
    const speakerLike = { ...RENDER_NODE_TYPES["apply-edl"]!, jsonKind: "edl" } as RenderNodeDescriptor
    expect(jsonKindMismatch("speaker-view", "json", "add-captions", "transcript", { "speaker-view": speakerLike })).toEqual({ output: "edl", input: "transcript" })
  })

  it("says what to do instead, naming both nodes", () => {
    const m = jsonKindMismatch("edit-plan", "edl", "add-captions", "transcript")!
    const msg = jsonKindMismatchMessage(m, { sourceLabel: "Edit Plan", targetLabel: "Add Captions" })
    expect(msg).toContain("Edit Plan")
    expect(msg).toContain("Add Captions")
    expect(msg).toMatch(/edit list|EDL/)
    expect(msg).toMatch(/not a transcript/i)
    expect(msg).toMatch(/Transcribe/)
  })

  it("the reverse direction says so: a transcript is not an edit list, and points at an EDL source", () => {
    const m = jsonKindMismatch("transcribe", "json", "apply-edl", "edl")!
    const msg = jsonKindMismatchMessage(m, { sourceLabel: "Transcribe", targetLabel: "Apply EDL" })
    expect(msg).toContain("Transcribe")
    expect(msg).toContain("Apply EDL")
    expect(msg).toMatch(/outputs a transcript/i)
    expect(msg).toMatch(/not an edit list/i)
    expect(msg).toMatch(/EDL input/)
    expect(msg).toMatch(/Edit Plan/)
    expect(msg).not.toMatch(/not a transcript/i)
  })
})
