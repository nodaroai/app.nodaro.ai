import { describe, it, expect } from "vitest"
import { resolveFieldMappings } from "../resolve-field-mappings.js"
import { getEffectiveSunoCustomMode } from "@nodaro/shared"
import type { NodeExecutionState, SimpleNode, SimpleEdge } from "../types.js"

describe("suno wired field engages custom mode (BE)", () => {
  it("resolves data.lyrics then custom mode is true", () => {
    const states: Record<string, NodeExecutionState> = {
      src: { nodeType: "text-prompt", output: { text: "verse 1" } } as unknown as NodeExecutionState,
    }
    const nodes = [
      { id: "src", type: "text-prompt", data: { text: "verse 1" } },
      { id: "suno", type: "suno-generate", data: { prompt: "song", lyrics: "" } },
    ] as unknown as SimpleNode[]
    const edges = [{ source: "src", target: "suno", sourceHandle: "out", targetHandle: "field-lyrics" }] as unknown as SimpleEdge[]
    const resolved = resolveFieldMappings({ prompt: "song", lyrics: "" }, states, nodes, "song", ["lyrics"], "suno", edges)
    expect(resolved.lyrics).toBe("verse 1")
    expect(getEffectiveSunoCustomMode(resolved)).toBe(true)
  })

  it("does NOT auto-flip when customMode is explicitly false", () => {
    const resolved = resolveFieldMappings({ prompt: "song", lyrics: "x", customMode: false }, {}, [], "song", ["lyrics"])
    expect(getEffectiveSunoCustomMode(resolved)).toBe(false)
  })
})
