import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import
// ---------------------------------------------------------------------------

const { mockConfig, mockSelect, mockCount, mockS3Send, mockPing, mockConnect, mockDisconnect, mockCredential, mockCipherSource } = vi.hoisted(() => ({
  // getNodaroCredential(): null = not connected; {token, source} = connected.
  mockCredential: vi.fn<() => Promise<{ token: string; source: "oauth" | "env" } | null>>(),
  // encryptionKeySource(): null = no key; else which env var supplies it.
  mockCipherSource: { value: "NODARO_ENCRYPTION_KEY" as "NODARO_ENCRYPTION_KEY" | "SOCIAL_ENCRYPTION_KEY" | null },
  mockConfig: {
    EDITION: "community",
    REDIS_URL: "redis://localhost:6379",
    R2_ACCOUNT_ID: "",
    R2_ACCESS_KEY_ID: "",
    R2_SECRET_ACCESS_KEY: "",
    R2_BUCKET_NAME: "nodaro-assets",
    R2_PUBLIC_URL: "",
    R2_ENDPOINT: "",
    KIE_API_KEY: "",
    REPLICATE_API_TOKEN: "",
    ANTHROPIC_API_KEY: "",
    GEMINI_API_KEY: "",
    ELEVENLABS_API_KEY: "",
    FAL_KEY: "",
  },
  mockSelect: vi.fn(),
  // The hasUsers head-count: select(..., {count, head}).not(...) -> {count}
  mockCount: vi.fn(),
  mockS3Send: vi.fn(),
  mockPing: vi.fn(),
  mockConnect: vi.fn(),
  mockDisconnect: vi.fn(),
}))

vi.mock("@/lib/config.js", () => ({
  config: mockConfig,
  isCloud: () => false,
  isCommunity: () => true,
  isBusiness: () => false,
  hasAdmin: () => false,
  hasCredits: () => false,
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn((_cols: string, opts?: { head?: boolean }) =>
        opts?.head ? { not: mockCount } : { limit: mockSelect },
      ),
    })),
  },
}))

// The route dynamic-imports this; the same relative path from src/routes.
vi.mock("../../lib/nodaro-connect.js", () => ({
  getNodaroCredential: mockCredential,
  isNodaroConnected: vi.fn(async () => (await mockCredential()) !== null),
}))

// The instance cipher: which variable (if any) supplies the encryption key.
vi.mock("../../lib/instance-cipher.js", () => ({
  encryptionKeySource: () => mockCipherSource.value,
}))

vi.mock("@/lib/storage.js", () => ({
  s3: { send: (...args: unknown[]) => mockS3Send(...args) },
  // Mirrors the real isStorageConfigured so the existing R2_* toggles in
  // these tests keep exercising the same decision the route makes.
  isStorageConfigured: () =>
    mockConfig.R2_ACCESS_KEY_ID.length > 0 &&
    mockConfig.R2_SECRET_ACCESS_KEY.length > 0 &&
    (mockConfig.R2_ENDPOINT.length > 0 || mockConfig.R2_ACCOUNT_ID.length > 0),
}))

vi.mock("ioredis", () => ({
  default: class MockRedis {
    connect = mockConnect
    ping = mockPing
    disconnect = mockDisconnect
  },
}))

import { setupStatusRoutes } from "../setup-status.js"
import { SYSTEM_ACCOUNT_EMAIL_PATTERN } from "../../lib/system-account.js"
import { applyAppSnapshot, setEnvProviderKeys, _resetProviderKeysRuntimeForTests } from "../../lib/provider-keys-runtime.js"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  // Healthy defaults; individual tests break specific probes.
  mockSelect.mockResolvedValue({ data: [], error: null })
  mockCount.mockResolvedValue({ count: 0, error: null })
  mockCredential.mockResolvedValue(null)
  mockCipherSource.value = "NODARO_ENCRYPTION_KEY"
  mockConnect.mockResolvedValue(undefined)
  mockPing.mockResolvedValue("PONG")
  mockS3Send.mockResolvedValue({})
  mockConfig.R2_ACCOUNT_ID = ""
  mockConfig.R2_ACCESS_KEY_ID = ""
  mockConfig.R2_SECRET_ACCESS_KEY = ""
  mockConfig.R2_ENDPOINT = ""
  mockConfig.KIE_API_KEY = ""
  mockConfig.REPLICATE_API_TOKEN = ""
  // Tiles resolve through the provider-keys runtime (env, then app). config
  // is a plain mock in this suite, so seed the runtime the way config.ts does.
  _resetProviderKeysRuntimeForTests()
  setEnvProviderKeys({})

  app = Fastify({ logger: false })
  await app.register(setupStatusRoutes)
})

describe("GET /v1/setup/status", () => {
  it("reports healthy db/redis, unconfigured storage, and missing providers on a bare install", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/setup/status" })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.edition).toBe("community")
    expect(body.checks.database).toMatchObject({ ok: true, status: "ok" })
    expect(body.checks.redis).toMatchObject({ ok: true, status: "ok" })
    expect(body.checks.storage).toMatchObject({ ok: false, status: "not_configured" })
    expect(body.checks.providers.ok).toBe(false)
    expect(body.checks.providers.keys).toEqual({
      nodaro: false,
      kie: false,
      replicate: false,
      anthropic: false,
      gemini: false,
      elevenlabs: false,
      fal: false,
      heygen: false,
      beeble: false,
      apify: false,
    })
    expect(body.checks.providers.hint).toContain("KIE_API_KEY")
    // Never cached — the page polls this for live status.
    expect(res.headers["cache-control"]).toBe("no-store")
  })

  it("distinguishes missing migrations from an unreachable database", async () => {
    mockSelect.mockResolvedValue({
      data: null,
      error: { code: "42P01", message: 'relation "profiles" does not exist' },
    })

    const res = await app.inject({ method: "GET", url: "/v1/setup/status" })
    expect(res.json().checks.database).toMatchObject({
      ok: false,
      status: "migrations_missing",
    })
  })

  it("reports database error without leaking the raw message", async () => {
    mockSelect.mockResolvedValue({
      data: null,
      error: { code: "XX000", message: "secret internal detail" },
    })

    const res = await app.inject({ method: "GET", url: "/v1/setup/status" })
    const db = res.json().checks.database
    expect(db).toMatchObject({ ok: false, status: "error" })
    expect(JSON.stringify(db)).not.toContain("secret internal detail")
  })

  it("reports redis down while other probes stay green", async () => {
    mockConnect.mockRejectedValue(new Error("ECONNREFUSED"))

    const res = await app.inject({ method: "GET", url: "/v1/setup/status" })
    const body = res.json()
    expect(body.checks.redis).toMatchObject({ ok: false, status: "error" })
    expect(body.checks.database.ok).toBe(true)
    expect(mockDisconnect).toHaveBeenCalled()
  })

  it("probes storage connectivity when R2 is configured", async () => {
    mockConfig.R2_ACCOUNT_ID = "acct"
    mockConfig.R2_ACCESS_KEY_ID = "key"
    mockConfig.R2_SECRET_ACCESS_KEY = "secret"

    const res = await app.inject({ method: "GET", url: "/v1/setup/status" })
    expect(res.json().checks.storage).toMatchObject({ ok: true, status: "ok" })
    expect(mockS3Send).toHaveBeenCalledTimes(1)
  })

  it("treats a custom S3 endpoint (MinIO) as configured without an R2 account id", async () => {
    mockConfig.R2_ENDPOINT = "http://minio:9000"
    mockConfig.R2_ACCESS_KEY_ID = "key"
    mockConfig.R2_SECRET_ACCESS_KEY = "secret"

    const res = await app.inject({ method: "GET", url: "/v1/setup/status" })
    expect(res.json().checks.storage).toMatchObject({ ok: true, status: "ok" })
  })

  it("reports provider keys as present without exposing values", async () => {
    setEnvProviderKeys({ kie: "kie-secret-value" })

    const res = await app.inject({ method: "GET", url: "/v1/setup/status" })
    const body = res.json()
    expect(body.checks.providers.ok).toBe(true)
    expect(body.checks.providers.keys.kie).toBe(true)
    expect(JSON.stringify(body)).not.toContain("kie-secret-value")
  })

  // nodaro.ai is a provider like the other six — one tile in `keys`, lit by
  // either the OAuth connection or NODARO_API_KEY. It used to live outside the
  // list as a banner-only boolean, so "0/6 set" ignored it and it never read
  // as a provider (founder feedback 2026-08-16).
  it("lists nodaro.ai first among the provider keys, unset when not connected", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/setup/status" })
    const providers = res.json().checks.providers
    expect(Object.keys(providers.keys)[0]).toBe("nodaro")
    expect(providers.keys.nodaro).toBe(false)
    expect(providers.nodaroSource).toBeNull()
    expect(providers.ok).toBe(false)
    expect(providers.hint).toContain("NODARO_API_KEY")
  })

  // The instance encryption key is what makes pasted provider keys (and social
  // tokens) storable. The screen must show whether one exists and where it
  // came from — never the key. On the community stack start.sh generates and
  // persists it; a managed deploy without one shows a red card with the fix.
  it("reports the encryption key's presence and source, never the key", async () => {
    mockCipherSource.value = null
    let res = await app.inject({ method: "GET", url: "/v1/setup/status" })
    expect(res.json().checks.encryption).toMatchObject({ ok: false, status: "missing" })
    expect(res.json().checks.encryption.hint).toContain("NODARO_ENCRYPTION_KEY")

    mockCipherSource.value = "NODARO_ENCRYPTION_KEY"
    process.env.NODARO_ENCRYPTION_KEY_SOURCE = "generated"
    res = await app.inject({ method: "GET", url: "/v1/setup/status" })
    expect(res.json().checks.encryption).toEqual({ ok: true, status: "ok", source: "generated", envVar: "NODARO_ENCRYPTION_KEY" })
    delete process.env.NODARO_ENCRYPTION_KEY_SOURCE

    mockCipherSource.value = "SOCIAL_ENCRYPTION_KEY"
    res = await app.inject({ method: "GET", url: "/v1/setup/status" })
    expect(res.json().checks.encryption).toEqual({ ok: true, status: "ok", source: "env", envVar: "SOCIAL_ENCRYPTION_KEY" })
    expect(JSON.stringify(res.json())).not.toMatch(/[0-9a-f]{64}/)
  })

  // The tile list is DERIVED from the backend's provider-key list, so a key
  // the backend requires can no longer be missing from the screen (HeyGen,
  // Beeble and Apify were — 2026-08-16). Each tile carries its label, what
  // it powers, where to get it, its env var, and whether connecting nodaro.ai
  // stands in for it.
  it("ships every backend provider key with labels and cloud coverage", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/setup/status" })
    const providers = res.json().checks.providers
    expect(Object.keys(providers.keys)).toEqual([
      "nodaro", "kie", "replicate", "anthropic", "gemini", "elevenlabs", "fal", "heygen", "beeble", "apify",
    ])
    // HeyGen is covered by the connection (its jobs replay on the cloud) and
    // sits apart as a node-specific key; nodaro.ai itself is the connection.
    expect(providers.meta.heygen).toMatchObject({ name: "HeyGen", env: "HEYGEN_API_KEY", cloudCovered: true, scope: "node" })
    expect(providers.meta.heygen.powers).toMatch(/avatar/i)
    expect(providers.meta.kie).toMatchObject({ cloudCovered: true, scope: "core" })
    expect(providers.meta.nodaro.cloudCovered).toBe(false)
  })

  it("reports where each set key comes from — env, app (pasted on /setup) or oauth — never a value", async () => {
    setEnvProviderKeys({ kie: "kie-from-env" })
    applyAppSnapshot({ heygen: "hg-from-app" })
    mockCredential.mockResolvedValue({ token: "ndr_app_x", source: "oauth" })
    const res = await app.inject({ method: "GET", url: "/v1/setup/status" })
    const providers = res.json().checks.providers
    expect(providers.keys.kie).toBe(true)
    expect(providers.sources.kie).toBe("env")
    expect(providers.keys.heygen).toBe(true)
    expect(providers.sources.heygen).toBe("app")
    expect(providers.sources.nodaro).toBe("oauth")
    expect(providers.sources.fal).toBeNull()
    expect(JSON.stringify(res.json())).not.toMatch(/kie-from-env|hg-from-app|ndr_app_x/)
  })

  it("lights the nodaro.ai tile from the OAuth connection and says so", async () => {
    mockCredential.mockResolvedValue({ token: "ndr_app_x", source: "oauth" })
    const res = await app.inject({ method: "GET", url: "/v1/setup/status" })
    const providers = res.json().checks.providers
    expect(providers.keys.nodaro).toBe(true)
    expect(providers.nodaroSource).toBe("oauth")
    expect(providers.nodaroCloud).toBe(true)
    expect(providers.ok).toBe(true)
    expect(JSON.stringify(res.json())).not.toContain("ndr_app_x")
  })

  it("lights the nodaro.ai tile from NODARO_API_KEY and says so", async () => {
    mockCredential.mockResolvedValue({ token: "ndr_personal", source: "env" })
    const res = await app.inject({ method: "GET", url: "/v1/setup/status" })
    const providers = res.json().checks.providers
    expect(providers.keys.nodaro).toBe(true)
    expect(providers.nodaroSource).toBe("env")
    expect(providers.ok).toBe(true)
    expect(JSON.stringify(res.json())).not.toContain("ndr_personal")
  })

  // hasUsers drives the guided setup's step 1 ("create your server login").
  // The tutorial seed creates a SERVER-OWNED account on first boot; the moment
  // that seed actually ran on the community stack (2026-08-16) a pristine
  // install reported hasUsers=true and told a brand-new self-hoster their
  // login was already DONE. Server-owned accounts must never count.
  it("hasUsers is false on a pristine install", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/setup/status" })
    expect(res.json().hasUsers).toBe(false)
  })

  it("hasUsers excludes the server-owned system accounts by their email domain", async () => {
    await app.inject({ method: "GET", url: "/v1/setup/status" })
    expect(mockCount).toHaveBeenCalledWith("email", "like", SYSTEM_ACCOUNT_EMAIL_PATTERN)
  })

  it("hasUsers is true once a human account exists", async () => {
    mockCount.mockResolvedValue({ count: 1, error: null })
    const res = await app.inject({ method: "GET", url: "/v1/setup/status" })
    expect(res.json().hasUsers).toBe(true)
  })
})
