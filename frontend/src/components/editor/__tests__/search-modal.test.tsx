import { describe, it, expect, vi, beforeEach } from "vitest"
import { render } from "@testing-library/react"

// ---------------------------------------------------------------------------
// The ⌘K SearchModal fetches the 10 most-recently-updated projects AND
// workflows the instant it opens (empty query). Both reads must apply the
// visibility rule (native OR a listed client app) so voice-changer-pro rows
// don't ride to the top before the user types. Lifted by the admin reveal flag.
// ---------------------------------------------------------------------------

const mockUseQuery = vi.fn()
vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: unknown) => mockUseQuery(opts),
  useQueryClient: () => ({}),
}))

const mockCreateClient = vi.fn()
vi.mock("@/lib/supabase", () => ({ createClient: () => mockCreateClient() }))

vi.mock("@/hooks/use-click-outside", () => ({ useClickOutside: () => {} }))

vi.mock("lucide-react", () => new Proxy({}, {
  // Any icon name resolves to a null component — the rich picker-ui package
  // imports icons a closed list cannot anticipate (Dog, Car, ...).
  get: (_t, prop) => (typeof prop === "string" && prop !== "then" ? () => null : undefined),
  has: () => true,
}))

const mockReadFlag = vi.fn().mockReturnValue(false)
vi.mock("@/hooks/queries/use-client-apps-queries", () => ({
  fetchListedAppSlugs: vi.fn().mockResolvedValue(["studio"]),
  isAppSlugColumnMissing: () => false,
  projectVisibilityFilter: (slugs: readonly string[]) =>
    slugs.length ? `app_slug.is.null,app_slug.in.(${slugs.join(",")})` : "app_slug.is.null",
  workflowVisibilityFilter: (slugs: readonly string[]) =>
    slugs.length ? `app_slug.is.null,app_slug.in.(${slugs.join(",")})` : "app_slug.is.null",
  readShowClientAppsFlag: () => mockReadFlag(),
}))

vi.mock("@/lib/query-keys", () => ({
  queryKeys: { search: { results: (q: string) => ["search", q] } },
}))

import { SearchModal } from "../search-modal"

/** Chainable, thenable supabase builder — records `.or` / `.ilike`. */
function makeBuilder(result: { data: unknown; error: unknown }) {
  const b: Record<string, ReturnType<typeof vi.fn>> & { then?: unknown } = {}
  for (const m of ["select", "ilike", "order", "limit", "or", "eq", "is"]) b[m] = vi.fn(() => b)
  b.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return b
}

/** Render the modal (open), returning the captured queryFn + per-table builders. */
function setup() {
  const projectsB = makeBuilder({ data: [], error: null })
  const workflowsB = makeBuilder({ data: [], error: null })
  mockCreateClient.mockReturnValue({
    from: vi.fn((t: string) => (t === "projects" ? projectsB : workflowsB)),
  })
  mockUseQuery.mockReturnValue({ data: undefined, isLoading: false })
  render(<SearchModal open onClose={() => {}} />)
  const opts = mockUseQuery.mock.calls[0][0] as { queryFn: () => Promise<unknown> }
  return { opts, projectsB, workflowsB }
}

describe("SearchModal — client-app visibility (empty query included)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReadFlag.mockReturnValue(false)
  })

  it("filters BOTH projects and workflows by default — with an empty query", async () => {
    const { opts, projectsB, workflowsB } = setup()
    await opts.queryFn()

    expect(projectsB.or).toHaveBeenCalledWith("app_slug.is.null,app_slug.in.(studio)")
    expect(workflowsB.or).toHaveBeenCalledWith("app_slug.is.null,app_slug.in.(studio)")
    // Empty query → no name filter; this is exactly the leak path we're closing.
    expect(projectsB.ilike).not.toHaveBeenCalled()
    expect(workflowsB.ilike).not.toHaveBeenCalled()
  })

  it("skips both filters when the admin reveal flag is ON", async () => {
    mockReadFlag.mockReturnValue(true)
    const { opts, projectsB, workflowsB } = setup()
    await opts.queryFn()

    expect(projectsB.or).not.toHaveBeenCalled()
    expect(workflowsB.or).not.toHaveBeenCalled()
  })
})
