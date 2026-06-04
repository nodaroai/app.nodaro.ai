import { describe, it, expect, vi, beforeEach } from "vitest"
import { render } from "@testing-library/react"

const updateNodeData = vi.fn()
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (sel: any) => sel({ updateNodeData }),
}))

// Stub the Radix Select to plain elements so we can assert render-vs-hide and
// the self-correcting effect without portals/pointer plumbing.
vi.mock("@/components/ui/select", () => ({
  Select: ({ children, value }: any) => (
    <div data-testid="select" data-value={value ?? ""}>{children}</div>
  ),
  SelectTrigger: ({ children }: any) => <div data-testid="select-trigger">{children}</div>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => <div data-testid={`item-${value}`}>{children}</div>,
  SelectValue: ({ children }: any) => <span>{children}</span>,
}))

import { QuickConfigSelect, type QuickConfigControl } from "../node-quick-configs"

// A provider-aware control mirroring video-to-video's resolution: runway-aleph
// has no resolution lever (returns []), every other provider gets 720p/1080p.
const control: QuickConfigControl = {
  field: "v2vResolution",
  ariaLabel: "Resolution",
  options: (data) =>
    data.provider === "runway-aleph"
      ? []
      : [
          { value: "720p", label: "720p" },
          { value: "1080p", label: "1080p" },
        ],
}

beforeEach(() => updateNodeData.mockClear())

describe("QuickConfigSelect provider-aware fail-safe", () => {
  it("hides the control AND clears a stale value when the provider has no lever", () => {
    const { queryByTestId } = render(
      <QuickConfigSelect nodeId="n1" control={control} value="1080p" data={{ provider: "runway-aleph" }} />,
    )
    expect(queryByTestId("select")).toBeNull()
    expect(updateNodeData).toHaveBeenCalledWith("n1", { v2vResolution: undefined })
  })

  it("snaps an out-of-range value to the first valid option for the current provider", () => {
    render(<QuickConfigSelect nodeId="n1" control={control} value="4k" data={{ provider: "wan" }} />)
    expect(updateNodeData).toHaveBeenCalledWith("n1", { v2vResolution: "720p" })
  })

  it("leaves a valid value untouched and renders the dropdown", () => {
    const { getByTestId } = render(
      <QuickConfigSelect nodeId="n1" control={control} value="1080p" data={{ provider: "wan" }} />,
    )
    expect(getByTestId("select")).toBeInTheDocument()
    expect(updateNodeData).not.toHaveBeenCalled()
  })

  it("does not write when the field is unset (no surprise default)", () => {
    render(<QuickConfigSelect nodeId="n1" control={control} value="" data={{ provider: "wan" }} />)
    expect(updateNodeData).not.toHaveBeenCalled()
  })

  it("supports plain static option arrays (no provider awareness)", () => {
    const staticControl: QuickConfigControl = {
      field: "provider",
      ariaLabel: "Model",
      options: [{ value: "minimax", label: "MiniMax" }],
    }
    const { getByTestId } = render(
      <QuickConfigSelect nodeId="n1" control={staticControl} value="minimax" data={{}} />,
    )
    expect(getByTestId("select")).toBeInTheDocument()
    expect(updateNodeData).not.toHaveBeenCalled()
  })
})
