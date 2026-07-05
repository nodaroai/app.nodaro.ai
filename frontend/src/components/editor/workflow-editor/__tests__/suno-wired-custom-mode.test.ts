import { describe, it, expect } from "vitest"
import { resolveFieldMappings } from "../resolve-field-mappings"
import { getEffectiveSunoCustomMode } from "@nodaro/prompts"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

describe("suno wired field engages custom mode (FE)", () => {
  it("resolved data.style from a field-style edge → effective custom mode true", () => {
    const nodes = [
      { id: "src", type: "text-prompt", position: { x: 0, y: 0 }, data: { text: "lofi beats" } },
      { id: "suno", type: "suno-generate", position: { x: 0, y: 0 }, data: { prompt: "song", style: "" } },
    ] as unknown as WorkflowNode[]
    const edges = [{ id: "e", source: "src", target: "suno", sourceHandle: "out", targetHandle: "field-style" }] as unknown as WorkflowEdge[]
    const before = getEffectiveSunoCustomMode({ prompt: "song", style: "" })
    expect(before).toBe(false)
    const resolved = resolveFieldMappings({ prompt: "song", style: "" }, nodes, "song", ["style"], "suno", edges)
    expect(resolved.style).toBe("lofi beats")
    expect(getEffectiveSunoCustomMode(resolved)).toBe(true)
  })
})
