import { describe, it, expect, vi, beforeEach } from "vitest"

const mockUseQuery = vi.fn()
const mockCreateClient = vi.fn()

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: unknown) => mockUseQuery(opts),
}))

vi.mock("@/lib/supabase", () => ({
  createClient: () => mockCreateClient(),
}))

vi.mock("@/lib/query-keys", () => ({
  queryKeys: {
    clientApps: {
      all: ["client-apps"],
      list: () => ["client-apps", "list"],
    },
  },
}))

import {
  clientAppsQueryOptions,
  fetchListedAppSlugs,
  projectVisibilityFilter,
  readShowClientAppsFlag,
  writeShowClientAppsFlag,
  SHOW_CLIENT_APPS_STORAGE_KEY,
  workflowVisibilityFilter,
} from "../use-client-apps-queries"

/**
 * Evaluate the PostgREST `or=` filter this module emits, so the four visibility
 * cases below assert what the DATABASE would actually return rather than just
 * string-matching. The format is one we control and is deliberately tiny:
 *
 *   "app_slug.is.null"                          → native only
 *   "app_slug.is.null,app_slug.in.(a,b)"        → native OR app in {a, b}
 *
 * (PostgREST `or` = disjunction; `is.null` matches NULL; `in.(…)` matches
 * membership. Nothing else is emitted.)
 */
function admits(filter: string, appSlug: string | null): boolean {
  return filter.split(/,(?![^(]*\))/).some((clause) => {
    if (clause === "app_slug.is.null") return appSlug === null
    const inMatch = /^app_slug\.in\.\((.*)\)$/.exec(clause)
    if (inMatch) {
      const values = inMatch[1].split(",").filter(Boolean)
      return appSlug !== null && values.includes(appSlug)
    }
    throw new Error(`unexpected clause in visibility filter: ${clause}`)
  })
}

describe("workflowVisibilityFilter — THE visibility rule", () => {
  // The registry as seeded by migration 252: studio's workflows are first-class,
  // voice-changer-pro's are private per-conversion storage.
  const listed = ["studio"]

  it("SHOWS a native workflow (app_slug IS NULL)", () => {
    expect(admits(workflowVisibilityFilter(listed), null)).toBe(true)
  })

  it("SHOWS a workflow from a listed app (studio)", () => {
    expect(admits(workflowVisibilityFilter(listed), "studio")).toBe(true)
  })

  it("HIDES a workflow from a registered-but-unlisted app (voice-changer-pro)", () => {
    expect(admits(workflowVisibilityFilter(listed), "voice-changer-pro")).toBe(false)
  })

  it("HIDES a workflow from an unknown / unregistered app — FAILS CLOSED", () => {
    // The property that matters: a slug nobody registered must never leak into
    // the user's list. Junk in the list is the bug being fixed; an app that is
    // wrongly invisible is noticed immediately by its own developer.
    expect(admits(workflowVisibilityFilter(listed), "some-future-app")).toBe(false)
  })

  it("with NO listed apps, degrades to native-only (never an invalid empty in.())", () => {
    const filter = workflowVisibilityFilter([])
    // An `in.()` with no values is a PostgREST syntax error, not an empty match.
    expect(filter).toBe("app_slug.is.null")
    expect(filter).not.toContain("in.(")
    expect(admits(filter, null)).toBe(true)
    expect(admits(filter, "studio")).toBe(false)
  })

  it("includes every listed slug when several apps are listed", () => {
    const filter = workflowVisibilityFilter(["studio", "some-partner-app"])
    expect(admits(filter, "studio")).toBe(true)
    expect(admits(filter, "some-partner-app")).toBe(true)
    expect(admits(filter, "voice-changer-pro")).toBe(false)
    expect(admits(filter, null)).toBe(true)
  })

  it("drops a slug that could break out of the filter syntax — fails closed", () => {
    // Slugs are admin-controlled, but a malformed one must shrink the visible
    // set, never widen it or corrupt the query.
    const filter = workflowVisibilityFilter(["studio", "evil)slug,app_slug.not.is.null"])
    expect(filter).toBe("app_slug.is.null,app_slug.in.(studio)")
    expect(admits(filter, "voice-changer-pro")).toBe(false)
  })
})

describe("fetchListedAppSlugs", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function queryClientReturning(apps: unknown) {
    return {
      fetchQuery: vi.fn().mockResolvedValue(apps),
    } as never
  }

  it("returns only the apps whose workflows are listed", async () => {
    const qc = queryClientReturning([
      { slug: "studio", name: "Studio", workflowsListed: true },
      { slug: "voice-changer-pro", name: "Voice Changer Pro", workflowsListed: false },
    ])
    await expect(fetchListedAppSlugs(qc)).resolves.toEqual(["studio"])
  })

  it("returns NO listed slugs when the registry is unreachable — FAILS CLOSED", async () => {
    const qc = {
      fetchQuery: vi.fn().mockRejectedValue(new Error("network")),
    } as never
    // Degrades the rule to native-only. It must never fail open (showing every
    // app's workflows), and it must never throw and take the tab down with it.
    await expect(fetchListedAppSlugs(qc)).resolves.toEqual([])
  })

  it("caches hard — the registry changes only when an admin toggles it", () => {
    expect(clientAppsQueryOptions.staleTime).toBe(Infinity)
    expect(clientAppsQueryOptions.queryKey).toEqual(["client-apps", "list"])
  })

  it("queryFn maps workflows_listed → workflowsListed", async () => {
    const mockOrder = vi.fn().mockResolvedValue({
      data: [{ slug: "studio", name: "Studio", workflows_listed: true }],
      error: null,
    })
    const mockSelect = vi.fn().mockReturnValue({ order: mockOrder })
    mockCreateClient.mockReturnValue({ from: vi.fn().mockReturnValue({ select: mockSelect }) })

    await expect(clientAppsQueryOptions.queryFn()).resolves.toEqual([
      { slug: "studio", name: "Studio", workflowsListed: true },
    ])
  })
})

describe("projectVisibilityFilter — same rule, applied to projects.app_slug", () => {
  const listed = ["studio"]

  it("SHOWS a native project (app_slug IS NULL)", () => {
    expect(admits(projectVisibilityFilter(listed), null)).toBe(true)
  })

  it("HIDES a registered-but-unlisted app's project (voice-changer-pro)", () => {
    // The reported leak: the "Voice Changer Pro" project must not show.
    expect(admits(projectVisibilityFilter(listed), "voice-changer-pro")).toBe(false)
  })

  it("SHOWS a listed app's project, HIDES an unknown app's — fails closed", () => {
    expect(admits(projectVisibilityFilter(listed), "studio")).toBe(true)
    expect(admits(projectVisibilityFilter(listed), "some-future-app")).toBe(false)
  })

  it("is the very same rule as the workflow filter", () => {
    expect(projectVisibilityFilter(listed)).toBe(workflowVisibilityFilter(listed))
  })
})

describe("readShowClientAppsFlag / writeShowClientAppsFlag — admin override", () => {
  beforeEach(() => {
    localStorage.removeItem(SHOW_CLIENT_APPS_STORAGE_KEY)
  })

  it("defaults to false when never set (hidden for everyone, admins included)", () => {
    expect(readShowClientAppsFlag()).toBe(false)
  })

  it("round-trips true and false", () => {
    writeShowClientAppsFlag(true)
    expect(localStorage.getItem(SHOW_CLIENT_APPS_STORAGE_KEY)).toBe("true")
    expect(readShowClientAppsFlag()).toBe(true)

    writeShowClientAppsFlag(false)
    expect(readShowClientAppsFlag()).toBe(false)
  })

  it("treats any non-\"true\" value as false", () => {
    localStorage.setItem(SHOW_CLIENT_APPS_STORAGE_KEY, "1")
    expect(readShowClientAppsFlag()).toBe(false)
  })
})
