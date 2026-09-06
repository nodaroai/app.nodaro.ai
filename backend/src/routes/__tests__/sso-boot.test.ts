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

/**
 * `initiateUrlByHost` is validated at boot like every other provider
 * field: a typo'd entry must abort startup, not vanish and leave the IdP bounce
 * silently pointing at the wrong host.
 *
 * `parseSsoProviders` IS what `ssoRoutes` runs at register time (through
 * `getSsoProviders`); calling it with an explicit payload sidesteps that
 * module-level memo, so several provider lists can be checked in one file.
 */
import { parseSsoProviders } from "../../lib/sso-providers.js"

describe("EXTERNAL_SSO_PROVIDERS schema — initiateUrlByHost", () => {
  const base = {
    id: "librechat",
    label: "LibreChat",
    kind: "assertion",
    secret: "test-sso-hmac-secret-not-real-000",
    audience: "nodaro",
    initiateUrl: "https://idp.example/login",
  }

  it("accepts a valid host → URL map", () => {
    const [p] = parseSsoProviders(
      JSON.stringify([{ ...base, initiateUrlByHost: { "studio.example.com": "https://chat.example.com/login" } }]),
    )
    expect(p.initiateUrlByHost).toEqual({ "studio.example.com": "https://chat.example.com/login" })
  })

  it("REFUSES a non-URL value at boot", () => {
    expect(() =>
      parseSsoProviders(JSON.stringify([{ ...base, initiateUrlByHost: { "studio.example.com": "chat.example.com" } }])),
    ).toThrow(/EXTERNAL_SSO_PROVIDERS invalid/)
  })

  it("leaves the field absent when no map is configured (today's provider)", () => {
    const [p] = parseSsoProviders(JSON.stringify([base]))
    expect(p.initiateUrlByHost).toBeUndefined()
  })
})
