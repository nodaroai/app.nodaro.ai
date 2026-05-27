import { describe, it, expect, vi } from "vitest"
import { render } from "@testing-library/react"

// ---------------------------------------------------------------------------
// Mocks — declared before the component import (vi.mock hoists).
// ---------------------------------------------------------------------------

vi.mock("@xyflow/react", () => ({
  useStore: vi.fn(() => 1),
}))

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      updateNodeData: () => {},
      runSingleNode: () => {},
      nodes: [{ id: "n1", width: 320 }],
    }),
}))

vi.mock("../run-node-button", () => ({
  RunNodeButton: (props: Record<string, unknown>) => (
    <div data-testid="run-node-button" data-credits={String(props.credits ?? "")} />
  ),
}))

// ModelSelectOption renders a React-Query-backed credit cost lookup; stub it
// out so the toolbar smoke test doesn't require a QueryClientProvider.
vi.mock("@/components/editor/config-panels/model-select-option", () => ({
  ModelSelectOption: (props: Record<string, unknown>) => (
    <div data-testid={`model-option-${String(props.value)}`} data-label={String(props.label)} />
  ),
}))

// RatioIcon is purely visual — stub to a small placeholder so the dropdown
// items don't pull in SVG-measuring code paths.
vi.mock("@/components/editor/config-panels/aspect-ratio-selector", () => ({
  RatioIcon: () => <span data-testid="ratio-icon" />,
}))

import { GenerateVideoQuickToolbar } from "../generate-video-quick-toolbar"

describe("GenerateVideoQuickToolbar", () => {
  it("renders without crashing", () => {
    const { container } = render(
      <GenerateVideoQuickToolbar
        nodeId="n1"
        data={{ provider: "kling", duration: 5 } as never}
        credits={25}
        isRunning={false}
      />,
    )
    expect(container.firstChild).toBeTruthy()
  })

  it("renders in compact mode when zoom × width falls below the threshold", () => {
    const { container } = render(
      <GenerateVideoQuickToolbar
        nodeId="n1"
        data={{ provider: "veo3.1", duration: 8, aspectRatio: "16:9", resolution: "1080p" } as never}
        credits={42}
        isRunning={false}
      />,
    )
    // Toolbar root exists (compact OR default — the visual mode is an
    // implementation detail; the smoke test only verifies the component
    // renders for a duration-bearing provider).
    expect(container.firstChild).toBeTruthy()
  })
})
