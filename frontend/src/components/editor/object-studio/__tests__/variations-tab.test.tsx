import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

const mockAssetTab = vi.fn()
vi.mock("../object-asset-tab", () => ({
  ObjectAssetTab: (props: { tabKind: string; presets: readonly string[]; iconLabel: string }) => {
    mockAssetTab(props)
    return (
      <div data-testid="object-asset-tab-mock">
        {props.iconLabel} / {props.tabKind} / {props.presets.join(",")}
      </div>
    )
  },
}))

import { VariationsTab } from "../variations-tab"
import type { ObjectStudioState } from "../use-object-studio"

const mockStudio = {} as ObjectStudioState

describe("VariationsTab", () => {
  it("composes ObjectAssetTab with tabKind=variations and the 11 variations presets", () => {
    render(<VariationsTab studio={mockStudio} />)
    expect(screen.getByTestId("object-asset-tab-mock")).toBeInTheDocument()
    expect(mockAssetTab).toHaveBeenCalledWith(
      expect.objectContaining({
        tabKind: "variations",
        presets: [
          "clean",
          "weathered",
          "damaged",
          "ornate",
          "minimal",
          "broken",
          "antique",
          "futuristic",
          "holographic",
          "dirty",
          "polished",
        ],
        iconLabel: expect.stringMatching(/variations/i),
      }),
    )
  })
})
