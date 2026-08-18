/**
 * The app-managed layer of provider keys: encrypted rows in
 * provider_credentials, mirrored into the runtime snapshot that
 * `config.<PROVIDER>_KEY` reads through. Contracts:
 *   - a write encrypts (plaintext never hits the DB) and is visible in-process
 *     immediately (the API answers /setup right after the save);
 *   - a boot load retries transport failures (the community proxy race) and
 *     applies ONE snapshot at the end;
 *   - the worker process, which never sees the API's writes directly, refreshes
 *     on a TTL — so a pasted key reaches generation within that window.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockConfig, rows, mockUpsert, mockDelete } = vi.hoisted(() => ({
  mockConfig: { NODARO_ENCRYPTION_KEY: "a".repeat(64), SOCIAL_ENCRYPTION_KEY: "" },
  rows: [] as Array<{ provider: string; ciphertext: string }>,
  mockUpsert: vi.fn(),
  mockDelete: vi.fn(),
}))

vi.mock("../config.js", () => ({ config: mockConfig }))

// A tiny in-memory PostgREST: select() lists rows; upsert/delete mutate them.
vi.mock("../supabase.js", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => Promise.resolve({ data: rows.map((r) => ({ ...r })), error: null })),
      upsert: vi.fn((row: { provider: string; ciphertext: string }) => {
        mockUpsert(row)
        const i = rows.findIndex((r) => r.provider === row.provider)
        if (i >= 0) rows[i] = { provider: row.provider, ciphertext: row.ciphertext }
        else rows.push({ provider: row.provider, ciphertext: row.ciphertext })
        return Promise.resolve({ error: null })
      }),
      delete: vi.fn(() => ({
        eq: vi.fn((_col: string, provider: string) => {
          mockDelete(provider)
          const i = rows.findIndex((r) => r.provider === provider)
          if (i >= 0) rows.splice(i, 1)
          return Promise.resolve({ error: null })
        }),
      })),
    })),
  },
}))

import {
  clearProviderCredential,
  listProviderCredentialStates,
  loadProviderCredentials,
  refreshProviderCredentialsIfStale,
  refreshProviderCredentialsNow,
  setProviderCredential,
  _resetProviderCredentialsForTests,
} from "../provider-credentials.js"
import { resolveProviderKey, setEnvProviderKeys, _resetProviderKeysRuntimeForTests } from "../provider-keys-runtime.js"
import { resetInstanceCipherForTests, decryptSecret } from "../instance-cipher.js"

beforeEach(() => {
  rows.length = 0
  mockUpsert.mockClear()
  mockDelete.mockClear()
  mockConfig.NODARO_ENCRYPTION_KEY = "a".repeat(64)
  _resetProviderKeysRuntimeForTests()
  _resetProviderCredentialsForTests()
  resetInstanceCipherForTests()
  setEnvProviderKeys({})
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("setProviderCredential / clearProviderCredential", () => {
  it("stores ciphertext (never the plaintext) and is visible in-process at once", async () => {
    await setProviderCredential("kie", "kie_secret_123", "user-1")
    expect(mockUpsert).toHaveBeenCalledTimes(1)
    const stored = mockUpsert.mock.calls[0][0]
    expect(stored.provider).toBe("kie")
    expect(stored.ciphertext).not.toContain("kie_secret_123")
    expect(decryptSecret(stored.ciphertext)).toBe("kie_secret_123")
    expect(resolveProviderKey("kie")).toEqual({ value: "kie_secret_123", source: "app" })
  })

  it("rejects an empty or whitespace value instead of storing a blank key", async () => {
    await expect(setProviderCredential("kie", "   ", "user-1")).rejects.toThrow(/empty/i)
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it("rejects an unknown provider id", async () => {
    await expect(setProviderCredential("openai" as never, "x", "user-1")).rejects.toThrow(/unknown provider/i)
  })

  it("clear removes the row and the key disappears in-process", async () => {
    await setProviderCredential("fal", "fal_1", "user-1")
    await clearProviderCredential("fal")
    expect(mockDelete).toHaveBeenCalledWith("fal")
    expect(resolveProviderKey("fal")).toBeNull()
  })
})

describe("loadProviderCredentials (boot)", () => {
  it("decrypts every row into one snapshot", async () => {
    await setProviderCredential("kie", "k", "u")
    await setProviderCredential("elevenlabs", "e", "u")
    _resetProviderKeysRuntimeForTests() // pretend a fresh process
    _resetProviderCredentialsForTests()
    await loadProviderCredentials({ delaysMs: [] })
    expect(resolveProviderKey("kie")?.value).toBe("k")
    expect(resolveProviderKey("elevenlabs")?.value).toBe("e")
  })

  it("skips a row it cannot decrypt (key rotated) with a warning, keeps the rest", async () => {
    await setProviderCredential("kie", "k", "u")
    rows.push({ provider: "fal", ciphertext: Buffer.from("garbage-not-an-envelope").toString("base64") })
    _resetProviderKeysRuntimeForTests()
    _resetProviderCredentialsForTests()
    await loadProviderCredentials({ delaysMs: [] })
    expect(resolveProviderKey("kie")?.value).toBe("k")
    expect(resolveProviderKey("fal")).toBeNull()
    expect(console.warn).toHaveBeenCalledWith(expect.stringMatching(/fal.*could not be decrypted/))
  })

  it("does not blank the app layer when the store is unreachable at boot", async () => {
    // Boot without an encryption key is the community stack before 1b lands, or a
    // managed deploy misconfigured: the load must degrade to "no app keys", not throw.
    mockConfig.NODARO_ENCRYPTION_KEY = ""
    resetInstanceCipherForTests()
    await expect(loadProviderCredentials({ delaysMs: [] })).resolves.toBeUndefined()
    expect(resolveProviderKey("kie")).toBeNull()
  })
})

describe("TTL refresh (the worker process's only way to see the API's writes)", () => {
  it("re-reads the store once the snapshot is older than the TTL", async () => {
    let now = 1_000_000
    await loadProviderCredentials({ delaysMs: [], now: () => now })
    // Simulate the API process writing a row this worker never saw.
    const { encryptSecret } = await import("../instance-cipher.js")
    rows.push({ provider: "kie", ciphertext: encryptSecret("from-the-api") })
    await expect(refreshProviderCredentialsIfStale({ ttlMs: 30_000, now: () => now + 1_000 })).resolves.toBe(false)
    expect(resolveProviderKey("kie")).toBeNull() // still fresh, no re-read
    await expect(refreshProviderCredentialsIfStale({ ttlMs: 30_000, now: () => now + 31_000 })).resolves.toBe(true)
    expect(resolveProviderKey("kie")?.value).toBe("from-the-api")
    // Nothing new: a re-read that changes no effective key says so.
    await expect(refreshProviderCredentialsIfStale({ ttlMs: 30_000, now: () => now + 62_000 })).resolves.toBe(false)
  })

  // The router's self-heal: a route that found no provider forces one re-read
  // and must be able to re-route the moment it resolves — so the resolution
  // waits for the change listeners (that is where registration happens).
  it("a forced re-read resolves only after the change listeners have settled", async () => {
    let now = 1_000_000
    await loadProviderCredentials({ delaysMs: [], now: () => now })
    const { encryptSecret } = await import("../instance-cipher.js")
    rows.push({ provider: "kie", ciphertext: encryptSecret("pasted-seconds-ago") })
    let registered = false
    const { subscribeProviderKeys } = await import("../provider-keys-runtime.js")
    const off = subscribeProviderKeys(async (changed) => {
      await new Promise((r) => setTimeout(r, 20)) // an async registration
      if (changed.includes("kie")) registered = true
    })
    try {
      // Fresh by TTL — the forced read (ttl 0) must go through anyway.
      const changed = await refreshProviderCredentialsNow()
      expect(changed).toBe(true)
      expect(registered).toBe(true)
    } finally {
      off()
    }
  })

  it("a forced re-read reports false when the store never answers in time, without throwing", async () => {
    // Freeze the store: select() never resolves.
    const { supabase } = await import("../supabase.js")
    vi.mocked(supabase.from).mockImplementationOnce(() => ({
      select: () => new Promise(() => {}),
    }) as unknown as ReturnType<typeof supabase.from>)
    await expect(refreshProviderCredentialsNow({ timeoutMs: 30 })).resolves.toBe(false)
  })
})

describe("listProviderCredentialStates", () => {
  it("reports set/source per provider without ever exposing a value", async () => {
    setEnvProviderKeys({ kie: "env-kie" })
    await setProviderCredential("fal", "app-fal", "u")
    const states = listProviderCredentialStates()
    expect(states.find((s) => s.id === "kie")).toEqual({ id: "kie", set: true, source: "env", disabled: false, ignoreEnv: false })
    expect(states.find((s) => s.id === "fal")).toEqual({ id: "fal", set: true, source: "app", disabled: false, ignoreEnv: false })
    expect(states.find((s) => s.id === "gemini")).toEqual({ id: "gemini", set: false, source: null, disabled: false, ignoreEnv: false })
    expect(JSON.stringify(states)).not.toMatch(/env-kie|app-fal/)
  })
})
