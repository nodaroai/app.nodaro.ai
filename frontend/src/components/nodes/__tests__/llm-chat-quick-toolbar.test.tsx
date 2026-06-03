import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"

const xyflow = vi.hoisted(() => ({ zoom: 1 }))
vi.mock("@xyflow/react", () => ({
  useStore: vi.fn((selector: (s: { transform: number[] }) => unknown) => selector({ transform: [0, 0, xyflow.zoom] })),
}))

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      updateNodeData: () => {},
      runSingleNode: () => {},
      userTextTemplates: [],
      nodes: [{ id: "n1", width: 260 }],
    }),
}))

vi.mock("../run-node-button", () => ({
  RunNodeButton: (props: Record<string, unknown>) => (
    <div data-testid="run-node-button" data-credits={String(props.credits ?? "")} />
  ),
}))

import { LlmChatQuickToolbar } from "../llm-chat-quick-toolbar"

describe("LlmChatQuickToolbar", () => {
  beforeEach(() => {
    xyflow.zoom = 1
  })

  it("renders the model, template, runs, and run controls", () => {
    render(
      <LlmChatQuickToolbar
        nodeId="n1"
        data={{ llmModel: "gemini-3-flash", templateId: "custom", repeatCount: 2 } as never}
        credits={3}
        isRunning={false}
      />,
    )
    expect(screen.getByTestId("run-node-button")).toBeInTheDocument()
    expect(screen.getByText("Gemini 3 Flash")).toBeInTheDocument()
    expect(screen.getByText("Custom")).toBeInTheDocument()
    expect(screen.getByText("× 2")).toBeInTheDocument()
  })

  it("renders for a premium model + saved-template default without crashing", () => {
    const { container } = render(
      <LlmChatQuickToolbar
        nodeId="n1"
        data={{ llmModel: "claude-opus-4.7" } as never}
        credits={15}
        isRunning={false}
      />,
    )
    expect(container.firstChild).toBeTruthy()
  })

  it("collapses to the compact settings pill when zoomed out", () => {
    xyflow.zoom = 0.3 // visibleNodeWidth = 260 * 0.3 = 78; 360 > 78*1.5 → compact
    render(
      <LlmChatQuickToolbar
        nodeId="n1"
        data={{ llmModel: "gemini-3-flash", templateId: "custom", repeatCount: 1 } as never}
        credits={3}
        isRunning={false}
      />,
    )
    expect(screen.getByTitle("Settings")).toBeInTheDocument()
    expect(screen.queryByTitle("AI model")).not.toBeInTheDocument()
    expect(screen.getByTestId("run-node-button")).toBeInTheDocument()
  })
})
