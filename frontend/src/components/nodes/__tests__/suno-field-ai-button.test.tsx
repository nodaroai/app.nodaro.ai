import { describe, it, expect, beforeEach, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { SunoFieldAiButton } from "../suno-field-ai-button"
import { useWorkflowStore } from "@/hooks/use-workflow-store"

// Unit-test the THIN wrapper in isolation: stub PromptHelperButton so we can
// assert exactly what SunoFieldAiButton hands it (the composite wizard nodeType
// + the per-field currentPrompt) and drive its onAccept WITHOUT spinning up the
// real LLM wizard dialog. The real PromptHelperButton (credit gating, dialog) is
// covered by its own tests; here we only verify the wrapper's per-field wiring.
vi.mock("@/components/editor/config-panels/prompt-helper-button", () => ({
  PromptHelperButton: ({ nodeType, currentPrompt, onAccept }: any) => (
    <button
      type="button"
      aria-label="Generate with AI"
      data-node-type={nodeType}
      data-current-prompt={currentPrompt}
      onClick={() => onAccept("GENERATED")}
    >
      Generate with AI
    </button>
  ),
}))

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

const nodeData = () =>
  useWorkflowStore.getState().nodes.find((n) => n.id === "n1")!.data as Record<string, unknown>

describe("SunoFieldAiButton", () => {
  beforeEach(() => seed({}))

  it("renders the AI button for an unwired field", () => {
    render(<SunoFieldAiButton nodeId="n1" field="negativeStyle" />)
    expect(screen.getByRole("button", { name: /ai/i })).toBeInTheDocument()
  })

  it("hides (renders nothing) when that field is wired", () => {
    seed({ fieldMappings: { negativeStyle: { sourceNodeId: "x" } } })
    const { container } = render(<SunoFieldAiButton nodeId="n1" field="negativeStyle" />)
    expect(container.querySelector("button")).toBeNull()
  })

  it("hides when the field is wired by a `field-<field>` canvas edge (edge-driven model)", () => {
    // After manual mapping was dropped, a field is wired (read-only) by a
    // `field-<field>` edge, not `fieldMappings`. The AI button must hide then too,
    // matching SunoField's read-only — else it wastes credits on an overridden write.
    useWorkflowStore.setState({
      nodes: [
        { id: "n1", type: "suno-generate", position: { x: 0, y: 0 }, data: { label: "S", model: "V5" } },
      ] as any,
      edges: [{ id: "e1", source: "t1", target: "n1", targetHandle: "field-style" }] as any,
    } as any)
    const { container } = render(<SunoFieldAiButton nodeId="n1" field="style" />)
    expect(container.querySelector("button")).toBeNull()
  })

  it("targets the composite wizard nodeType + reads the field's current value", () => {
    seed({ negativeStyle: "heavy metal" })
    render(<SunoFieldAiButton nodeId="n1" field="negativeStyle" />)
    const btn = screen.getByRole("button", { name: /ai/i })
    expect(btn.getAttribute("data-node-type")).toBe("suno-generate:negativeStyle")
    expect(btn.getAttribute("data-current-prompt")).toBe("heavy metal")
  })

  it("field=negativeStyle writes data.negativeStyle on accept (and only that field)", () => {
    render(<SunoFieldAiButton nodeId="n1" field="negativeStyle" />)
    fireEvent.click(screen.getByRole("button", { name: /ai/i }))
    expect(nodeData().negativeStyle).toBe("GENERATED")
    expect(nodeData().lyrics).toBeUndefined()
    expect(nodeData().style).toBeUndefined()
  })

  it("field=lyrics targets :lyrics and writes data.lyrics on accept", () => {
    render(<SunoFieldAiButton nodeId="n1" field="lyrics" />)
    const btn = screen.getByRole("button", { name: /ai/i })
    expect(btn.getAttribute("data-node-type")).toBe("suno-generate:lyrics")
    fireEvent.click(btn)
    expect(nodeData().lyrics).toBe("GENERATED")
    expect(nodeData().negativeStyle).toBeUndefined()
  })

  it("field=style still targets :style and writes data.style (Phase-D parity)", () => {
    render(<SunoFieldAiButton nodeId="n1" field="style" />)
    const btn = screen.getByRole("button", { name: /ai/i })
    expect(btn.getAttribute("data-node-type")).toBe("suno-generate:style")
    fireEvent.click(btn)
    expect(nodeData().style).toBe("GENERATED")
  })
})
