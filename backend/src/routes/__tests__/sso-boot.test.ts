import { describe, it, expect, vi } from "vitest"
import Fastify from "fastify"

// A malformed EXTERNAL_SSO_PROVIDERS must abort BOOT (register), never silently
// disable auth. This suite deliberately does NOT mock sso-providers — the real
// parser runs against a mocked config. Redis/Supabase are stubbed only so
// importing the route module doesn't open real connections.
vi.mock("../../lib/config.js", async (orig) => {
  const actual = await orig<typeof import("../../lib/config.js")>()
  return { ...actual, config: { ...actual.config, EXTERNAL_SSO_PROVIDERS: "{ not valid json" } }
})
vi.mock("../../lib/queue.js", () => ({
  redis: { incr: vi.fn(), expire: vi.fn(), ttl: vi.fn(), set: vi.fn() },
}))
vi.mock("../../lib/supabase.js", () => ({ supabase: { auth: { admin: {} } } }))

import { ssoRoutes } from "../sso.js"

describe("ssoRoutes boot (fail-loud config)", () => {
  it("FAILS registration when EXTERNAL_SSO_PROVIDERS is malformed", async () => {
    const app = Fastify()
    await expect(app.register(ssoRoutes)).rejects.toThrow(/EXTERNAL_SSO_PROVIDERS/i)
    await app.close()
  })
})
