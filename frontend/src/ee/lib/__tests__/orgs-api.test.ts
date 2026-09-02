import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  getAuthHeaders: vi.fn(async () => ({ Authorization: "Bearer jwt", "X-Nodaro-Workspace": "ws-1" })),
}))

vi.mock("@/lib/api", () => ({ getAuthHeaders: h.getAuthHeaders }))

import {
  OrgApiError,
  acceptInvitation,
  actOnJoinCode,
  createInvitations,
  createOrganization,
  fetchUsageCsv,
  getJoinCode,
  getOrgUsage,
  joinByCode,
  listInvitations,
  listOrgMembers,
  listOrgUsageRows,
  listOrgWorkspaces,
  listOrganizations,
  previewInvitation,
  setWorkspaceArchived,
  updateOrgMember,
} from "../orgs-api"

interface Call {
  url: string
  method: string
  headers: Record<string, string>
  body?: unknown
}

let calls: Call[] = []

function responds(payload: unknown, ok = true, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method ?? "GET",
        headers: (init?.headers as Record<string, string>) ?? {},
        body: init?.body ? JSON.parse(init.body as string) : undefined,
      })
      return { ok, status, json: async () => payload } as Response
    }),
  )
}

beforeEach(() => {
  calls = []
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("every authenticated call", () => {
  it("carries the auth headers, including the workspace the client is in", async () => {
    responds({ data: [] })
    await listOrganizations()
    expect(calls[0]).toMatchObject({
      url: "/v1/orgs",
      method: "GET",
      headers: { Authorization: "Bearer jwt", "X-Nodaro-Workspace": "ws-1" },
    })
    expect(calls[0].headers["Content-Type"]).toBeUndefined()
  })

  it("adds Content-Type only when it sends a body", async () => {
    responds({ data: { id: "o-1" } })
    await createOrganization({ name: "School A", kind: "school", acceptTerms: true })
    expect(calls[0]).toMatchObject({ method: "POST", url: "/v1/orgs" })
    expect(calls[0].headers["Content-Type"]).toBe("application/json")
    expect(calls[0].body).toEqual({ name: "School A", kind: "school", acceptTerms: true })
  })

  it("unwraps the data envelope", async () => {
    responds({ data: [{ id: "o-1", name: "School A" }] })
    await expect(listOrganizations()).resolves.toEqual([{ id: "o-1", name: "School A" }])
  })
})

describe("errors", () => {
  it("carry the code the UI branches on, plus the status", async () => {
    responds({ error: { code: "terms_required", message: "Accept the terms" } }, false, 400)
    const err = await createOrganization({ name: "S", kind: "school" }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(OrgApiError)
    expect(err).toMatchObject({ code: "terms_required", message: "Accept the terms", status: 400 })
  })

  it("stay usable when the body is not the envelope, or not JSON at all", async () => {
    responds({ nonsense: true }, false, 502)
    await expect(listOrganizations()).rejects.toMatchObject({ code: "internal_error", status: 502 })

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error("not json")
        },
      }) as unknown as Response),
    )
    await expect(listOrganizations()).rejects.toMatchObject({ code: "internal_error", status: 500 })
  })
})

describe("the public invitation preview", () => {
  it("sends NO credentials — the invitee is signed out and the token is the authorization", async () => {
    responds({ data: { orgName: "School A", state: "open" } })
    await previewInvitation("tok-123")
    expect(calls[0].url).toBe("/v1/invitations/by-token/tok-123")
    expect(calls[0].headers).toEqual({})
    expect(h.getAuthHeaders).not.toHaveBeenCalled()
  })

  it("escapes a token that would otherwise change the path", async () => {
    responds({ data: {} })
    await previewInvitation("a/b?c=d")
    expect(calls[0].url).toBe("/v1/invitations/by-token/a%2Fb%3Fc%3Dd")
  })

  it("reports an unknown invitation as its own code, not as a generic failure", async () => {
    responds({ error: { code: "invitation_not_found", message: "Invitation not found" } }, false, 404)
    await expect(previewInvitation("nope")).rejects.toMatchObject({ code: "invitation_not_found", status: 404 })
  })

  it("accepting DOES authenticate — that half is the signed-in half", async () => {
    responds({ data: { orgId: "o-1", workspaceId: "w-1" } })
    await acceptInvitation("tok-123")
    expect(calls[0]).toMatchObject({ method: "POST", url: "/v1/invitations/tok-123/accept" })
    expect(calls[0].headers.Authorization).toBe("Bearer jwt")
  })
})

describe("paged reads", () => {
  it("return the cursor alongside the rows, and default a missing one to null", async () => {
    responds({ data: [{ userId: "u-1" }], nextCursor: "abc" })
    await expect(listOrgMembers("o-1")).resolves.toEqual({ data: [{ userId: "u-1" }], nextCursor: "abc" })

    responds({ data: [] })
    await expect(listOrgMembers("o-1")).resolves.toEqual({ data: [], nextCursor: null })
  })

  it("build the query string from what was actually asked for", async () => {
    responds({ data: [] })
    await listOrgMembers("o-1")
    expect(calls[0].url).toBe("/v1/orgs/o-1/members")

    responds({ data: [] })
    await listOrgMembers("o-1", { cursor: "c1", limit: 25 })
    expect(calls[1].url).toBe("/v1/orgs/o-1/members?cursor=c1&limit=25")

    responds({ data: [] })
    await listInvitations("o-1", { status: "open", workspaceId: "w-1" })
    expect(calls[2].url).toBe("/v1/orgs/o-1/invitations?status=open&workspaceId=w-1")
  })

  it("throw the organization error rather than an empty page", async () => {
    responds({ error: { code: "insufficient_role", message: "no" } }, false, 403)
    await expect(listOrgMembers("o-1")).rejects.toMatchObject({ code: "insufficient_role", status: 403 })
  })
})

describe("paths and verbs", () => {
  it.each([
    ["archive", true, "/v1/workspaces/w-1/archive"],
    ["unarchive", false, "/v1/workspaces/w-1/unarchive"],
  ])("%s posts to %s", async (_name, archived, url) => {
    responds({ data: {} })
    await setWorkspaceArchived("w-1", archived as boolean)
    expect(calls[0]).toMatchObject({ method: "POST", url })
  })

  it("includeArchived is a flag, not a value", async () => {
    responds({ data: [] })
    await listOrgWorkspaces("o-1")
    expect(calls[0].url).toBe("/v1/orgs/o-1/workspaces")
    responds({ data: [] })
    await listOrgWorkspaces("o-1", true)
    expect(calls[1].url).toBe("/v1/orgs/o-1/workspaces?includeArchived=true")
  })

  it("a member patch sends only what changed", async () => {
    responds({ data: {} })
    await updateOrgMember("o-1", "u-2", { status: "suspended" })
    expect(calls[0]).toMatchObject({
      method: "PATCH",
      url: "/v1/orgs/o-1/members/u-2",
      body: { status: "suspended" },
    })
  })

  it("join-code actions all go to one endpoint", async () => {
    for (const action of ["rotate", "enable", "disable"] as const) {
      responds({ data: {} })
      await actOnJoinCode("w-1", action)
    }
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ["POST", "/v1/workspaces/w-1/join-code", { action: "rotate" }],
      ["POST", "/v1/workspaces/w-1/join-code", { action: "enable" }],
      ["POST", "/v1/workspaces/w-1/join-code", { action: "disable" }],
    ])
  })

  it("a workspace with no code yet reads as null, not as an error", async () => {
    responds({ data: null })
    await expect(getJoinCode("w-1")).resolves.toBeNull()
  })

  it("joining by code sends it verbatim — the server normalizes what people type", async () => {
    responds({ data: { orgId: "o-1", workspaceId: "w-1" } })
    await joinByCode("bcdf-ghjk")
    expect(calls[0]).toMatchObject({ method: "POST", url: "/v1/workspaces/join", body: { code: "bcdf-ghjk" } })
  })

  it("an invitation batch reports one row per address, links included", async () => {
    responds({
      data: [
        { email: "a@t.test", status: "sent" },
        { email: "b@t.test", status: "link_only", link: "https://app.test/join/tok" },
      ],
    })
    const out = await createInvitations("o-1", { emails: ["a@t.test", "b@t.test"], workspaceId: "w-1" })
    expect(out[1]).toEqual({ email: "b@t.test", status: "link_only", link: "https://app.test/join/tok" })
    expect(calls[0].body).toEqual({ emails: ["a@t.test", "b@t.test"], workspaceId: "w-1" })
  })
})

describe("usage (P15)", () => {
  function respondsCsv(text: string, filename: string) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, method: init?.method ?? "GET", headers: (init?.headers as Record<string, string>) ?? {} })
        return {
          ok: true,
          status: 200,
          blob: async () => new Blob([text], { type: "text/csv" }),
          headers: { get: (k: string) => (k.toLowerCase() === "content-disposition" ? `attachment; filename="${filename}"` : null) },
          json: async () => ({}),
        } as unknown as Response
      }),
    )
  }

  it("getOrgUsage builds the query and drops empty params", async () => {
    responds({ data: { rows: [] } })
    await getOrgUsage("o-1", { from: "2026-09-01", to: "2026-09-30", tz: "Asia/Jerusalem", groupBy: "day" })
    const url = calls[0].url
    expect(url.startsWith("/v1/orgs/o-1/usage?")).toBe(true)
    expect(url).toContain("from=2026-09-01")
    expect(url).toContain("to=2026-09-30")
    expect(url).toContain("tz=Asia%2FJerusalem")
    expect(url).toContain("groupBy=day")
    expect(url).not.toContain("workspaceId=")
    expect(url).not.toContain("userId=")
  })

  it("listOrgUsageRows forces groupBy=none", async () => {
    responds({ data: [], nextCursor: null })
    await listOrgUsageRows("o-1", { limit: 25 })
    expect(calls[0].url).toContain("groupBy=none")
    expect(calls[0].url).toContain("limit=25")
  })

  it("fetchUsageCsv sends auth headers, returns the blob, and parses the filename", async () => {
    respondsCsv("group,runs,credits\r\n", "usage-org-acme-2026-09-01_2026-09-30.csv")
    const { blob, filename } = await fetchUsageCsv("org", "o-1", { groupBy: "day" })
    expect(calls[0].headers.Authorization).toBe("Bearer jwt")
    expect(calls[0].url).toContain("format=csv")
    expect(filename).toBe("usage-org-acme-2026-09-01_2026-09-30.csv")
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.size).toBeGreaterThan(0)
  })

  it("fetchUsageCsv throws OrgApiError with the code on a 403 envelope", async () => {
    responds({ error: { code: "insufficient_role", message: "Members see their own usage only" } }, false, 403)
    await expect(fetchUsageCsv("workspace", "w-1")).rejects.toMatchObject({ code: "insufficient_role", status: 403 })
    await expect(fetchUsageCsv("workspace", "w-1")).rejects.toBeInstanceOf(OrgApiError)
  })
})
