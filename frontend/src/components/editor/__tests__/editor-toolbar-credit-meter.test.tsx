import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

/**
 * The editor toolbar's credit meter is the shared site header's job when the
 * header is on (one gate: lib/shared-header.ts) — never two meters on screen.
 * Off, the toolbar keeps its own, as before. And under the hosted header (no
 * slot to hold it), the toolbar is where the phone's drawer button lives.
 */

const gate = { on: false, mode: null as "default" | "white-label" | null }
vi.mock("@/lib/shared-header", () => ({
  sharedHeaderActive: () => gate.on,
  useSharedHeaderActive: () => gate.on,
  useSharedHeaderMode: () => gate.mode,
}))
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
const { SidebarProvider } = await import("@/components/layout/sidebar-context")

function toolbar(openMobileMenu?: () => void) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <SidebarProvider onOpenMobileMenu={openMobileMenu}>
          <EditorToolbar onSave={() => {}} saving={false} />
        </SidebarProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  gate.on = false
  gate.mode = null
})

describe("the editor toolbar's drawer button", () => {
  it("under the hosted header, opens the app's drawer: the header has no slot for it", () => {
    gate.on = true
    gate.mode = "default"
    const open = vi.fn()
    toolbar(open)
    const button = screen.getByRole("button", { name: "Open menu" })
    fireEvent.click(button)
    expect(open).toHaveBeenCalledTimes(1)
    // Phones only: the desktop sidebar is always in reach.
    expect(button.className).toMatch(/\bmd:hidden\b/)
  })

  it.each([
    ["no shared header", null],
    ["a white-label header (its own button is in its row)", "white-label"],
  ] as const)("is not drawn with %s", (_label, mode) => {
    gate.on = mode !== null
    gate.mode = mode
    toolbar()
    expect(screen.queryByRole("button", { name: "Open menu" })).toBeNull()
  })
})

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
