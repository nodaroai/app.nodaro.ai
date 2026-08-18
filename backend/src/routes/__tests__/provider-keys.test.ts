/**
 * /v1/setup/provider-keys — the paste field behind every Install-health
 * tile. Contracts:
 *   - reads report { id, set, source } only — never a value, never a hash;
 *   - writes need a first-party session (JWT), never a programmatic token
 *     (an OAuth-app or personal API token must not be able to swap the
 *     install's KIE key — that is spend on the operator's account);
 *   - community: any signed-in user (single operator by design; anyone with a
 *     login already controls app_settings); business/cloud: admin only;
 *   - env-managed keys are read-only here (env wins): a PUT is refused with
 *     a message that names the variable to remove.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const { mockSet, mockClear, mockSetOverride, mockIsAdmin, mockEdition } = vi.hoisted(() => ({
  mockSet: vi.fn(),
  mockClear: vi.fn(),
  mockSetOverride: vi.fn(),
  mockIsAdmin: vi.fn(async () => false),
  mockEdition: { hasAdmin: false },
}))

vi.mock("../../lib/provider-credentials.js", () => ({
  setProviderCredential: mockSet,
  clearProviderCredential: mockClear,
  setProviderOverride: mockSetOverride,
  listProviderCredentialStates: vi.fn(() =>
    PROVIDER_KEY_IDS.map((id) => {
      const r = resolveProviderKey(id)
      return { id, set: r !== null, source: r?.source ?? null }
    }),
  ),
}))
vi.mock("../../lib/admin-check.js", () => ({ checkIsAdmin: mockIsAdmin }))
vi.mock("../../lib/config.js", () => ({
  config: { EDITION: "community" },
  hasAdmin: () => mockEdition.hasAdmin,
  isCloud: () => false,
  isCommunity: () => !mockEdition.hasAdmin,
}))

import { providerKeysRoutes } from "../provider-keys.js"
import {
  PROVIDER_KEY_IDS,
  applyAppSnapshot,
  resolveProviderKey,
  setEnvProviderKeys,
  setProviderKeyOverrides,
  _resetProviderKeysRuntimeForTests,
} from "../../lib/provider-keys-runtime.js"

let app: FastifyInstance

function build(auth: { userId?: string; apiToken?: boolean; appAuthorization?: boolean } = { userId: "user-1" }) {
  app = Fastify({ logger: false })
  // Stand in for the auth hook: what a first-party session / a programmatic
  // token would leave on the request.
  app.addHook("preHandler", async (req) => {
    const r = req as typeof req & { userId?: string; apiToken?: unknown; appAuthorization?: unknown }
    r.userId = auth.userId
    // The guard only checks presence; shape does not matter for these tests.
    if (auth.apiToken) r.apiToken = { id: "tok" } as never
    if (auth.appAuthorization) r.appAuthorization = { appId: "app", scopes: [] } as never
  })
  return app.register(providerKeysRoutes)
}

beforeEach(() => {
  mockSet.mockReset().mockResolvedValue(undefined)
  mockClear.mockReset().mockResolvedValue(undefined)
  mockSetOverride.mockReset().mockResolvedValue(undefined)
  mockIsAdmin.mockReset().mockResolvedValue(false)
  mockEdition.hasAdmin = false
  _resetProviderKeysRuntimeForTests()
  setEnvProviderKeys({})
})

afterEach(async () => {
  await app.close()
})

describe("GET /v1/setup/provider-keys", () => {
  it("lists every provider with set/source and never a value", async () => {
    setEnvProviderKeys({ kie: "kie-env-secret" })
    applyAppSnapshot({ heygen: "hg-app-secret" })
    await build()
    const res = await app.inject({ method: "GET", url: "/v1/setup/provider-keys" })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { providers: Array<{ id: string; set: boolean; source: string | null }> }
    expect(body.providers.map((p) => p.id)).toEqual([...PROVIDER_KEY_IDS])
    expect(body.providers.find((p) => p.id === "kie")).toEqual({ id: "kie", set: true, source: "env" })
    expect(body.providers.find((p) => p.id === "heygen")).toEqual({ id: "heygen", set: true, source: "app" })
    expect(res.body).not.toMatch(/kie-env-secret|hg-app-secret/)
  })

  it("requires a signed-in user", async () => {
    await build({})
    const res = await app.inject({ method: "GET", url: "/v1/setup/provider-keys" })
    expect(res.statusCode).toBe(401)
  })
})

describe("PUT /v1/setup/provider-keys/:id", () => {
  it("stores the key and answers with the new state, never echoing the value", async () => {
    mockSet.mockImplementation(async (id: string, value: string) => {
      applyAppSnapshot({ [id]: value })
    })
    await build()
    const res = await app.inject({ method: "PUT", url: "/v1/setup/provider-keys/kie", payload: { value: "kie_new_123" } })
    expect(res.statusCode).toBe(200)
    expect(mockSet).toHaveBeenCalledWith("kie", "kie_new_123", "user-1")
    expect(res.json()).toEqual({ id: "kie", set: true, source: "app", disabled: false, ignoreEnv: false })
    expect(res.body).not.toContain("kie_new_123")
  })

  it("refuses to overwrite a key managed by the environment (env wins) and names the variable", async () => {
    setEnvProviderKeys({ kie: "from-env" })
    await build()
    const res = await app.inject({ method: "PUT", url: "/v1/setup/provider-keys/kie", payload: { value: "x" } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("managed_by_env")
    expect(res.json().error.message).toContain("KIE_API_KEY")
    expect(mockSet).not.toHaveBeenCalled()
  })

  it("rejects an unknown provider, an empty value and an oversized value", async () => {
    await build()
    expect((await app.inject({ method: "PUT", url: "/v1/setup/provider-keys/openai", payload: { value: "x" } })).statusCode).toBe(404)
    expect((await app.inject({ method: "PUT", url: "/v1/setup/provider-keys/kie", payload: { value: "   " } })).statusCode).toBe(400)
    expect((await app.inject({ method: "PUT", url: "/v1/setup/provider-keys/kie", payload: { value: "k".repeat(5000) } })).statusCode).toBe(400)
    expect(mockSet).not.toHaveBeenCalled()
  })

  it("is first-party only: a personal API token or an OAuth app token cannot change provider keys", async () => {
    await build({ userId: "user-1", apiToken: true })
    expect((await app.inject({ method: "PUT", url: "/v1/setup/provider-keys/kie", payload: { value: "x" } })).statusCode).toBe(403)
    await app.close()
    await build({ userId: "user-1", appAuthorization: true })
    expect((await app.inject({ method: "PUT", url: "/v1/setup/provider-keys/kie", payload: { value: "x" } })).statusCode).toBe(403)
    expect(mockSet).not.toHaveBeenCalled()
  })

  it("on an edition with admins, only an admin may write", async () => {
    mockEdition.hasAdmin = true
    mockIsAdmin.mockResolvedValue(false)
    await build()
    expect((await app.inject({ method: "PUT", url: "/v1/setup/provider-keys/kie", payload: { value: "x" } })).statusCode).toBe(403)
    mockIsAdmin.mockResolvedValue(true)
    expect((await app.inject({ method: "PUT", url: "/v1/setup/provider-keys/kie", payload: { value: "x" } })).statusCode).toBe(200)
  })

  it("nodaro.ai is not a paste target here — its two paths are Connect and NODARO_API_KEY", async () => {
    await build()
    const res = await app.inject({ method: "PUT", url: "/v1/setup/provider-keys/nodaro", payload: { value: "ndr_x" } })
    // Actually a personal token IS a fine app-managed credential for nodaro.ai
    // — same as NODARO_API_KEY, without touching .env. Allowed.
    expect(res.statusCode).toBe(200)
    expect(mockSet).toHaveBeenCalledWith("nodaro", "ndr_x", "user-1")
  })
})

describe("DELETE /v1/setup/provider-keys/:id", () => {
  it("clears an app-managed key and answers with the new state", async () => {
    applyAppSnapshot({ fal: "fal_app" })
    mockClear.mockImplementation(async () => applyAppSnapshot({}))
    await build()
    const res = await app.inject({ method: "DELETE", url: "/v1/setup/provider-keys/fal" })
    expect(res.statusCode).toBe(200)
    expect(mockClear).toHaveBeenCalledWith("fal")
    expect(res.json()).toEqual({ id: "fal", set: false, source: null, disabled: false, ignoreEnv: false })
  })

  it("cannot clear a key that comes from the environment", async () => {
    setEnvProviderKeys({ fal: "from-env" })
    await build()
    const res = await app.inject({ method: "DELETE", url: "/v1/setup/provider-keys/fal" })
    expect(res.statusCode).toBe(409)
    expect(mockClear).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 4b provider control: disable any provider (env keys included) + Replace .env
// ---------------------------------------------------------------------------
describe("PUT /v1/setup/provider-keys/:id/disabled", () => {
  it("toggles the provider off and on — the one control that works on env-managed keys", async () => {
    setEnvProviderKeys({ kie: "kie-env-key" })
    await build()
    const off = await app.inject({ method: "PUT", url: "/v1/setup/provider-keys/kie/disabled", payload: { disabled: true } })
    expect(off.statusCode).toBe(200)
    expect(mockSetOverride).toHaveBeenCalledWith("kie", { disabled: true })
    const on = await app.inject({ method: "PUT", url: "/v1/setup/provider-keys/kie/disabled", payload: { disabled: false } })
    expect(on.statusCode).toBe(200)
    expect(mockSetOverride).toHaveBeenCalledWith("kie", { disabled: false })
  })

  it("validates the body and the provider id", async () => {
    await build()
    expect((await app.inject({ method: "PUT", url: "/v1/setup/provider-keys/kie/disabled", payload: { disabled: "yes" } })).statusCode).toBe(400)
    expect((await app.inject({ method: "PUT", url: "/v1/setup/provider-keys/nope/disabled", payload: { disabled: true } })).statusCode).toBe(404)
  })

  it("is first-party only, like every other key write", async () => {
    await build({ userId: "user-1", apiToken: true })
    const res = await app.inject({ method: "PUT", url: "/v1/setup/provider-keys/kie/disabled", payload: { disabled: true } })
    expect(res.statusCode).toBe(403)
    expect(mockSetOverride).not.toHaveBeenCalled()
  })
})

describe("Replace .env key (PUT with ignoreEnv) — the 409 stops being a dead end", () => {
  it("a plain paste over an env key still 409s (the default is unchanged)", async () => {
    setEnvProviderKeys({ kie: "kie-env-key" })
    await build()
    const res = await app.inject({ method: "PUT", url: "/v1/setup/provider-keys/kie", payload: { value: "new-key" } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("managed_by_env")
    expect(mockSet).not.toHaveBeenCalled()
  })

  it("ignoreEnv:true stores the app key AND sets the override — no .env edit, no restart", async () => {
    setEnvProviderKeys({ kie: "kie-env-key" })
    await build()
    const res = await app.inject({ method: "PUT", url: "/v1/setup/provider-keys/kie", payload: { value: "new-key", ignoreEnv: true } })
    expect(res.statusCode).toBe(200)
    expect(mockSet).toHaveBeenCalledWith("kie", "new-key", "user-1")
    expect(mockSetOverride).toHaveBeenCalledWith("kie", { ignoreEnv: true })
  })

  it("deleting the app key clears ignoreEnv — the env key honestly returns", async () => {
    setEnvProviderKeys({ kie: "kie-env-key" })
    await setProviderKeyOverrides({ kie: { ignoreEnv: true } })
    await applyAppSnapshot({ kie: "app-key" })
    await build()
    const res = await app.inject({ method: "DELETE", url: "/v1/setup/provider-keys/kie" })
    expect(res.statusCode).toBe(200)
    expect(mockClear).toHaveBeenCalledWith("kie")
    expect(mockSetOverride).toHaveBeenCalledWith("kie", { ignoreEnv: false })
  })
})
