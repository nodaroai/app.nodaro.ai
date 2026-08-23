/**
 * The connection store must tell "the instance is not connected" apart from
 * "the instance could not READ its connection". Boot-time provider
 * registration retries on the second and stops on the first; folding both
 * into `null` (as getNodaroConnection does for its callers) is what made the
 * cloud provider silently miss registration on every community boot — the
 * read raced the container's own proxy and looked like "not connected".
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { maybeSingleMock, upsertMock, mockConfig } = vi.hoisted(() => ({
  maybeSingleMock: vi.fn<() => Promise<{ data: unknown; error: { message: string } | null }>>(),
  upsertMock: vi.fn<(row: unknown, opts: unknown) => Promise<{ error: { message: string } | null }>>(),
  mockConfig: {
    NODARO_API_KEY: "" as string,
    NODARO_CLOUD_URL: "" as string,
    // The instance cipher (#864) reads these; "" = no key, like a bare config.
    NODARO_ENCRYPTION_KEY: "" as string,
    SOCIAL_ENCRYPTION_KEY: "" as string,
  },
}))

vi.mock("../config.js", () => ({ config: mockConfig }))

// The key lane now reads provider-keys-runtime directly (env -> app) so the
// SOURCE stays honest; seed it the way config.ts does in production.
import {
  _resetProviderKeysRuntimeForTests,
  applyAppSnapshot,
  setEnvProviderKeys,
} from "../provider-keys-runtime.js"

vi.mock("../supabase.js", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: maybeSingleMock,
        }),
      }),
      upsert: upsertMock,
    })),
  },
}))

import {
  clearNodaroConnection,
  getNodaroConnection,
  getNodaroCredential,
  isNodaroConnected,
  readNodaroConnectionState,
  saveNodaroConnection,
} from "../nodaro-connect.js"
import { resetInstanceCipherForTests } from "../instance-cipher.js"

const TEST_KEY = "a".repeat(64)

beforeEach(() => {
  maybeSingleMock.mockReset()
  upsertMock.mockReset()
  upsertMock.mockResolvedValue({ error: null })
  mockConfig.NODARO_API_KEY = ""
  mockConfig.NODARO_ENCRYPTION_KEY = ""
  mockConfig.SOCIAL_ENCRYPTION_KEY = ""
  resetInstanceCipherForTests()
  _resetProviderKeysRuntimeForTests()
  setEnvProviderKeys({})
  vi.spyOn(console, "error").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("readNodaroConnectionState", () => {
  it("is 'unavailable' when the store cannot be read (transport error)", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: { message: "TypeError: fetch failed" } })
    expect(await readNodaroConnectionState()).toEqual({ state: "unavailable", reason: "TypeError: fetch failed" })
  })

  it("is 'not-connected' when no row exists", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null })
    expect(await readNodaroConnectionState()).toEqual({ state: "not-connected" })
  })

  it("is 'not-connected' when registration started but the OAuth flow never finished", async () => {
    maybeSingleMock.mockResolvedValue({
      data: { value: { clientId: "ndr_dcr_x", clientSecret: "s" } },
      error: null,
    })
    expect(await readNodaroConnectionState()).toEqual({ state: "not-connected" })
  })

  it("is 'connected' once a token is stored (JSON string or object value)", async () => {
    const conn = { clientId: "ndr_dcr_x", clientSecret: "s", accessToken: "ndr_app_t", connectedAt: "2026-08-16T00:00:00Z" }
    maybeSingleMock.mockResolvedValue({ data: { value: conn }, error: null })
    expect(await readNodaroConnectionState()).toEqual({ state: "connected", source: "oauth", connection: conn })

    maybeSingleMock.mockResolvedValue({ data: { value: JSON.stringify(conn) }, error: null })
    expect(await readNodaroConnectionState()).toEqual({ state: "connected", source: "oauth", connection: conn })
  })

  it("is 'unavailable' when the read throws", async () => {
    maybeSingleMock.mockRejectedValue(new Error("socket hang up"))
    expect(await readNodaroConnectionState()).toEqual({ state: "unavailable", reason: "socket hang up" })
  })
})

// NODARO_API_KEY: nodaro.ai as a provider like the other six — a personal API
// token from app.nodaro.ai (Settings -> API) pasted into .env. It is a
// CREDENTIAL, not a registration: the OAuth flow's stored client_id/secret
// stay in getNodaroConnection(); everything that only needs to CALL the cloud
// asks getNodaroCredential(). A stored OAuth connection wins over the env key
// (it carries per-instance caps and Connected Instances visibility).
describe("NODARO_API_KEY as the credential", () => {
  const conn = { clientId: "c", clientSecret: "s", accessToken: "ndr_app_oauth", connectedAt: "2026-08-16T00:00:00Z" }

  it("is used when nothing is stored", async () => {
    setEnvProviderKeys({ nodaro: "ndr_personal_key" })
    maybeSingleMock.mockResolvedValue({ data: null, error: null })
    expect(await getNodaroCredential()).toEqual({ token: "ndr_personal_key", source: "env" })
    expect(await isNodaroConnected()).toBe(true)
    expect(await readNodaroConnectionState()).toEqual({ state: "connected", source: "env" })
  })

  it("loses to a stored OAuth connection", async () => {
    setEnvProviderKeys({ nodaro: "ndr_personal_key" })
    maybeSingleMock.mockResolvedValue({ data: { value: conn }, error: null })
    expect(await getNodaroCredential()).toEqual({ token: "ndr_app_oauth", source: "oauth" })
    expect(await readNodaroConnectionState()).toEqual({ state: "connected", source: "oauth", connection: conn })
  })

  it("makes the boot path race-free: an unreadable store still yields connected via env", async () => {
    // The whole reason the provider registration retries is that the store is
    // behind the container's own proxy at boot. With an env key there is
    // nothing to wait for.
    setEnvProviderKeys({ nodaro: "ndr_personal_key" })
    maybeSingleMock.mockResolvedValue({ data: null, error: { message: "TypeError: fetch failed" } })
    expect(await readNodaroConnectionState()).toEqual({ state: "connected", source: "env" })
    expect(await getNodaroCredential()).toEqual({ token: "ndr_personal_key", source: "env" })
  })

  it("does not masquerade as a registration for the OAuth flow", async () => {
    setEnvProviderKeys({ nodaro: "ndr_personal_key" })
    maybeSingleMock.mockResolvedValue({ data: null, error: null })
    // /start must still see "not registered" and register properly.
    expect(await getNodaroConnection()).toBeNull()
  })

  it("is trimmed and ignored when blank", async () => {
    mockConfig.NODARO_API_KEY = "   "
    maybeSingleMock.mockResolvedValue({ data: null, error: null })
    expect(await getNodaroCredential()).toBeNull()
    expect(await isNodaroConnected()).toBe(false)
  })
})

describe("getNodaroConnection / isNodaroConnected keep their null-on-failure contract", () => {
  it("returns null and false on a transport error", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: { message: "fetch failed" } })
    expect(await getNodaroConnection()).toBeNull()
    expect(await isNodaroConnected()).toBe(false)
  })

  it("returns the connection and true when connected", async () => {
    const conn = { clientId: "c", clientSecret: "s", accessToken: "t" }
    maybeSingleMock.mockResolvedValue({ data: { value: conn }, error: null })
    expect(await getNodaroConnection()).toEqual(conn)
    expect(await isNodaroConnected()).toBe(true)
  })
})

describe("clearNodaroConnection keeps the instance's DCR client (#708)", () => {
  it("drops the tokens but writes the clientId/clientSecret back — the next Connect reuses the registration", async () => {
    const stored = { clientId: "ndr_dcr_1", clientSecret: "s3cr3t", accessToken: "ndr_app_tok", connectedAt: "2026-08-16T16:05:41Z" }
    maybeSingleMock.mockResolvedValue({ data: { value: stored }, error: null })
    const { supabase } = await import("../supabase.js")
    const upsert = vi.fn().mockResolvedValue({ error: null })
    const del = vi.fn()
    vi.mocked(supabase.from).mockImplementation((() => ({
      select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock }) }),
      upsert,
      delete: del,
    })) as never)

    await clearNodaroConnection()

    expect(del).not.toHaveBeenCalled()
    expect(upsert).toHaveBeenCalledTimes(1)
    const row = upsert.mock.calls[0]![0] as { key: string; value: Record<string, unknown> }
    expect(row.value).toEqual({ clientId: "ndr_dcr_1", clientSecret: "s3cr3t" })
    expect(row.value).not.toHaveProperty("accessToken")
    expect(row.value).not.toHaveProperty("connectedAt")
  })

  it("is a no-op when nothing is stored", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null })
    const { supabase } = await import("../supabase.js")
    const upsert = vi.fn()
    vi.mocked(supabase.from).mockImplementation((() => ({
      select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock }) }),
      upsert,
      delete: vi.fn(),
    })) as never)
    await clearNodaroConnection()
    expect(upsert).not.toHaveBeenCalled()
  })
})

// A key pasted on /setup lives in the APP layer of provider-keys-runtime.
// Reporting it as "env" is what locked the tile read-only — the founder could
// not Remove/Change a key he had just pasted (4b plan, PR 1). The source must
// carry the true layer end to end.
describe("pasted (app-layer) key reports source 'app'", () => {
  it("credential + state carry 'app' for a pasted key", async () => {
    await applyAppSnapshot({ nodaro: "ndr_pasted_key" })
    maybeSingleMock.mockResolvedValue({ data: null, error: null })
    expect(await readNodaroConnectionState()).toEqual({ state: "connected", source: "app" })
    expect(await getNodaroCredential()).toEqual({ token: "ndr_pasted_key", source: "app" })
    expect(await isNodaroConnected()).toBe(true)
  })

  it("env wins over app within the key lane — mirroring resolveProviderKey", async () => {
    setEnvProviderKeys({ nodaro: "ndr_env_key" })
    await applyAppSnapshot({ nodaro: "ndr_pasted_key" })
    maybeSingleMock.mockResolvedValue({ data: null, error: null })
    expect(await getNodaroCredential()).toEqual({ token: "ndr_env_key", source: "env" })
  })

  it("OAuth still wins over a pasted key", async () => {
    await applyAppSnapshot({ nodaro: "ndr_pasted_key" })
    const conn = { clientId: "c", clientSecret: "s", accessToken: "ndr_app_oauth", connectedAt: "2026-08-16T00:00:00Z" }
    maybeSingleMock.mockResolvedValue({ data: { value: conn }, error: null })
    expect(await getNodaroCredential()).toEqual({ token: "ndr_app_oauth", source: "oauth" })
  })
})

// The connection row holds a clientSecret and a live, credit-spending
// accessToken. Provider keys one table over are ciphertext under the instance
// cipher; this row was plaintext JSON (#864). Sealed on write, both shapes
// accepted on read, legacy rows re-sealed on first read.
describe("connection row is sealed with the instance cipher (#864)", () => {
  const conn = { clientId: "ndr_dcr_abc", clientSecret: "s3cr3t-hex", accessToken: "ndr_app_tok", connectedAt: "2026-08-23T00:00:00Z" }

  // The #708 block above swaps `supabase.from` per test and leaves its last
  // implementation in place; put the shared upsert spy back.
  beforeEach(async () => {
    const { supabase } = await import("../supabase.js")
    vi.mocked(supabase.from).mockImplementation((() => ({
      select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock }) }),
      upsert: upsertMock,
      delete: vi.fn(),
    })) as never)
  })

  /** The `value` the last upsert wrote. */
  const writtenValue = (): unknown => (upsertMock.mock.calls.at(-1)?.[0] as { value: unknown }).value

  it("writes no plaintext secret when a key is configured, and reads its own envelope back", async () => {
    mockConfig.NODARO_ENCRYPTION_KEY = TEST_KEY
    await saveNodaroConnection(conn)
    const value = writtenValue() as { sealed: number; ciphertext: string }
    expect(value.sealed).toBe(2)
    expect(typeof value.ciphertext).toBe("string")
    const wire = JSON.stringify(value)
    for (const secret of [conn.clientSecret, conn.accessToken, "clientSecret", "accessToken"]) {
      expect(wire).not.toContain(secret)
    }
    // Round trip through the reader, and through the state reader that boot
    // registration and every credential check go through.
    maybeSingleMock.mockResolvedValue({ data: { value }, error: null })
    expect(await getNodaroConnection()).toEqual(conn)
    expect(await readNodaroConnectionState()).toEqual({ state: "connected", source: "oauth", connection: conn })
    expect(await getNodaroCredential()).toEqual({ token: "ndr_app_tok", source: "oauth" })
  })

  it("a legacy plaintext row still opens — and is re-sealed on first read when a key is available", async () => {
    mockConfig.NODARO_ENCRYPTION_KEY = TEST_KEY
    maybeSingleMock.mockResolvedValue({ data: { value: conn }, error: null })
    expect(await getNodaroConnection()).toEqual(conn)
    // Awaited, not fire-and-forget: a straggling re-seal would race the
    // caller's next write (disconnect strips the token; the re-seal carries it).
    expect(upsertMock).toHaveBeenCalledTimes(1)
    expect((writtenValue() as { sealed: number }).sealed).toBe(2)
    expect(JSON.stringify(writtenValue())).not.toContain(conn.clientSecret)
  })

  it("without an instance key the row is written as before (plaintext) rather than refusing to connect", async () => {
    await saveNodaroConnection(conn)
    expect(writtenValue()).toEqual(conn)
    // ...and a legacy read does not try to re-seal what it cannot seal.
    maybeSingleMock.mockResolvedValue({ data: { value: conn }, error: null })
    upsertMock.mockClear()
    expect(await getNodaroConnection()).toEqual(conn)
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it("a sealed row the current key cannot open reads as 'unavailable', never as 'not-connected'", async () => {
    mockConfig.NODARO_ENCRYPTION_KEY = TEST_KEY
    await saveNodaroConnection(conn)
    const value = writtenValue()
    // The install was restored without its app-data volume: a different key.
    mockConfig.NODARO_ENCRYPTION_KEY = "b".repeat(64)
    resetInstanceCipherForTests()
    maybeSingleMock.mockResolvedValue({ data: { value }, error: null })
    const state = await readNodaroConnectionState()
    expect(state.state).toBe("unavailable")
    expect(await getNodaroConnection()).toBeNull()
  })

  it("the status/boot reader re-seals a legacy row too — that is the read a pre-#864 install actually performs", async () => {
    mockConfig.NODARO_ENCRYPTION_KEY = TEST_KEY
    maybeSingleMock.mockResolvedValue({ data: { value: conn }, error: null })
    expect(await readNodaroConnectionState()).toEqual({ state: "connected", source: "oauth", connection: conn })
    expect(upsertMock).toHaveBeenCalledTimes(1)
    expect((writtenValue() as { sealed: number }).sealed).toBe(2)
  })

  it("disconnecting right after a legacy read leaves the row WITHOUT the token (the re-seal cannot land last)", async () => {
    mockConfig.NODARO_ENCRYPTION_KEY = TEST_KEY
    maybeSingleMock.mockResolvedValue({ data: { value: conn }, error: null })
    await clearNodaroConnection()
    // Two writes: the re-seal of the legacy row, then the stripped save — in that order.
    expect(upsertMock).toHaveBeenCalledTimes(2)
    const last = writtenValue() as { sealed: number; ciphertext: string }
    expect(last.sealed).toBe(2)
    const { decryptSecret } = await import("../instance-cipher.js")
    const stored = JSON.parse(decryptSecret(last.ciphertext)) as Record<string, unknown>
    expect(stored).toEqual({ clientId: conn.clientId, clientSecret: conn.clientSecret })
  })

  it("an envelope this build does not understand reads as 'unavailable', so /start cannot register over it", async () => {
    mockConfig.NODARO_ENCRYPTION_KEY = TEST_KEY
    maybeSingleMock.mockResolvedValue({ data: { value: { sealed: 3, ciphertext: "from-a-newer-version" } }, error: null })
    expect((await readNodaroConnectionState()).state).toBe("unavailable")
    expect(await getNodaroConnection()).toBeNull()
    maybeSingleMock.mockResolvedValue({ data: { value: { sealed: 2, ciphertext: 42 } }, error: null })
    expect((await readNodaroConnectionState()).state).toBe("unavailable")
  })

  it("a PRESENT but malformed key throws rather than quietly storing plaintext", async () => {
    mockConfig.NODARO_ENCRYPTION_KEY = "not-hex"
    await expect(saveNodaroConnection(conn)).rejects.toThrow(/64-char hex/)
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it("disconnect keeps the registration and writes it sealed", async () => {
    mockConfig.NODARO_ENCRYPTION_KEY = TEST_KEY
    await saveNodaroConnection(conn)
    maybeSingleMock.mockResolvedValue({ data: { value: writtenValue() }, error: null })
    await clearNodaroConnection()
    const wire = JSON.stringify(writtenValue())
    expect(wire).not.toContain("ndr_app_tok")
    expect((writtenValue() as { sealed: number }).sealed).toBe(2)
  })
})
