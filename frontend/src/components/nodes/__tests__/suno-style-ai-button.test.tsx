import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { SunoStyleAiButton } from "../suno-style-ai-button"
import { useWorkflowStore } from "@/hooks/use-workflow-store"

// PromptHelperButton self-gates on hasCredits(); force it true for the render.
vi.mock("@/lib/edition", async (orig) => ({ ...(await orig()), hasCredits: () => true }))

function seed(data: Record<string, unknown>) {
  useWorkflowStore.setState({
    nodes: [
      {
        id: "n1",
        type: "suno-generate",
        position: { x: 0, y: 0 },
        data: { label: "S", model: "V5", ...data },
      },
    ] as any,
    edges: [],
  } as any)
}

describe("SunoStyleAiButton", () => {
  beforeEach(() => seed({}))

  it("renders the AI button for an unwired style field", () => {
    render(<SunoStyleAiButton nodeId="n1" />)
    expect(screen.getByRole("button", { name: /ai/i })).toBeInTheDocument()
  })

  it("renders nothing when style is wired", () => {
    seed({ fieldMappings: { style: { sourceNodeId: "x" } } })
    const { container } = render(<SunoStyleAiButton nodeId="n1" />)
    expect(container.querySelector("button")).toBeNull()
  })
})
