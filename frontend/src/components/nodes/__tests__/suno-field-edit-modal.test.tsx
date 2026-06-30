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

// The field AI button (PromptHelperButton) self-gates on hasCredits(); force it
// true so the button renders in tests (mirrors suno-field-ai-button.test.tsx).
vi.mock("@/lib/edition", async (orig) => ({ ...(await orig()), hasCredits: () => true }))

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

  // When the field's CANVAS HANDLE is wired (a `field-<field>` edge into the
  // node — the resolver's top precedence), the value is auto-injected from the
  // connection, so SunoField renders a read-only preview and does NOT mount the
  // editor. Keys off the EDGE, NOT a manual fieldMappings entry (that UI is gone).
  it("renders read-only (no editor) when the field's handle is wired by an edge", async () => {
    useWorkflowStore.setState({
      nodes: [
        { id: "n1", type: "suno-generate", position: { x: 0, y: 0 }, data: { label: "S", model: "V5" } },
      ] as any,
      edges: [{ id: "e1", source: "t1", target: "n1", targetHandle: "field-title" }] as any,
    } as any)
    renderModal("title")
    // The editable <Input> is NOT mounted...
    expect(screen.queryByPlaceholderText("Song title")).toBeNull()
    // ...a read-only preview is shown instead.
    expect(await screen.findByText(/connected handle/i)).toBeInTheDocument()
  })

  // No manual "Manual / source" dropdown — even when a TYPE-COMPATIBLE upstream
  // source is connected (exactly when the OLD MappableField rendered the picker).
  // A Suno field is bound only by its handle or a {variable}, never a per-field
  // source select.
  it("renders no manual source dropdown even with a compatible upstream source", async () => {
    useWorkflowStore.setState({
      nodes: [
        { id: "n1", type: "suno-generate", position: { x: 0, y: 0 }, data: { label: "S", model: "V5" } },
        { id: "sg", type: "style-guide", position: { x: 0, y: 0 }, data: { label: "Style guide", text: "noir" } },
      ] as any,
      // Connected, but NOT to the field-style handle → the field stays editable.
      edges: [{ id: "e1", source: "sg", target: "n1", targetHandle: "audio-style" }] as any,
    } as any)
    renderModal("style")
    // The editor is mounted (unwired)...
    expect(await screen.findByPlaceholderText(/pop, rock, jazz/i)).toBeInTheDocument()
    // ...and there is NO source-picker combobox.
    expect(screen.queryByRole("combobox", { name: /source/i })).toBeNull()
  })

  // Phase D: the Style field's MappableField gets the ✨ Style AI button via the
  // `labelAction` slot. The modal renders only the ACTIVE field, so it shows for
  // field=style and is absent for any other field.
  it("shows the Style AI button in the modal for the style field", async () => {
    renderModal("style")
    expect(await screen.findByRole("button", { name: /ai/i })).toBeInTheDocument()
  })

  it("renders no Style AI button for the title field", async () => {
    renderModal("title")
    // Await the title editor so the modal has fully mounted before asserting the
    // button's ABSENCE (otherwise queryByRole could be vacuously null).
    expect(await screen.findByPlaceholderText("Song title")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /ai/i })).toBeNull()
  })
})
