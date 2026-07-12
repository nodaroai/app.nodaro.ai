import { describe, it, expect, vi, beforeEach } from "vitest"

const mockUseQuery = vi.fn()
const mockCreateClient = vi.fn()

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: unknown) => mockUseQuery(opts),
}))

vi.mock("@/lib/supabase", () => ({
  createClient: () => mockCreateClient(),
}))

vi.mock("@/lib/api", () => ({
  getAuthHeaders: vi.fn().mockResolvedValue({}),
}))

vi.mock("@/lib/query-keys", () => ({
  queryKeys: {
    workflows: {
      all: ["workflows"],
      listMine: () => ["workflows", "list", "mine"],
      listStudioMine: () => ["workflows", "list", "studio", "mine"],
      listStudioAll: () => ["workflows", "list", "studio", "all"],
    },
    clientApps: {
      all: ["client-apps"],
      list: () => ["client-apps", "list"],
    },
  },
}))

import { useMyWorkflows, useMyStudioWorkflows } from "../use-my-workflows-queries"

/**
 * Thenable supabase stub: every builder method returns the same object, so a
 * single object captures the `.eq` / `.is` / `.or` calls regardless of chain
 * order, and awaiting it resolves `result`.
 */
function chain(result: { data: unknown; error: unknown }) {
  const obj: Record<string, unknown> = {}
  for (const m of ["select", "eq", "is", "or", "order", "limit", "not"]) {
    obj[m] = vi.fn(() => obj)
  }
  obj.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return obj as Record<string, ReturnType<typeof vi.fn>> & { then: unknown }
}

function supabaseReturning(workflowsChain: unknown) {
  return {
    from: vi.fn().mockReturnValue(workflowsChain),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
    },
  }
}

/**
 * Row-filtering supabase stub. Unlike `chain()` above (which returns canned
 * `data` no matter what query was built), this one actually applies `.eq()` /
 * `.is()` predicates to a fixed row set before resolving. That makes it
 * possible to pin real filtering BEHAVIOUR — which rows come back — rather
 * than only asserting on which builder method was called with which string.
 * A missing key reads as `null` (matching Postgres NULL), so `.is(col, null)`
 * correctly admits rows that never set `col` at all.
 */
function filteringChain(rows: ReadonlyArray<Record<string, unknown>>) {
  let filtered = [...rows]
  const obj: Record<string, unknown> = {}
  for (const m of ["select", "order", "limit", "or", "not"]) {
    obj[m] = vi.fn(() => obj)
  }
  obj.eq = vi.fn((col: string, val: unknown) => {
    filtered = filtered.filter((r) => (r[col] ?? null) === val)
    return obj
  })
  obj.is = vi.fn((col: string, val: unknown) => {
    filtered = filtered.filter((r) => (r[col] ?? null) === val)
    return obj
  })
  obj.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: filtered, error: null }).then(resolve)
  return obj as Record<string, ReturnType<typeof vi.fn>> & { then: unknown }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUseQuery.mockReturnValue({ data: null })
})

describe("useMyWorkflows — NATIVE ONLY (app_slug IS NULL)", () => {
  it("filters on app_slug IS NULL and never reads settings->studio", async () => {
    const wf = chain({ data: [], error: null })
    mockCreateClient.mockReturnValue(supabaseReturning(wf))

    useMyWorkflows()
    await mockUseQuery.mock.calls[0][0].queryFn()

    // My Workflows is native-only, full stop — it does not OR-in listed apps
    // (that would put studio's workflows here AND in "Studio Workflows").
    expect(wf.is).toHaveBeenCalledWith("app_slug", null)
    expect(wf.or).not.toHaveBeenCalled()

    // The leaky abstraction is gone: the platform no longer reads studio's
    // private settings namespace to decide what to show.
    expect(wf.is).not.toHaveBeenCalledWith("settings->studio", null)
    expect(wf.not).not.toHaveBeenCalled()

    // Still owner-scoped + top-level only.
    expect(wf.eq).toHaveBeenCalledWith("user_id", "user-1")
    expect(wf.is).toHaveBeenCalledWith("parent_workflow_id", null)
  })

  // PINS the rule: regardless of any app's `workflows_listed` registry entry,
  // only the native row survives. This is the exact regression this branch
  // fixes — before it, a studio-owned row leaked into My Workflows because
  // studio is `workflows_listed = true`, duplicating it with the "Studio
  // Workflows" tab.
  it("excludes studio- and vcp-owned workflows; includes only the native one", async () => {
    const wf = filteringChain([
      { id: "native-1", user_id: "user-1", app_slug: null },
      { id: "studio-1", user_id: "user-1", app_slug: "studio" },
      { id: "vcp-1", user_id: "user-1", app_slug: "voice-changer-pro" },
    ])
    mockCreateClient.mockReturnValue(supabaseReturning(wf))

    useMyWorkflows()
    const result = (await mockUseQuery.mock.calls[0][0].queryFn()) as Array<{ id: string }>

    expect(result.map((w) => w.id)).toEqual(["native-1"])
  })

  it("returns [] without querying when signed out", async () => {
    mockCreateClient.mockReturnValue({
      from: vi.fn(),
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    })

    useMyWorkflows()
    await expect(mockUseQuery.mock.calls[0][0].queryFn()).resolves.toEqual([])
  })
})

describe("useMyStudioWorkflows — scoped to one app", () => {
  it("scopes on app_slug = 'studio' rather than settings->studio", async () => {
    const wf = chain({ data: [], error: null })
    mockCreateClient.mockReturnValue(supabaseReturning(wf))

    useMyStudioWorkflows()
    await mockUseQuery.mock.calls[0][0].queryFn()

    expect(wf.eq).toHaveBeenCalledWith("app_slug", "studio")
    expect(wf.eq).toHaveBeenCalledWith("user_id", "user-1")
    expect(wf.is).toHaveBeenCalledWith("parent_workflow_id", null)
    // The old origin signal is gone.
    expect(wf.not).not.toHaveBeenCalled()
  })
})
