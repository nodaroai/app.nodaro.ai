/**
 * Storyboard controls on the Image Collage config panel: the "Number images"
 * Switch writes `numbered` with an `undefined` off-value (keeps a workflow that
 * never used it byte-identical), and the per-row Label input writes/deletes
 * `imageLabelBySource[sourceId]` — the same source-keyed map that
 * execute-node.ts aligns to the wire order. Mirrors advanced-mode-toggle.test.
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ImageCollageConfig } from "../processing-configs"
import type { SourceNodeInfo } from "../types"
import type { ImageCollageData } from "@/types/nodes"

function makeData(overrides: Partial<ImageCollageData> = {}): ImageCollageData {
  return {
    label: "Image Collage",
    layout: "smart",
    resolution: "2K",
    aspectRatio: "4:3",
    gap: 24,
    backgroundColor: "#ffffff",
    fieldMappings: {},
    ...overrides,
  } as ImageCollageData
}

function setup(
  data: ImageCollageData,
  sources: ReadonlyArray<SourceNodeInfo> = [],
) {
  const onUpdate = vi.fn()
  render(
    <ImageCollageConfig
      data={data}
      onUpdate={onUpdate}
      sources={sources}
      fieldMappings={{}}
      onMapField={vi.fn()}
      nodes={[]}
    />,
  )
  return { onUpdate }
}

describe("Number images switch", () => {
  it("writes `true` when switched on", async () => {
    const { onUpdate } = setup(makeData())
    await userEvent.click(screen.getByRole("switch"))
    expect(onUpdate).toHaveBeenCalledWith({ numbered: true })
  })

  it("writes `undefined` (not false) when switched off", async () => {
    const { onUpdate } = setup(makeData({ numbered: true }))
    await userEvent.click(screen.getByRole("switch"))
    expect(onUpdate).toHaveBeenCalledWith({ numbered: undefined })
  })
})

describe("per-row Label input", () => {
  const source: SourceNodeInfo = {
    id: "src-1",
    type: "generate-image",
    label: "Wide shot",
    value: "http://a.png",
  }

  it("writes imageLabelBySource keyed by source id on input", async () => {
    const { onUpdate } = setup(makeData(), [source])
    const input = screen.getByPlaceholderText("Label (optional)")
    await userEvent.type(input, "X")
    expect(onUpdate).toHaveBeenLastCalledWith({
      imageLabelBySource: { "src-1": "X" },
    })
  })

  it("deletes the key when the label is cleared", async () => {
    const { onUpdate } = setup(
      makeData({ imageLabelBySource: { "src-1": "Close-up" } }),
      [source],
    )
    const input = screen.getByPlaceholderText("Label (optional)")
    // Backspace once from a single-char value clears it → key removed.
    await userEvent.clear(input)
    expect(onUpdate).toHaveBeenLastCalledWith({ imageLabelBySource: {} })
  })
})
