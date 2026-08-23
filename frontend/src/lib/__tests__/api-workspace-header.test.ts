import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { WORKSPACE_HEADER } from "@nodaro/shared"

const h = vi.hoisted(() => ({
  getSession: vi.fn(async () => ({ data: { session: { user: { id: "u-1" }, access_token: "jwt-token" } } })),
  getActiveWorkspaceId: vi.fn<() => string | null>(() => null),
  clearActiveWorkspaceAfterRefusal: vi.fn(),
}))

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({ auth: { getSession: h.getSession }, from: () => ({ update: () => ({ eq: vi.fn() }) }) }),
}))
vi.mock("@/lib/workspace-context", () => ({
  getActiveWorkspaceId: h.getActiveWorkspaceId,
  clearActiveWorkspaceAfterRefusal: h.clearActiveWorkspaceAfterRefusal,
}))

import { editImage, getAuthHeaders } from "@/lib/api"

const WS = "20000000-0000-4000-8000-000000000001"

beforeEach(() => {
  h.getActiveWorkspaceId.mockReturnValue(null)
})
afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

/**
 * The workspace header rides on `getAuthHeaders`, the one function every REST
 * call in this client passes through. That placement is the point: a new call
 * site cannot forget the header, and there is exactly one thing to reason
 * about when asking "which workspace was that request in".
 */
describe("getAuthHeaders", () => {
  it("carries the session token, and no workspace header when none is selected", async () => {
    expect(await getAuthHeaders()).toEqual({ Authorization: "Bearer jwt-token" })
  })

  it("adds the workspace header when one is selected", async () => {
    h.getActiveWorkspaceId.mockReturnValue(WS)
    expect(await getAuthHeaders()).toEqual({ Authorization: "Bearer jwt-token", [WORKSPACE_HEADER]: WS })
  })

  it("still adds it for a signed-out caller — the server decides, not the client", async () => {
    h.getSession.mockResolvedValueOnce({ data: { session: null } } as never)
    h.getActiveWorkspaceId.mockReturnValue(WS)
    expect(await getAuthHeaders()).toEqual({ [WORKSPACE_HEADER]: WS })
  })

  it("survives a session lookup that throws", async () => {
    h.getSession.mockRejectedValueOnce(new Error("network"))
    h.getActiveWorkspaceId.mockReturnValue(WS)
    expect(await getAuthHeaders()).toEqual({ [WORKSPACE_HEADER]: WS })
  })

  it("uses the exact header name the wire contract declares", () => {
    expect(WORKSPACE_HEADER).toBe("X-Nodaro-Workspace")
  })
})

/**
 * A selection the server refuses is a selection worth dropping: it is a
 * preference, so keeping it only guarantees that every following request
 * fails the same way. `throwApiError` is the one place every REST call's
 * failure passes through, which is why the clearing lives there.
 */
describe("a refused workspace selection", () => {
  function failsWith(code: string, status = 403) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status,
        json: async () => ({ error: { code, message: "no" } }),
        text: async () => "",
      }) as Response),
    )
  }

  it.each(["not_a_member", "member_suspended"])("%s clears it", async (code) => {
    failsWith(code)
    await expect(editImage("http://img.png")).rejects.toThrow()
    expect(h.clearActiveWorkspaceAfterRefusal).toHaveBeenCalledTimes(1)
  })

  it("leaves it alone for every other failure", async () => {
    for (const code of ["insufficient_credits", "validation_error", "not_found", "internal_error"]) {
      failsWith(code, 400)
      await expect(editImage("http://img.png")).rejects.toThrow()
    }
    expect(h.clearActiveWorkspaceAfterRefusal).not.toHaveBeenCalled()
  })
})
