import { describe, it, expect, vi, beforeEach } from "vitest"
import type { ReactNode } from "react"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

// ---------------------------------------------------------------------------
// The projects-tab name search must apply the SAME visibility rule as the
// dashboard lists (native OR a listed client app), lifted only by the admin
// reveal flag — otherwise a voice-changer-pro user typing two characters sees
// their conversions. These tests pin that behaviour.
// ---------------------------------------------------------------------------

const mockCreateClient = vi.fn()
vi.mock("@/lib/supabase", () => ({ createClient: () => mockCreateClient() }))

const mockReadFlag = vi.fn().mockReturnValue(false)
vi.mock("@/hooks/queries/use-client-apps-queries", () => ({
  fetchListedAppSlugs: vi.fn().mockResolvedValue(["studio"]),
  readShowClientAppsFlag: () => mockReadFlag(),
  // Real-shaped stub so the asserted `.or` argument matches production.
  workflowVisibilityFilter: (slugs: readonly string[]) =>
    slugs.length ? `app_slug.is.null,app_slug.in.(${slugs.join(",")})` : "app_slug.is.null",
}))

import { useWorkflowSearch } from "../use-workflow-search"

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

/** Chainable, thenable supabase builder — records `.or` for assertions. */
function makeBuilder(result: { data: unknown; error: unknown }) {
  const b: Record<string, ReturnType<typeof vi.fn>> & { then?: unknown } = {}
  for (const m of ["select", "ilike", "order", "limit", "or"]) b[m] = vi.fn(() => b)
  b.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return b
}

describe("useWorkflowSearch — client-app visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReadFlag.mockReturnValue(false)
  })

  it("applies the visibility filter by DEFAULT (native OR a listed app)", async () => {
    const builder = makeBuilder({ data: [], error: null })
    mockCreateClient.mockReturnValue({ from: vi.fn(() => builder) })

    renderHook(() => useWorkflowSearch("ab", new Map()), { wrapper })

    await waitFor(() =>
      expect(builder.or).toHaveBeenCalledWith("app_slug.is.null,app_slug.in.(studio)"),
    )
  })

  it("skips the filter when the admin reveal flag is ON", async () => {
    mockReadFlag.mockReturnValue(true)
    const builder = makeBuilder({ data: [], error: null })
    mockCreateClient.mockReturnValue({ from: vi.fn(() => builder) })

    renderHook(() => useWorkflowSearch("ab", new Map()), { wrapper })

    // Once the query is built (select called), `.or` would already have run if
    // it were going to — assert it did not.
    await waitFor(() => expect(builder.select).toHaveBeenCalled())
    expect(builder.or).not.toHaveBeenCalled()
  })

  it("does not query at all for a search under 2 characters", async () => {
    const builder = makeBuilder({ data: [], error: null })
    mockCreateClient.mockReturnValue({ from: vi.fn(() => builder) })

    renderHook(() => useWorkflowSearch("a", new Map()), { wrapper })

    await new Promise((r) => setTimeout(r, 350))
    expect(builder.select).not.toHaveBeenCalled()
  })
})
