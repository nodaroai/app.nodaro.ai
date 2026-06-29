import { describe, it, expect, afterEach } from "vitest"
import { render } from "@testing-library/react"
import { ReactFlowProvider } from "@xyflow/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { SunoGenerateNode } from "../suno-generate-node"
import { useWorkflowStore } from "@/hooks/use-workflow-store"

// Faithful render of the real node: the real React Flow `<Handle>` (rendered by
// `HandleWithPopover`) emits `data-handleid="<id>"` on a `.react-flow__handle`
// element — verified by inspecting the existing prompt/audio-style/voice/audio
// pips of this node (all four show up under `[data-handleid]`). So the brief's
// `[data-handleid="field-*"]` selector is the real attribute; no adaptation of
// the selector is needed.
//
// The ONE adaptation vs. the brief's verbatim snippet: the node calls
// `useModelCredits` (React Query), so the render needs a `QueryClientProvider`
// in addition to `ReactFlowProvider` or it throws "No QueryClient set". This is
// a harness-wiring detail, not a behavior change.
function renderNode(data: Record<string, unknown>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ReactFlowProvider>
        {/* @ts-expect-error minimal NodeProps for unit render */}
        <SunoGenerateNode id="n1" data={{ label: "Suno", model: "V5", ...data }} selected={false} />
      </ReactFlowProvider>
    </QueryClientProvider>,
  )
}

// The node subscribes to `useWorkflowStore((s) => s.edges)` to auto-reveal when
// a field-* pip is wired. The store is a real singleton, so reset edges between
// tests to avoid cross-test leakage.
afterEach(() => {
  useWorkflowStore.setState({ edges: [] })
})

describe("suno-generate advanced field handles", () => {
  it("hides field-* pips by default", () => {
    const { container } = renderNode({})
    expect(container.querySelector('[data-handleid="field-style"]')).toBeNull()
    expect(container.querySelector('[data-handleid="field-lyrics"]')).toBeNull()
    expect(container.querySelector('[data-handleid="field-title"]')).toBeNull()
    expect(container.querySelector('[data-handleid="field-negativeStyle"]')).toBeNull()
  })

  it("shows field-* pips when advancedOpen", () => {
    const { container } = renderNode({ advancedOpen: true })
    expect(container.querySelector('[data-handleid="field-style"]')).not.toBeNull()
    expect(container.querySelector('[data-handleid="field-lyrics"]')).not.toBeNull()
    expect(container.querySelector('[data-handleid="field-title"]')).not.toBeNull()
    expect(container.querySelector('[data-handleid="field-negativeStyle"]')).not.toBeNull()
  })

  it("auto-shows pips when a secondary field has content", () => {
    const { container } = renderNode({ style: "lofi" })
    expect(container.querySelector('[data-handleid="field-style"]')).not.toBeNull()
  })

  it("auto-shows pips when a field-* handle is wired (edges subscription)", () => {
    useWorkflowStore.setState({
      edges: [
        { id: "e1", source: "src", target: "n1", sourceHandle: "text", targetHandle: "field-lyrics" },
      ],
    })
    const { container } = renderNode({})
    expect(container.querySelector('[data-handleid="field-style"]')).not.toBeNull()
    expect(container.querySelector('[data-handleid="field-lyrics"]')).not.toBeNull()
  })

  it("respects an explicit advancedOpen:false even when a secondary field has content", () => {
    // data.advancedOpen is the explicit user toggle and must win over the
    // content/wired auto-derivation (nullish-coalescing, not OR).
    const { container } = renderNode({ advancedOpen: false, style: "lofi" })
    expect(container.querySelector('[data-handleid="field-style"]')).toBeNull()
  })
})
