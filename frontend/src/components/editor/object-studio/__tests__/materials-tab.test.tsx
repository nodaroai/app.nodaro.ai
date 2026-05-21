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

import { MaterialsTab } from "../materials-tab"
import type { ObjectStudioState } from "../use-object-studio"

const mockStudio = {} as ObjectStudioState

describe("MaterialsTab", () => {
  it("composes ObjectAssetTab with tabKind=materials and the 13 materials presets", () => {
    render(<MaterialsTab studio={mockStudio} />)
    expect(screen.getByTestId("object-asset-tab-mock")).toBeInTheDocument()
    expect(mockAssetTab).toHaveBeenCalledWith(
      expect.objectContaining({
        tabKind: "materials",
        presets: [
          "wood",
          "metal",
          "glass",
          "plastic",
          "fabric",
          "stone",
          "ceramic",
          "leather",
          "paper",
          "gold",
          "silver",
          "copper",
          "marble",
        ],
        iconLabel: expect.stringMatching(/materials/i),
      }),
    )
  })
})
