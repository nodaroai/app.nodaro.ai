import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  hasOrganizations: vi.fn(() => true),
  getSession: vi.fn(async () => ({ data: { session: { user: { id: "u-1" }, access_token: "jwt" } } })),
  update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
}))

vi.mock("@/lib/edition", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/edition")>()
  return { ...actual, hasOrganizations: h.hasOrganizations }
})
vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    auth: { getSession: h.getSession },
    from: () => ({ update: h.update }),
  }),
}))

import {
  ACTIVE_WORKSPACE_STORAGE_KEY,
  clearActiveWorkspaceAfterRefusal,
  getActiveWorkspaceId,
  getWorkspaceState,
  hydrateWorkspaces,
  resetWorkspaceState,
  setActiveWorkspace,
} from "../workspace-context"

const WS = "20000000-0000-4000-8000-000000000001"
const WS2 = "20000000-0000-4000-8000-000000000002"
const ORG = "10000000-0000-4000-8000-000000000001"

const MEMBERSHIPS = {
  organizations: [
    {
      id: ORG,
      slug: "school-a",
      name: "School A",
      kind: "school",
      status: "active",
      role: "member",
      memberStatus: "active",
      settings: { personal_space_enabled: true, allowed_email_domains: [], vocabulary_overrides: {} },
      vocabulary: { workspace: "Class", workspace_member: "Student" },
    },
  ],
  workspaces: [
    { id: WS, orgId: ORG, name: "Class 1", slug: "class-1", role: "member", memberStatus: "active", archived: false },
    { id: WS2, orgId: ORG, name: "Class 2", slug: "class-2", role: "admin", memberStatus: "active", archived: false },
  ],
  lastWorkspaceId: WS,
}

function meResponds(body: unknown, ok = true) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => body }) as Response))
}

beforeEach(() => {
  resetWorkspaceState()
  h.hasOrganizations.mockReturnValue(true)
  window.localStorage.clear()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("hydrateWorkspaces", () => {
  it("loads memberships and restores the server's remembered workspace", async () => {
    meResponds({ data: MEMBERSHIPS })
    await hydrateWorkspaces()
    const state = getWorkspaceState()
    expect(state.status).toBe("ready")
    expect(state.organizations).toHaveLength(1)
    expect(state.workspaces).toHaveLength(2)
    expect(state.activeWorkspaceId).toBe(WS)
    expect(window.localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY)).toBe(WS)
  })

  it("does nothing at all on a build without organizations", async () => {
    h.hasOrganizations.mockReturnValue(false)
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    await hydrateWorkspaces()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(getWorkspaceState().status).toBe("idle")
  })

  it("treats a remembered workspace the caller no longer belongs to as no selection", async () => {
    window.localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, "20000000-0000-4000-8000-000000000099")
    meResponds({ data: { ...MEMBERSHIPS, lastWorkspaceId: "20000000-0000-4000-8000-000000000099" } })
    await hydrateWorkspaces()
    expect(getWorkspaceState().activeWorkspaceId).toBeNull()
    expect(window.localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY)).toBeNull()
  })

  it("falls back to this browser's memory when the server has none", async () => {
    window.localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, WS2)
    meResponds({ data: { ...MEMBERSHIPS, lastWorkspaceId: null } })
    await hydrateWorkspaces()
    expect(getWorkspaceState().activeWorkspaceId).toBe(WS2)
  })

  it("distinguishes an absent axis, an empty one, and a failed lookup", async () => {
    // Absent: this instance has no organizations at all.
    meResponds({ data: { id: "u-1", tier: "pro" } })
    await hydrateWorkspaces()
    expect(getWorkspaceState()).toMatchObject({ status: "ready", organizations: [], workspaces: [] })

    // Empty: the caller belongs to none.
    resetWorkspaceState()
    meResponds({ data: { organizations: [], workspaces: [], lastWorkspaceId: null } })
    await hydrateWorkspaces()
    expect(getWorkspaceState().status).toBe("ready")

    // Failed: the selection must SURVIVE — a cache blip is not a departure.
    resetWorkspaceState()
    window.localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, WS)
    meResponds({ data: { id: "u-1", organizationsUnavailable: true } })
    await hydrateWorkspaces()
    expect(getWorkspaceState().status).toBe("unavailable")
    expect(window.localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY)).toBe(WS)
  })

  it("an unreachable endpoint reads as unavailable, never as 'you belong to nothing'", async () => {
    window.localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, WS)
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline") }))
    await hydrateWorkspaces()
    expect(getWorkspaceState().status).toBe("unavailable")
    expect(window.localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY)).toBe(WS)
  })

  it("concurrent calls share one request", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: MEMBERSHIPS }) }) as Response)
    vi.stubGlobal("fetch", fetchMock)
    await Promise.all([hydrateWorkspaces(), hydrateWorkspaces(), hydrateWorkspaces()])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe("the active selection", () => {
  it("is null for code outside React on a build without organizations, whatever is stored", async () => {
    meResponds({ data: MEMBERSHIPS })
    await hydrateWorkspaces()
    expect(getActiveWorkspaceId()).toBe(WS)
    h.hasOrganizations.mockReturnValue(false)
    expect(getActiveWorkspaceId()).toBeNull()
  })

  it("switching persists to this browser and to the profile", async () => {
    meResponds({ data: MEMBERSHIPS })
    await hydrateWorkspaces()
    setActiveWorkspace(WS2)
    expect(getActiveWorkspaceId()).toBe(WS2)
    expect(window.localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY)).toBe(WS2)
    await Promise.resolve()
    expect(h.update).toHaveBeenCalledWith({ last_workspace_id: WS2 })
  })

  it("switching to the personal space clears the stored id", async () => {
    meResponds({ data: MEMBERSHIPS })
    await hydrateWorkspaces()
    setActiveWorkspace(null)
    expect(getActiveWorkspaceId()).toBeNull()
    expect(window.localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY)).toBeNull()
  })

  it("selecting what is already selected writes nothing", async () => {
    meResponds({ data: MEMBERSHIPS })
    await hydrateWorkspaces()
    h.update.mockClear()
    setActiveWorkspace(WS)
    expect(h.update).not.toHaveBeenCalled()
  })

  it("a refusal drops the selection and KEEPS the list", async () => {
    meResponds({ data: MEMBERSHIPS })
    await hydrateWorkspaces()
    clearActiveWorkspaceAfterRefusal()
    expect(getActiveWorkspaceId()).toBeNull()
    expect(window.localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY)).toBeNull()
    // The same two codes answer an OBJECT-level refusal — a suspended member
    // editing a workspace they may still read — and nothing here can tell
    // which happened. Hiding the workspace would hide something they are
    // still allowed to open; the next hydration reconciles the list.
    expect(getWorkspaceState().workspaces.map((w) => w.id)).toEqual([WS, WS2])
  })

  it("a refusal with nothing selected is a no-op", async () => {
    meResponds({ data: { ...MEMBERSHIPS, lastWorkspaceId: null } })
    await hydrateWorkspaces()
    clearActiveWorkspaceAfterRefusal()
    expect(getWorkspaceState().workspaces).toHaveLength(2)
  })

  it("survives storage the browser refuses", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("private mode")
    })
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("private mode")
    })
    meResponds({ data: MEMBERSHIPS })
    await expect(hydrateWorkspaces()).resolves.toBeUndefined()
    expect(getWorkspaceState().activeWorkspaceId).toBe(WS)
    setItem.mockRestore()
    getItem.mockRestore()
  })
})

