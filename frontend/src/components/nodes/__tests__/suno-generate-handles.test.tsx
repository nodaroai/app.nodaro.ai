import { describe, it, expect, afterEach, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ReactFlowProvider } from "@xyflow/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"

// The Edit-menu test opens the on-node menu and lets it mount
// `SunoFieldEditModal`, which calls `usePromptEditorRefs` → `useSnippetPool` →
// `useAuth` → `createClient`. `createClient` feeds
// `import.meta.env.VITE_SUPABASE_URL!` (undefined in tests) to supabase-js,
// which throws synchronously. Stub it to a no-op auth client so the modal
// renders — same harness-wiring as suno-field-edit-modal.test.tsx, NOT a
// behavior change (the modal's open/editor decisions never read auth).
vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null }) }) }) }),
  }),
}))

import { SunoGenerateNode } from "../suno-generate-node"
import { SUNO_FIELD_EDIT_META } from "@/components/editor/config-panels/suno-field-editor"
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
// Optional `edges` seeds the singleton store BEFORE render — the node reads
// `useWorkflowStore((s) => s.edges)` for the collapse-while-wired derivation.
// MemoryRouter is added for the Edit-menu test: the mounted SunoFieldEditModal's
// `usePromptEditorRefs` → `useAuth` → `useNavigate` needs a Router. Harmless for
// the pip tests (the modal only mounts once a field is chosen).
function renderNode(data: Record<string, unknown>, edges?: ReadonlyArray<Record<string, unknown>>) {
  if (edges) useWorkflowStore.setState({ edges: edges as never })
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ReactFlowProvider>
          {/* @ts-expect-error minimal NodeProps for unit render */}
          <SunoGenerateNode id="n1" data={{ label: "Suno", model: "V5", ...data }} selected={false} />
        </ReactFlowProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

// The node subscribes to `useWorkflowStore((s) => s.edges)` to auto-reveal when
// a field-* pip is wired. The store is a real singleton, so reset edges between
// tests to avoid cross-test leakage.
afterEach(() => {
  useWorkflowStore.setState({ edges: [], nodes: [] })
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

  it("keeps a wired field's pip rendered even when Advanced is collapsed", () => {
    // advancedOpen is EXPLICITLY false (wins over the auto-derivation), but
    // field-style is wired → its pip must still render so the user can see /
    // manage the live connection. An UNwired secondary pip stays hidden. This
    // is the reviewer's collapse-while-wired refinement, and it must apply in
    // LOCKSTEP to the BaseNode handles array (sizing) and the HandleWithPopover
    // JSX (the visible `data-handleid` pip queried here).
    const { container } = renderNode({ advancedOpen: false }, [
      { id: "e", source: "src", target: "n1", sourceHandle: "out", targetHandle: "field-style" },
    ])
    expect(container.querySelector('[data-handleid="field-style"]')).not.toBeNull()
    expect(container.querySelector('[data-handleid="field-title"]')).toBeNull()
  })
})

describe("suno-generate on-node Edit menu", () => {
  it("opens the field-edit modal for the chosen field", async () => {
    // The modal reads the node's data from the store (not props), so seed n1.
    useWorkflowStore.setState({
      nodes: [
        { id: "n1", type: "suno-generate", position: { x: 0, y: 0 }, data: { label: "Suno", model: "V5", fieldMappings: {} } },
      ] as never,
    })
    // The DropdownMenu is modal (locks document.body pointer-events); jsdom
    // can't evaluate inherited pointer-events, so disable userEvent's CSS
    // guard. The clicks still dispatch real pointer/click events.
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    renderNode({ advancedOpen: true })

    await user.click(screen.getByRole("button", { name: /edit/i }))
    // Scope to the menuitem role: the field PIP labels (e.g. "Lyrics") render
    // the same text, so a bare findByText would be ambiguous.
    await user.click(await screen.findByRole("menuitem", { name: "Lyrics" }))

    expect(
      await screen.findByPlaceholderText(SUNO_FIELD_EDIT_META.lyrics.placeholder),
    ).toBeInTheDocument()
  })
})
