import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import type { WorkflowNode } from "@/types/nodes"
import { exposedFieldDataKey, exposedFieldValue, findExposableField } from "../helpers"
import { FieldInputCard } from "../field-input-card"

const tts = {
  id: "t1",
  type: "text-to-speech",
  position: { x: 0, y: 0 },
  data: { stability: 0.5, similarityBoost: 0.75 },
} as unknown as WorkflowNode
const def = findExposableField(tts, "similarityBoost")!

describe("exposedFieldDataKey", () => {
  it("is the node's data field, whichever spelling the app stored", () => {
    expect(exposedFieldDataKey(tts, "similarity")).toBe("similarityBoost")
    expect(exposedFieldDataKey(tts, "similarityBoost")).toBe("similarityBoost")
    expect(exposedFieldDataKey(tts, "stability")).toBe("stability")
    expect(exposedFieldDataKey(undefined, "similarity")).toBe("similarity")
  })
})

describe("exposedFieldValue", () => {
  it("shows the node's own value — not the slider minimum a missing key fell back to", () => {
    expect(exposedFieldValue(tts, "similarityBoost", undefined, def)).toBe(0.75)
    expect(exposedFieldValue(tts, "similarity", undefined, def)).toBe(0.75)
  })

  it("a run's value wins over the node's, under either spelling; the current key wins over its legacy twin", () => {
    expect(exposedFieldValue(tts, "similarity", { similarityBoost: 0.2 }, def)).toBe(0.2)
    expect(exposedFieldValue(tts, "similarity", { similarity: 0.4 }, def)).toBe(0.4) // a run slot saved before the rename
    expect(exposedFieldValue(tts, "similarity", { similarity: 0.4, similarityBoost: 0.2 }, def)).toBe(0.2)
  })

  it("falls back to the descriptor default last", () => {
    const bare = { ...tts, data: {} } as unknown as WorkflowNode
    expect(exposedFieldValue(bare, "similarityBoost", undefined, { ...def, defaultValue: 0.6 })).toBe(0.6)
  })
})

describe("the legacy card", () => {
  it("renders the node's real value, labelled Similarity, instead of the slider minimum", () => {
    const legacyDef = findExposableField(tts, "similarity")!
    render(
      <FieldInputCard
        field={legacyDef}
        value={exposedFieldValue(tts, "similarity", undefined, legacyDef)}
        onChange={vi.fn()}
      />,
    )
    expect(Number((screen.getByRole("slider") as HTMLInputElement).value)).toBeCloseTo(0.75, 5)
    expect(screen.getByText("0.75")).toBeInTheDocument() // the card's own readout
    expect(screen.getByText("Similarity")).toBeInTheDocument()
  })
})
