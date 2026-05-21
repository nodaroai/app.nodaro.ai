import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

// Mock ObjectAssetTab so we can spy on the props the wrapper passes through.
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

import { AnglesTab } from "../angles-tab"
import type { ObjectStudioState } from "../use-object-studio"

const mockStudio = {} as ObjectStudioState

describe("AnglesTab", () => {
  it("composes ObjectAssetTab with tabKind=angles and the 9 angles presets", () => {
    render(<AnglesTab studio={mockStudio} />)
    expect(screen.getByTestId("object-asset-tab-mock")).toBeInTheDocument()
    expect(mockAssetTab).toHaveBeenCalledWith(
      expect.objectContaining({
        tabKind: "angles",
        presets: [
          "front",
          "side",
          "top",
          "back",
          "three-quarter",
          "detail",
          "in-context",
          "exploded",
          "perspective",
        ],
        iconLabel: expect.stringMatching(/angles/i),
      }),
    )
  })
})
