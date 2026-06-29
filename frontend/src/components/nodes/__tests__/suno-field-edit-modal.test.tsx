import { describe, it, expect, beforeEach, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"

// The modal calls `usePromptEditorRefs` unconditionally (for any field), which
// pulls in `useSnippetPool` → `useAuth` → `initAuth()` → `createClient()`.
// `createClient` feeds `import.meta.env.VITE_SUPABASE_URL!` (undefined in tests)
// to supabase-js, which throws synchronously. Stub it to a no-op auth client so
// the modal-under-test renders — a harness-wiring detail (mirrors
// presentation/views/__tests__/composer-bar.test.tsx), NOT a behavior change:
// the modal's open/closed + editor-vs-read-only decisions never read auth.
vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null }) }) }) }),
  }),
}))

import { SunoFieldEditModal } from "../suno-field-edit-modal"
import type { SunoEditField } from "@/components/editor/config-panels/suno-field-editor"
import { useWorkflowStore } from "@/hooks/use-workflow-store"

// usePromptEditorRefs also needs React Query (useSnippetPool) and React Router
// (useAuth → useNavigate). Wrap both providers — same wiring documented in
// suno-generate-handles.test.tsx for this node.
function renderModal(field: SunoEditField | null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SunoFieldEditModal nodeId="n1" field={field} onClose={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe("SunoFieldEditModal", () => {
  // The store is a real singleton — seed a bare Suno node before each test.
  beforeEach(() => {
    useWorkflowStore.setState({
      nodes: [
        { id: "n1", type: "suno-generate", position: { x: 0, y: 0 }, data: { label: "S", model: "V5", fieldMappings: {} } },
      ] as any,
      edges: [],
    } as any)
  })

  it("renders no dialog when field is null", () => {
    renderModal(null)
    // Radix portals content to document.body — query the whole document via
    // `screen` (container.querySelector would be trivially null even if open).
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("opens the title editor when field=title", async () => {
    renderModal("title")
    expect(await screen.findByRole("dialog")).toBeInTheDocument()
    expect(await screen.findByPlaceholderText("Song title")).toBeInTheDocument()
  })

  // Bonus: when the field is wired (a fieldMappings entry + a matching upstream
  // source), MappableField renders a read-only preview of the source value and
  // does NOT mount the editor. The modal gets this for free by feeding the REAL
  // sources/fieldMappings into MappableField.
  it("renders the wired source read-only (no editor) when the field is mapped", async () => {
    useWorkflowStore.setState({
      nodes: [
        { id: "n1", type: "suno-generate", position: { x: 0, y: 0 }, data: { label: "S", model: "V5", fieldMappings: { title: { sourceNodeId: "t1" } } } },
        { id: "t1", type: "text-prompt", position: { x: 0, y: 0 }, data: { label: "Title source", text: "Wired title" } },
      ] as any,
      edges: [{ id: "e1", source: "t1", target: "n1" }] as any,
    } as any)
    renderModal("title")
    // Read-only preview shows the source's extracted value...
    expect(await screen.findByText("Wired title")).toBeInTheDocument()
    // ...and the editable <Input> is NOT mounted.
    expect(screen.queryByPlaceholderText("Song title")).toBeNull()
  })
})
