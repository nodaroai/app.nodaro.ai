import { describe, it, expect } from "vitest"
import { migrateGenerateImageHandles } from "../generate-image-handle-migration.js"

const n = (id: string, type: string) => ({ id, type })
const e = (id: string, source: string, target: string, targetHandle: string | null) => ({
  id,
  source,
  target,
  sourceHandle: "out",
  targetHandle,
})

describe("backend migrateGenerateImageHandles", () => {
  it("routes text-producer 'in' → 'prompt'", () => {
    const out = migrateGenerateImageHandles(
      [n("tp", "text-prompt"), n("g", "generate-image")],
      [e("e1", "tp", "g", "in")],
    )
    expect(out[0].targetHandle).toBe("prompt")
  })
  it("routes image-producer 'in' → 'references'", () => {
    const out = migrateGenerateImageHandles(
      [n("u", "upload-image"), n("g", "generate-image")],
      [e("e1", "u", "g", "in")],
    )
    expect(out[0].targetHandle).toBe("references")
  })
  it("routes identity 'in' → 'assets'", () => {
    const out = migrateGenerateImageHandles(
      [n("c", "character"), n("g", "generate-image")],
      [e("e1", "c", "g", "in")],
    )
    expect(out[0].targetHandle).toBe("assets")
  })
  it("routes 'cinematography' → 'look' for Look-family pickers", () => {
    const out = migrateGenerateImageHandles(
      [n("l", "lens"), n("g", "generate-image")],
      [e("e1", "l", "g", "cinematography")],
    )
    expect(out[0].targetHandle).toBe("look")
  })
  it("routes 'cinematography' → 'elements' for Subject/Object pickers", () => {
    const out = migrateGenerateImageHandles(
      [n("p", "person"), n("g", "generate-image")],
      [e("e1", "p", "g", "cinematography")],
    )
    expect(out[0].targetHandle).toBe("elements")
  })
  it("renames legacy 'subjects' handle to 'assets'", () => {
    const out = migrateGenerateImageHandles(
      [n("c", "character"), n("g", "generate-image")],
      [e("e1", "c", "g", "subjects")],
    )
    expect(out[0].targetHandle).toBe("assets")
  })
  it("idempotent", () => {
    const nodes = [n("tp", "text-prompt"), n("g", "generate-image")]
    const edges = [e("e1", "tp", "g", "in")]
    const first = migrateGenerateImageHandles(nodes, edges)
    const second = migrateGenerateImageHandles(nodes, first)
    expect(second).toEqual(first)
  })
  it("leaves non-generate-image targets untouched", () => {
    const out = migrateGenerateImageHandles(
      [n("tp", "text-prompt"), n("li", "list")],
      [e("e1", "tp", "li", "in")],
    )
    expect(out[0].targetHandle).toBe("in")
  })
})
