import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { renderHook, act } from "@testing-library/react"

const h = vi.hoisted(() => ({
  hasOrganizations: vi.fn(() => true),
  getSession: vi.fn(async () => ({ data: { session: { user: { id: "u-1" }, access_token: "jwt" } } })),
}))

vi.mock("@/lib/edition", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/edition")>()
  return { ...actual, hasOrganizations: h.hasOrganizations }
})
vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    auth: { getSession: h.getSession },
    from: () => ({ update: () => ({ eq: vi.fn(async () => ({ error: null })) }) }),
  }),
}))

import { hydrateWorkspaces, resetWorkspaceState, setActiveWorkspace } from "@/lib/workspace-context"
import { FALLBACK_VOCABULARY, useVocabulary, useWorkspace } from "../use-workspace"

const ORG = "10000000-0000-4000-8000-000000000001"
const ORG2 = "10000000-0000-4000-8000-000000000002"
const WS = "20000000-0000-4000-8000-000000000001"
const WS2 = "20000000-0000-4000-8000-000000000002"

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
      vocabulary: { workspace: "Class", workspace_member: "Student", workspace_admin: "Teacher" },
    },
    {
      id: ORG2,
      slug: "team-b",
      name: "Team B",
      kind: "team",
      status: "active",
      role: "owner",
      memberStatus: "active",
      settings: { personal_space_enabled: true, allowed_email_domains: [], vocabulary_overrides: {} },
      vocabulary: { workspace: "Team", workspace_member: "Member" },
    },
  ],
  workspaces: [
    { id: WS, orgId: ORG, name: "Class 1", slug: "class-1", role: "member", memberStatus: "active", archived: false },
    { id: WS2, orgId: ORG2, name: "Design", slug: "design", role: "admin", memberStatus: "active", archived: false },
  ],
  lastWorkspaceId: WS,
}

beforeEach(async () => {
  resetWorkspaceState()
  h.hasOrganizations.mockReturnValue(true)
  window.localStorage.clear()
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: MEMBERSHIPS }) }) as Response))
  await hydrateWorkspaces()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("useWorkspace", () => {
  it("resolves the active workspace and the organization it belongs to", () => {
    const { result } = renderHook(() => useWorkspace())
    expect(result.current.status).toBe("ready")
    expect(result.current.activeWorkspace).toMatchObject({ id: WS, name: "Class 1" })
    expect(result.current.activeOrganization).toMatchObject({ id: ORG, name: "School A" })
  })

  it("re-renders on a switch and follows it to the other organization", () => {
    const { result } = renderHook(() => useWorkspace())
    act(() => result.current.setActiveWorkspace(WS2))
    expect(result.current.activeWorkspace?.id).toBe(WS2)
    expect(result.current.activeOrganization?.id).toBe(ORG2)
  })

  it("the personal space has neither a workspace nor an organization", () => {
    const { result } = renderHook(() => useWorkspace())
    act(() => result.current.setActiveWorkspace(null))
    expect(result.current.activeWorkspace).toBeNull()
    expect(result.current.activeOrganization).toBeNull()
  })
})

describe("useVocabulary", () => {
  it("speaks the active organization's own words", () => {
    const { result } = renderHook(() => useVocabulary())
    expect(result.current.workspace).toBe("Class")
    expect(result.current.workspace_member).toBe("Student")
  })

  it("follows a switch into a differently-worded organization", () => {
    const { result, rerender } = renderHook(() => useVocabulary())
    act(() => setActiveWorkspace(WS2))
    rerender()
    expect(result.current.workspace).toBe("Team")
  })

  it("can be asked about a named organization instead of the active one", () => {
    const { result } = renderHook(() => useVocabulary(ORG2))
    expect(result.current.workspace).toBe("Team")
  })

  it("falls back to words that name nothing a classroom when no organization is in view", () => {
    const { result } = renderHook(() => useVocabulary())
    act(() => setActiveWorkspace(null))
    expect(result.current).toEqual(FALLBACK_VOCABULARY)
    expect(result.current.workspace).toBe("Team")
    expect(Object.values(result.current).join(" ")).not.toMatch(/class|student|teacher/i)
  })

  it("falls back for an organization the caller does not belong to", () => {
    const { result } = renderHook(() => useVocabulary("10000000-0000-4000-8000-000000000099"))
    expect(result.current).toEqual(FALLBACK_VOCABULARY)
  })
})
