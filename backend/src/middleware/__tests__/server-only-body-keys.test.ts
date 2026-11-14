// @test-watches backend/src/app.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const SECRET = vi.hoisted(() => "internal-secret-for-this-test-only-0123456789")

vi.mock("@/lib/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config.js")>()
  return { ...actual, config: { ...actual.config, INTERNAL_ORCHESTRATOR_SECRET: SECRET } }
})

import { callerBodyOf, registerServerOnlyBodyKeysHook } from "../server-only-body-keys.js"

let app: FastifyInstance
/** The body each route's pre-handler was given. */
let seen: unknown[]

beforeEach(async () => {
  seen = []
  app = Fastify({ logger: false })
  registerServerOnlyBodyKeysHook(app)
  const record = { preHandler: async (req: { body: unknown }) => void seen.push(req.body) }
  app.post("/v1/thing", record, async () => ({ ok: true }))
  app.post("/v1/webhooks/provider", record, async () => ({ ok: true }))
  app.post("/v1/billing/stripe-webhook", record, async () => ({ ok: true }))
  app.post("/v1/telegram/webhook/:token", record, async () => ({ ok: true }))
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

const send = (url: string, payload: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: "POST", url, payload: payload as Record<string, unknown>, headers })

describe("the server's own body keys", () => {
  it("are dropped from a caller's body before any pre-handler reads it", async () => {
    await send("/v1/thing", { targetLanguage: "fr", __probedDurationSec: 1, nested: { __kept: 1 } })
    expect(seen).toEqual([{ targetLanguage: "fr", nested: { __kept: 1 } }])
  })

  it("stay on the body of a request carrying the internal secret", async () => {
    await send("/v1/thing", { a: 1, __probedDurationSec: 61 }, { "x-internal-orchestrator-secret": SECRET })
    expect(seen).toEqual([{ a: 1, __probedDurationSec: 61 }])
  })

  it("are dropped when the secret a request carries is not the internal one", async () => {
    await send("/v1/thing", { a: 1, __probedDurationSec: 1 }, { "x-internal-orchestrator-secret": "forged" })
    expect(seen).toEqual([{ a: 1 }])
  })

  it("are left on the bodies third parties post: a webhook trigger, Stripe's events, Telegram's updates", async () => {
    for (const url of ["/v1/webhooks/provider", "/v1/billing/stripe-webhook", "/v1/telegram/webhook/abc"]) {
      await send(url, { __event: "x" })
    }
    expect(seen).toEqual([{ __event: "x" }, { __event: "x" }, { __event: "x" }])
  })

  it("leave a body that is not an object as it is", async () => {
    await send("/v1/thing", [{ __a: 1 }])
    expect(seen).toEqual([[{ __a: 1 }]])
  })
})

describe("callerBodyOf", () => {
  const request = (secret?: string) => ({ headers: secret ? { "x-internal-orchestrator-secret": secret } : {} }) as never

  it("is the body less the server's keys for a caller, and the body as sent for an internal request", () => {
    const body = { a: 1, __b: 2 }
    expect(callerBodyOf(request(), body)).toEqual({ a: 1 })
    expect(callerBodyOf(request(SECRET), body)).toBe(body)
  })
})

describe("the app", () => {
  it("drops the keys from every request: the hook is registered once, before the other request hooks", () => {
    const source = readFileSync(join(__dirname, "..", "..", "app.ts"), "utf8")
    const calls = source.match(/^\s*registerServerOnlyBodyKeysHook\(app\)/gm) ?? []
    expect(calls).toHaveLength(1)
    const at = source.indexOf("registerServerOnlyBodyKeysHook(app)")
    expect(at).toBeGreaterThan(source.indexOf("registerAuthHook(app)"))
    expect(at).toBeLessThan(source.indexOf("registerRetiredVideoProviderHook(app)"))
    expect(at).toBeLessThan(source.indexOf("registerTokenWorkflowScopeGuard(app)"))
  })
})
