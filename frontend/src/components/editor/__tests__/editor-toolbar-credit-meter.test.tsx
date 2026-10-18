import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

/**
 * The editor toolbar's credit meter is the shared site header's job when the
 * header is on (one gate: lib/shared-header.ts) — never two meters on screen.
 * Off, the toolbar keeps its own, as before.
 */

const gate = { on: false }
vi.mock("@/lib/shared-header", () => ({ sharedHeaderActive: () => gate.on, useSharedHeaderActive: () => gate.on }))
vi.mock("@/ee/components/credits/CreditBalance", () => ({ CreditBalance: () => <span data-testid="toolbar-credit-meter" /> }))

/** A Supabase client stand-in: a signed-in user, and every table read answering empty. */
function emptyQuery(): unknown {
  const result = Promise.resolve({ data: null, error: null })
  return new Proxy(() => {}, {
    get: (_target, prop) => (prop === "then" ? result.then.bind(result) : emptyQuery()),
    apply: () => emptyQuery(),
  })
}
vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "u1" } } }),
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    from: () => emptyQuery(),
    channel: () => emptyQuery(),
    removeChannel: () => {},
  }),
}))

const { EditorToolbar } = await import("../editor-toolbar")

function toolbar() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <EditorToolbar onSave={() => {}} saving={false} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => cleanup())

describe("the editor toolbar's credit meter", () => {
  it("is there without the shared header", async () => {
    gate.on = false
    toolbar()
    expect(await screen.findByTestId("toolbar-credit-meter")).toBeInTheDocument()
  })

  it("is left to the shared header when it is on", async () => {
    gate.on = true
    toolbar()
    // Let the user lookup land: the meter would render right after it.
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(screen.queryByTestId("toolbar-credit-meter")).toBeNull()
  })
})
