import { describe, it, expect, beforeEach, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { SunoField, isSunoFieldWired } from "../suno-field"
import { SunoFieldAiButton } from "@/components/nodes/suno-field-ai-button"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { WorkflowEdge } from "@/types/nodes"

// Stub PromptHelperButton so a VISIBLE SunoFieldAiButton renders a real <button>
// (so "hidden" === no button in the DOM is unambiguous). Mirrors the existing
// suno-field-ai-button.test.tsx stub.
vi.mock("@/components/editor/config-panels/prompt-helper-button", () => ({
  PromptHelperButton: ({ nodeType }: any) => (
    <button type="button" aria-label="Generate with AI" data-node-type={nodeType}>
      Generate with AI
    </button>
  ),
}))

const edge = (targetHandle: string, target = "n1"): WorkflowEdge =>
  ({ id: "e", source: "src", target, targetHandle } as unknown as WorkflowEdge)

/**
 * THE UNIFIED PREDICATE (Fix #2). One source of truth for "this Suno field is
 * wired" — an edge into the field's handle (bare `prompt` for the prompt field,
 * `field-<key>` for the four secondary fields) OR a legacy `fieldMappings[field]`
 * entry. The run's resolveFieldMappings honours BOTH, so the editor must too —
 * otherwise a fieldMappings-only field renders editable while the run overrides it.
 */
describe("isSunoFieldWired (unified wired predicate)", () => {
  it("a fieldMappings[field] entry with NO edge counts as wired (the drift being fixed)", () => {
    // This is the case that was previously editable in SunoField (edge-only) but
    // hidden in the AI button (edge OR fieldMappings) — the drift.
    const data = { fieldMappings: { style: { sourceNodeId: "x" } } }
    expect(isSunoFieldWired("style", data, [], "n1")).toBe(true)
  })

  it("a `field-<key>` edge into the secondary field's handle counts as wired", () => {
    expect(isSunoFieldWired("style", {}, [edge("field-style")], "n1")).toBe(true)
    expect(isSunoFieldWired("lyrics", {}, [edge("field-lyrics")], "n1")).toBe(true)
    expect(isSunoFieldWired("title", {}, [edge("field-title")], "n1")).toBe(true)
    expect(isSunoFieldWired("negativeStyle", {}, [edge("field-negativeStyle")], "n1")).toBe(true)
  })

  it("the prompt field keys on the BARE `prompt` handle (not `field-prompt`)", () => {
    expect(isSunoFieldWired("prompt", {}, [edge("prompt")], "n1")).toBe(true)
    // a `field-prompt` handle does NOT exist for the prompt field
    expect(isSunoFieldWired("prompt", {}, [edge("field-prompt")], "n1")).toBe(false)
  })

  it("the prompt field also honours a legacy fieldMappings[prompt] entry", () => {
    expect(isSunoFieldWired("prompt", { fieldMappings: { prompt: { sourceNodeId: "x" } } }, [], "n1")).toBe(true)
  })

  it("returns false with no edge + no mapping, for a wrong-handle edge, and for a different node", () => {
    expect(isSunoFieldWired("style", {}, [], "n1")).toBe(false)
    expect(isSunoFieldWired("style", {}, [edge("prompt")], "n1")).toBe(false) // wrong handle
    expect(isSunoFieldWired("style", {}, [edge("field-style", "OTHER")], "n1")).toBe(false) // other node
    expect(isSunoFieldWired("style", undefined, [], undefined)).toBe(false) // no node id
  })
})

// ── The behavioural tie (Fix #2): a field shows read-only EXACTLY when the AI
// button hides — both derived from the ONE predicate. ──
describe("read-only ⇔ AI-button-hidden (via the unified predicate)", () => {
  beforeEach(() => {
    useWorkflowStore.setState({
      nodes: [
        {
          id: "n1",
          type: "suno-generate",
          position: { x: 0, y: 0 },
          // Wired ONLY by fieldMappings (no edge) — the previously-drifting case.
          data: { label: "S", model: "V5", fieldMappings: { style: { sourceNodeId: "src" } } },
        },
      ] as any,
      edges: [] as any,
    } as any)
  })

  it("SunoField renders read-only (editor unmounted) for a fieldMappings-only field", () => {
    const data = useWorkflowStore.getState().nodes[0].data as { fieldMappings?: unknown }
    const wired = isSunoFieldWired("style", data, [], "n1")
    expect(wired).toBe(true) // the panel's `wired` prop is now the unified predicate

    render(
      <SunoField field="style" label="Style" wired={wired}>
        <div data-testid="editor">EDITABLE</div>
      </SunoField>,
    )
    // Read-only preview shown; the editable child is NOT mounted.
    expect(screen.getByText(/value comes from the connected handle/i)).toBeInTheDocument()
    expect(screen.queryByTestId("editor")).toBeNull()
  })

  it("SunoFieldAiButton hides (renders nothing) for the SAME fieldMappings-only field", () => {
    const { container } = render(<SunoFieldAiButton nodeId="n1" field="style" />)
    expect(container.querySelector("button")).toBeNull()
  })

  it("the AI button hides EXACTLY when isSunoFieldWired is true (matrix agreement)", () => {
    const cases: Array<{ edges: WorkflowEdge[]; data: Record<string, unknown> }> = [
      { edges: [], data: {} }, // unwired → visible
      { edges: [edge("field-style")], data: {} }, // edge → hidden
      { edges: [], data: { fieldMappings: { style: { sourceNodeId: "src" } } } }, // mapping → hidden
    ]
    for (const { edges, data } of cases) {
      useWorkflowStore.setState({
        nodes: [{ id: "n1", type: "suno-generate", position: { x: 0, y: 0 }, data: { label: "S", model: "V5", ...data } }] as any,
        edges: edges as any,
      } as any)
      const wired = isSunoFieldWired("style", data, edges, "n1")
      const { container, unmount } = render(<SunoFieldAiButton nodeId="n1" field="style" />)
      const hidden = container.querySelector("button") === null
      expect(hidden).toBe(wired) // button hides EXACTLY when the field is wired
      unmount()
    }
  })
})
