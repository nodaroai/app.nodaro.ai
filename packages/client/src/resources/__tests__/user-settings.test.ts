import { describe, it, expect, vi } from "vitest"
import { createClient, StaticTokenAuth, UnauthorizedError, ForbiddenError, NodaroError } from "../../index.js"
import type { UserSettings } from "../../index.js"

function mockOk<T>(body: T) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response)
}
function mockErr(status: number, body: unknown) {
  return Promise.resolve({ ok: false, status, json: async () => body } as unknown as Response)
}

const SETTINGS: UserSettings = {
  tier: "pro",
  publicOutputs: true,
  promptTemplates: {},
  textTemplates: [],
  preferredLocale: "he",
  mcpPreferences: {},
  showRecentNodes: false,
  showMostUsedNodes: false,
  variableDisplayMode: "raw",
  nodeDoubleClickAction: "settings",
  monthlyStatementEmail: true,
}

function client(fetchMock: ReturnType<typeof vi.fn>) {
  return createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock })
}

describe("userSettings", () => {
  it("get() GETs /v1/user/settings and unwraps data", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: SETTINGS }))
    expect(await client(fetchMock).userSettings.get()).toEqual(SETTINGS)
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/user/settings")
    expect((fetchMock.mock.calls[0][1] as { method: string }).method).toBe("GET")
  })

  it("update() PATCHes only the fields sent and unwraps the settings as saved", async () => {
    const { tier: _tier, ...saved } = { ...SETTINGS, monthlyStatementEmail: false }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: saved }))
    expect(await client(fetchMock).userSettings.update({ monthlyStatementEmail: false })).toEqual(saved)
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/user/settings")
    const init = fetchMock.mock.calls[0][1] as { method: string; body: string }
    expect(init.method).toBe("PATCH")
    expect(JSON.parse(init.body)).toEqual({ monthlyStatementEmail: false })
  })

  it("throws UnauthorizedError signed out, ForbiddenError for private outputs below the plan, and a NodaroError with the server's code on a bad value", async () => {
    await expect(client(vi.fn().mockReturnValueOnce(mockErr(401, { error: "Authentication required" }))).userSettings.get()).rejects.toBeInstanceOf(UnauthorizedError)
    await expect(client(vi.fn().mockReturnValueOnce(mockErr(403, { error: "Private mode is available on Standard plan and above" }))).userSettings.update({ publicOutputs: false })).rejects.toBeInstanceOf(ForbiddenError)
    const bad = client(vi.fn().mockReturnValueOnce(mockErr(400, { error: { code: "validation_error", message: "Invalid" } }))).userSettings.update({ preferredLocale: "xx" as never })
    await expect(bad).rejects.toBeInstanceOf(NodaroError)
    await expect(bad).rejects.toMatchObject({ status: 400, code: "validation_error" })
  })
})
