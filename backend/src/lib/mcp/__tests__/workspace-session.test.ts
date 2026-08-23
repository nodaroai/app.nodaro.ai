import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  hasOrganizations: vi.fn(() => true),
  orgs: undefined as
    | undefined
    | { resolveRequestContext: ReturnType<typeof vi.fn>; me: ReturnType<typeof vi.fn> },
  getPreferences: vi.fn(),
  invalidate: vi.fn(),
  update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
  /** What the profiles row holds — the read goes here, not through the cache. */
  storedPrefs: {} as Record<string, unknown> | null,
  storedError: null as { message: string } | null,
  selects: 0,
}))

vi.mock("@/lib/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config.js")>()
  return { ...actual, hasOrganizations: h.hasOrganizations }
})
vi.mock("@/lib/private-plugins/load.js", () => ({ getPluginServices: () => ({ orgs: h.orgs }) }))
vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      update: h.update,
      select: () => ({
        eq: () => ({
          single: async () => {
            h.selects += 1
            return h.storedError
              ? { data: null, error: h.storedError }
              : { data: { mcp_preferences: h.storedPrefs }, error: null }
          },
        }),
      }),
    }),
  },
}))
vi.mock("@/lib/mcp/user-preferences.js", () => ({
  getUserMcpPreferences: h.getPreferences,
  invalidateUserPreferences: h.invalidate,
}))

import { resolveSessionWorkspace, storeSessionWorkspace } from "@/lib/mcp/workspace-session.js"

const USER = "00000000-0000-4000-8000-000000000001"
const WS = "20000000-0000-4000-8000-000000000001"

function orgsWith(result: unknown, workspaces: Array<{ id: string }> = [{ id: WS }]) {
  h.orgs = {
    resolveRequestContext: vi.fn(async () => result),
    me: vi.fn(async () => ({ organizations: [], workspaces, lastWorkspaceId: null })),
  }
}

beforeEach(() => {
  h.hasOrganizations.mockReturnValue(true)
  h.getPreferences.mockResolvedValue({})
  h.storedPrefs = { defaultWorkspaceId: WS }
  h.storedError = null
  h.selects = 0
  // Reset the IMPLEMENTATION, not just the call log: clearAllMocks leaves a
  // mockReturnValue in place, so a test that made the write fail would make
  // every later test fail with it.
  h.update.mockReturnValue({ eq: vi.fn(async () => ({ error: null })) } as never)
  orgsWith({ workspaceId: WS, orgId: "org-1" })
})
afterEach(() => vi.clearAllMocks())

/**
 * A preference is written once and read for months, and membership can end in
 * between. A client that kept working inside a workspace it had been removed
 * from is the exact failure this axis exists to prevent — and unlike a
 * browser, nobody is watching a switcher who would notice.
 */
describe("resolveSessionWorkspace", () => {
  it("re-validates the stored preference rather than trusting it", async () => {
    expect(await resolveSessionWorkspace(USER)).toBe(WS)
    expect(h.orgs?.resolveRequestContext).toHaveBeenCalledWith({
      userId: USER,
      headerWorkspaceId: WS,
      identityRoute: true,
    })
  })

  /**
   * The preferences cache is a process-local Map that only one process
   * invalidates. Reading through it would let another process resolve the
   * workspace the caller just switched away from — and report it as SELECTED
   * while new work landed elsewhere.
   */
  it("reads the selection past the preferences cache, every time", async () => {
    await resolveSessionWorkspace(USER)
    await resolveSessionWorkspace(USER)
    expect(h.selects).toBe(2)
    expect(h.getPreferences).not.toHaveBeenCalled()
  })

  it("is undefined, and asks nothing, when there is no selection", async () => {
    h.storedPrefs = {}
    expect(await resolveSessionWorkspace(USER)).toBeUndefined()
    expect(h.orgs?.resolveRequestContext).not.toHaveBeenCalled()
    expect(h.update).not.toHaveBeenCalled()
  })

  it("does nothing at all on a build without organizations", async () => {
    h.hasOrganizations.mockReturnValue(false)
    expect(await resolveSessionWorkspace(USER)).toBeUndefined()
    expect(h.selects).toBe(0)
  })

  it("does nothing when no plugin provides the service", async () => {
    h.orgs = undefined
    expect(await resolveSessionWorkspace(USER)).toBeUndefined()
    expect(h.selects).toBe(0)
  })

  describe("when the selection stops resolving", () => {
    /**
     * The resolver answers the same way for "you were removed" and "the
     * organization is suspended for an hour" — deliberately, so the header
     * cannot be used to learn what exists. Forgetting on the strength of
     * that answer would make a temporary suspension permanently erase every
     * MCP client's selection, while the browser restores it on next load.
     */
    it("KEEPS a selection whose workspace is still listed — a suspension is temporary", async () => {
      orgsWith({}, [{ id: WS }])
      expect(await resolveSessionWorkspace(USER)).toBeUndefined()
      expect(h.update).not.toHaveBeenCalled()
    })

    it("forgets one whose workspace is gone from the list", async () => {
      orgsWith({}, [])
      expect(await resolveSessionWorkspace(USER)).toBeUndefined()
      expect(h.update).toHaveBeenCalledWith({ mcp_preferences: { defaultWorkspaceId: null } })
      expect(h.invalidate).toHaveBeenCalledWith(USER)
    })

    it("keeps the rest of the preferences when it forgets the selection", async () => {
      h.getPreferences.mockResolvedValue({ defaultWorkspaceId: WS, image: { model: "flux" } })
      orgsWith({}, [])
      await resolveSessionWorkspace(USER)
      expect(h.update).toHaveBeenCalledWith({
        mcp_preferences: { defaultWorkspaceId: null, image: { model: "flux" } },
      })
    })

    it("keeps the selection when it cannot find out whether it is gone", async () => {
      orgsWith({}, [])
      h.orgs!.me = vi.fn(async () => {
        throw new Error("db down")
      })
      expect(await resolveSessionWorkspace(USER)).toBeUndefined()
      expect(h.update).not.toHaveBeenCalled()
    })
  })

  describe("when something is broken rather than gone", () => {
    it("an unreachable resolver yields the personal space and KEEPS the preference", async () => {
      // Working in the personal space is wrong in a recoverable way; working
      // in an unverified workspace is not. And a blip must not erase a
      // selection that is probably still valid.
      h.orgs = {
        me: vi.fn(),
        resolveRequestContext: vi.fn(async () => {
          throw new Error("redis down")
        }),
      }
      expect(await resolveSessionWorkspace(USER)).toBeUndefined()
      expect(h.update).not.toHaveBeenCalled()
    })

    it("a failed profile read yields the personal space, and asks nobody", async () => {
      h.storedError = { message: "db down" }
      expect(await resolveSessionWorkspace(USER)).toBeUndefined()
      expect(h.orgs?.resolveRequestContext).not.toHaveBeenCalled()
    })

    it("a failed forget does not fail the session", async () => {
      orgsWith({}, [])
      h.update.mockReturnValue({ eq: vi.fn(async () => ({ error: { message: "no" } })) } as never)
      await expect(resolveSessionWorkspace(USER)).resolves.toBeUndefined()
    })
  })
})

describe("storeSessionWorkspace", () => {
  it("writes the selection and drops the cache", async () => {
    h.getPreferences.mockResolvedValue({ image: { model: "flux" } })
    await storeSessionWorkspace(USER, WS)
    expect(h.update).toHaveBeenCalledWith({
      mcp_preferences: { image: { model: "flux" }, defaultWorkspaceId: WS },
    })
    expect(h.invalidate).toHaveBeenCalledWith(USER)
  })

  it("reports a write it could not make", async () => {
    h.update.mockReturnValue({ eq: vi.fn(async () => ({ error: { message: "denied" } })) } as never)
    await expect(storeSessionWorkspace(USER, WS)).rejects.toThrow(/could not store/i)
  })
})
