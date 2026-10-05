import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import type { WorkflowNode } from "@/types/nodes"
import { exposedFieldValue, findExposableField } from "../helpers"
import { FieldInputCard } from "../field-input-card"

/** A Text to Speech node saved WITHOUT its voice settings — built by MCP, imported, or an older workflow. */
const bare = {
  id: "t1",
  type: "text-to-speech",
  position: { x: 0, y: 0 },
  data: { label: "Narration", provider: "elevenlabs-turbo" },
} as unknown as WorkflowNode

const startValue = (node: WorkflowNode, storedKey: string, runValues?: Record<string, unknown>) =>
  exposedFieldValue(node, storedKey, runValues, findExposableField(node, storedKey)!)

describe("a Text to Speech card for a node saved without the field", () => {
  it("starts at the node's default (0.5 / 0.75), not at the slider's minimum", () => {
    expect(startValue(bare, "stability")).toBe(0.5)
    expect(startValue(bare, "similarityBoost")).toBe(0.75)
  })

  it("an app published with the old Similarity key starts there too", () => {
    expect(startValue(bare, "similarity")).toBe(0.75)
  })

  it("the node's own value, then this run's value, still win over the default", () => {
    const saved = { ...bare, data: { ...(bare.data as object), stability: 0.3, similarityBoost: 0.9 } } as unknown as WorkflowNode
    expect(startValue(saved, "stability")).toBe(0.3)
    expect(startValue(saved, "similarityBoost")).toBe(0.9)
    expect(startValue(saved, "stability", { stability: 0.6 })).toBe(0.6)
  })

  it("the Stability card renders 0.5", () => {
    const def = findExposableField(bare, "stability")!
    render(<FieldInputCard field={def} value={startValue(bare, "stability")} onChange={vi.fn()} />)
    expect(Number((screen.getByRole("slider") as HTMLInputElement).value)).toBeCloseTo(0.5, 5)
    expect(screen.getByText("0.5")).toBeInTheDocument()
  })
})
