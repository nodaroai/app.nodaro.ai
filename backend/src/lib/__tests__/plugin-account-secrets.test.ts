/**
 * The generic account-secret store behind `tk.accountSecrets` (migration 440).
 *
 * A tiny in-memory PostgREST stands in for supabase — the chains the module
 * issues (`select…eq…in…order`, `select…eq…maybeSingle`, `upsert…select…single`,
 * `update…eq…select`, `delete…eq…select`) — with the REAL instance cipher
 * underneath (test key). What these cases pin:
 *   - every read and write is scoped to the named plugin AND this process's
 *     runtime environment, which the caller cannot supply;
 *   - no metadata read ever selects or returns the ciphertext;
 *   - `open` is the one place the envelope becomes a secret again.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const { mockConfig, table, selects } = vi.hoisted(() => ({
  mockConfig: { NODARO_ENCRYPTION_KEY: "c".repeat(64), SOCIAL_ENCRYPTION_KEY: "" },
  table: [] as Array<Record<string, unknown>>,
  selects: [] as string[],
}))

vi.mock("../config.js", () => ({ config: mockConfig }))

vi.mock("../supabase.js", () => {
  let nextId = 1
  const now = () => new Date(Date.now() + nextId).toISOString()
  const IDENTITY = ["plugin", "kind", "runtime_env", "user_id", "external_id"] as const

  function pick(row: Record<string, unknown>, columns: string): Record<string, unknown> {
    const wanted = columns.split(",").map((c) => c.trim())
    return Object.fromEntries(wanted.filter((c) => c in row).map((c) => [c, row[c]]))
  }

  function builder() {
    const state: {
      op: "select" | "update" | "delete" | "upsert"
      columns: string
      eq: Array<[string, unknown]>
      inFilter: [string, unknown[]] | null
      payload: Record<string, unknown> | null
      onConflict: string | null
      single: "single" | "maybeSingle" | null
      order: [string, boolean] | null
    } = { op: "select", columns: "*", eq: [], inFilter: null, payload: null, onConflict: null, single: null, order: null }

    const matches = (row: Record<string, unknown>) =>
      state.eq.every(([k, v]) => row[k] === v) && (!state.inFilter || state.inFilter[1].includes(row[state.inFilter[0]]))

    function run() {
      if (state.op === "upsert") {
        if (state.onConflict !== IDENTITY.join(",")) {
          return { data: null, error: { code: "42P10", message: `no unique index on (${state.onConflict})` } }
        }
        const incoming = state.payload!
        const existing = table.find((r) => IDENTITY.every((k) => r[k] === incoming[k]))
        if (existing) {
          Object.assign(existing, incoming)
          return { data: pick(existing, state.columns), error: null }
        }
        const full = {
          id: `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`,
          created_at: now(),
          metadata: {},
          label: null,
          status_reason: null,
          ...incoming,
        }
        table.push(full)
        return { data: pick(full, state.columns), error: null }
      }
      const rows = table.filter(matches)
      if (state.op === "update") {
        for (const r of rows) Object.assign(r, state.payload)
        return { data: rows.map((r) => pick(r, state.columns)), error: null }
      }
      if (state.op === "delete") {
        for (const r of rows) table.splice(table.indexOf(r), 1)
        return { data: rows.map((r) => pick(r, state.columns)), error: null }
      }
      const sorted = state.order
        ? [...rows].sort((a, b) => String(a[state.order![0]]).localeCompare(String(b[state.order![0]])) * (state.order![1] ? 1 : -1))
        : rows
      if (state.single === "single") {
        return sorted[0] ? { data: pick(sorted[0], state.columns), error: null } : { data: null, error: { code: "PGRST116", message: "0 rows" } }
      }
      if (state.single === "maybeSingle") return { data: sorted[0] ? pick(sorted[0], state.columns) : null, error: null }
      return { data: sorted.map((r) => pick(r, state.columns)), error: null }
    }

    const api: Record<string, unknown> = {
      select(columns: string) {
        state.columns = columns
        if (state.op === "select") selects.push(columns)
        return api
      },
      eq(k: string, v: unknown) {
        state.eq.push([k, v])
        return api
      },
      in(k: string, vs: unknown[]) {
        state.inFilter = [k, vs]
        return api
      },
      order(col: string, opts?: { ascending?: boolean }) {
        state.order = [col, opts?.ascending !== false]
        return api
      },
      update(payload: Record<string, unknown>) {
        state.op = "update"
        state.payload = payload
        return api
      },
      delete() {
        state.op = "delete"
        return api
      },
      upsert(payload: Record<string, unknown>, opts?: { onConflict?: string }) {
        state.op = "upsert"
        state.payload = payload
        state.onConflict = opts?.onConflict ?? null
        return api
      },
      single() {
        state.single = "single"
        return Promise.resolve(run())
      },
      maybeSingle() {
        state.single = "maybeSingle"
        return Promise.resolve(run())
      },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        return Promise.resolve(run()).then(resolve, reject)
      },
    }
    return api
  }

  return { supabase: { from: (name: string) => {
    if (name !== "plugin_account_secrets") throw new Error(`unexpected table ${name}`)
    return builder()
  } } }
})

import {
  listAccountSecrets,
  getAccountSecret,
  updateAccountSecret,
  deleteAccountSecret,
  upsertAccountSecret,
  openAccountSecret,
} from "../plugin-account-secrets.js"
import { decryptSecret, EncryptionKeyMissingError, resetInstanceCipherForTests } from "../instance-cipher.js"

const OWNER = "11111111-1111-4111-8111-111111111111"
const STRANGER = "22222222-2222-4222-8222-222222222222"
const originalRuntimeEnv = process.env.RUNTIME_ENV

function upsertInput(overrides: Partial<Parameters<typeof upsertAccountSecret>[0]> = {}) {
  return {
    plugin: "acme-accounts",
    kind: "user",
    userId: OWNER,
    externalId: "777",
    label: "@someone",
    secret: { session: "SESSION-PLAINTEXT", apiHash: "HASH-PLAINTEXT" },
    metadata: { displayName: "Some One" },
    ...overrides,
  }
}

beforeEach(() => {
  table.length = 0
  selects.length = 0
  process.env.RUNTIME_ENV = "staging"
  resetInstanceCipherForTests()
})

afterEach(() => {
  if (originalRuntimeEnv === undefined) delete process.env.RUNTIME_ENV
  else process.env.RUNTIME_ENV = originalRuntimeEnv
})

describe("upsertAccountSecret", () => {
  it("stores the secret as an envelope under this runtime environment and returns metadata only", async () => {
    const row = await upsertAccountSecret(upsertInput())

    expect(table).toHaveLength(1)
    const stored = table[0]
    expect(stored.runtime_env).toBe("staging")
    expect(stored.status).toBe("active")
    expect(typeof stored.ciphertext).toBe("string")
    expect(stored.ciphertext).not.toContain("SESSION-PLAINTEXT")
    expect(stored.ciphertext).not.toContain("HASH-PLAINTEXT")

    expect(row).toMatchObject({
      plugin: "acme-accounts",
      kind: "user",
      userId: OWNER,
      externalId: "777",
      label: "@someone",
      status: "active",
      statusReason: null,
      metadata: { displayName: "Some One" },
    })
    expect(row).not.toHaveProperty("ciphertext")
    expect(row).not.toHaveProperty("secret")
  })

  it("reconnecting the same account replaces its secret and brings it back to active", async () => {
    const first = await upsertAccountSecret(upsertInput())
    await updateAccountSecret({ allOwners: true, plugin: "acme-accounts", id: first.id, status: "revoked", statusReason: "session_revoked" })

    const second = await upsertAccountSecret(upsertInput({ secret: { session: "NEW-SESSION" } }))

    expect(second.id).toBe(first.id)
    expect(table).toHaveLength(1)
    expect(second.status).toBe("active")
    expect(second.statusReason).toBeNull()
    const opened = await openAccountSecret({ plugin: "acme-accounts", id: first.id })
    expect(opened?.secret).toEqual({ session: "NEW-SESSION" })
  })

  it("the same account connected from another environment is a separate row", async () => {
    await upsertAccountSecret(upsertInput())
    process.env.RUNTIME_ENV = "production"
    await upsertAccountSecret(upsertInput())
    expect(table.map((r) => r.runtime_env).sort()).toEqual(["production", "staging"])
  })

  it("refuses malformed input before touching the table", async () => {
    await expect(upsertAccountSecret(upsertInput({ plugin: "Bad Name" }))).rejects.toThrow(/invalid/i)
    await expect(upsertAccountSecret(upsertInput({ userId: "not-a-uuid" }))).rejects.toThrow(/invalid/i)
    await expect(upsertAccountSecret(upsertInput({ secret: {} }))).rejects.toThrow(/invalid/i)
    await expect(
      upsertAccountSecret(upsertInput({ secret: { session: 42 as unknown as string } })),
    ).rejects.toThrow(/invalid/i)
    await expect(
      upsertAccountSecret(upsertInput({ secret: { session: "x".repeat(20_000) } })),
    ).rejects.toThrow(/invalid/i)
    await expect(upsertAccountSecret(upsertInput({ status: "Not A Status" }))).rejects.toThrow(/invalid/i)
    expect(table).toHaveLength(0)
  })
})

describe("scoping — plugin + runtime environment on every read", () => {
  beforeEach(async () => {
    await upsertAccountSecret(upsertInput({ externalId: "1" }))
    await upsertAccountSecret(upsertInput({ externalId: "2", userId: STRANGER }))
    await upsertAccountSecret(upsertInput({ externalId: "3", kind: "bot" }))
    await upsertAccountSecret(upsertInput({ externalId: "4", plugin: "other-plugin" }))
    process.env.RUNTIME_ENV = "production"
    await upsertAccountSecret(upsertInput({ externalId: "5" }))
    process.env.RUNTIME_ENV = "staging"
  })

  it("lists only this plugin's rows in this environment", async () => {
    const rows = await listAccountSecrets({ allOwners: true, plugin: "acme-accounts" })
    expect(rows.map((r) => r.externalId).sort()).toEqual(["1", "2", "3"])
  })

  it("narrows by owner, kind and status", async () => {
    expect((await listAccountSecrets({ plugin: "acme-accounts", userId: OWNER })).map((r) => r.externalId).sort()).toEqual([
      "1",
      "3",
    ])
    expect((await listAccountSecrets({ allOwners: true, plugin: "acme-accounts", kind: "bot" })).map((r) => r.externalId)).toEqual(["3"])

    const [one] = await listAccountSecrets({ plugin: "acme-accounts", userId: OWNER, kind: "user" })
    await updateAccountSecret({ allOwners: true, plugin: "acme-accounts", id: one.id, status: "paused" })
    expect(
      (await listAccountSecrets({ allOwners: true, plugin: "acme-accounts", statuses: ["active"] })).map((r) => r.externalId).sort(),
    ).toEqual(["2", "3"])
  })

  it("get answers null for another owner, another plugin or another environment", async () => {
    const [mine] = await listAccountSecrets({ plugin: "acme-accounts", userId: OWNER, kind: "user" })
    expect(await getAccountSecret({ plugin: "acme-accounts", id: mine.id, userId: OWNER })).toMatchObject({ externalId: "1" })
    expect(await getAccountSecret({ plugin: "acme-accounts", id: mine.id, userId: STRANGER })).toBeNull()
    expect(await getAccountSecret({ allOwners: true, plugin: "other-plugin", id: mine.id })).toBeNull()
    process.env.RUNTIME_ENV = "production"
    expect(await getAccountSecret({ allOwners: true, plugin: "acme-accounts", id: mine.id })).toBeNull()
  })

  it("no metadata read selects the ciphertext, and no returned row carries it", async () => {
    selects.length = 0
    const rows = await listAccountSecrets({ allOwners: true, plugin: "acme-accounts" })
    await getAccountSecret({ allOwners: true, plugin: "acme-accounts", id: rows[0].id })
    expect(selects.length).toBeGreaterThanOrEqual(2)
    for (const columns of selects) expect(columns).not.toContain("ciphertext")
    for (const row of rows) expect(Object.keys(row)).not.toContain("ciphertext")
  })

  it("update and delete cannot reach across plugin, environment or owner", async () => {
    const [mine] = await listAccountSecrets({ plugin: "acme-accounts", userId: OWNER, kind: "user" })

    expect(await updateAccountSecret({ allOwners: true, plugin: "other-plugin", id: mine.id, status: "paused" })).toBe(false)
    expect(await updateAccountSecret({ plugin: "acme-accounts", id: mine.id, userId: STRANGER, status: "paused" })).toBe(false)
    expect(await deleteAccountSecret({ plugin: "acme-accounts", id: mine.id, userId: STRANGER })).toBe(false)
    process.env.RUNTIME_ENV = "production"
    expect(await deleteAccountSecret({ allOwners: true, plugin: "acme-accounts", id: mine.id })).toBe(false)
    process.env.RUNTIME_ENV = "staging"

    expect(await getAccountSecret({ allOwners: true, plugin: "acme-accounts", id: mine.id })).toMatchObject({ status: "active" })
    expect(await updateAccountSecret({ plugin: "acme-accounts", id: mine.id, userId: OWNER, status: "paused" })).toBe(true)
    expect(await getAccountSecret({ allOwners: true, plugin: "acme-accounts", id: mine.id })).toMatchObject({ status: "paused" })
    expect(await deleteAccountSecret({ plugin: "acme-accounts", id: mine.id, userId: OWNER })).toBe(true)
    expect(await getAccountSecret({ allOwners: true, plugin: "acme-accounts", id: mine.id })).toBeNull()
  })

  it("a metadata call that states no owner scope — or both — throws instead of reaching every owner", async () => {
    const [mine] = await listAccountSecrets({ plugin: "acme-accounts", userId: OWNER, kind: "user" })
    const noScope = { plugin: "acme-accounts" } as unknown as Parameters<typeof listAccountSecrets>[0]
    const both = { plugin: "acme-accounts", userId: OWNER, allOwners: true } as unknown as Parameters<typeof listAccountSecrets>[0]

    await expect(listAccountSecrets(noScope)).rejects.toThrow(/owner scope/)
    await expect(listAccountSecrets(both)).rejects.toThrow(/owner scope/)
    await expect(getAccountSecret({ ...noScope, id: mine.id } as never)).rejects.toThrow(/owner scope/)
    await expect(updateAccountSecret({ ...noScope, id: mine.id, status: "paused" } as never)).rejects.toThrow(/owner scope/)
    await expect(deleteAccountSecret({ ...noScope, id: mine.id } as never)).rejects.toThrow(/owner scope/)
    await expect(
      listAccountSecrets({ plugin: "acme-accounts", allOwners: false } as unknown as Parameters<typeof listAccountSecrets>[0]),
    ).rejects.toThrow(/owner scope/)

    expect(await getAccountSecret({ allOwners: true, plugin: "acme-accounts", id: mine.id })).toMatchObject({ status: "active" })
  })

  it("one malformed row is skipped by list — it cannot take every other account down with it", async () => {
    table.push({
      id: "99999999-9999-4999-8999-999999999999",
      plugin: "acme-accounts",
      kind: "user",
      user_id: OWNER,
      runtime_env: "staging",
      external_id: "broken",
      status: 42, // not a string: a row no upsert could have written
      ciphertext: "x",
      created_at: "1999-01-01T00:00:00.000Z",
      updated_at: "1999-01-01T00:00:00.000Z",
    })

    const rows = await listAccountSecrets({ allOwners: true, plugin: "acme-accounts" })
    expect(rows.map((r) => r.externalId).sort()).toEqual(["1", "2", "3"])
    await expect(
      getAccountSecret({ allOwners: true, plugin: "acme-accounts", id: "99999999-9999-4999-8999-999999999999" }),
    ).rejects.toThrow()
  })
})

describe("updateAccountSecret", () => {
  it("changes status, reason, label and metadata, and stamps updated_at", async () => {
    const row = await upsertAccountSecret(upsertInput())
    const before = "2000-01-01T00:00:00.000Z"
    table[0].updated_at = before

    expect(
      await updateAccountSecret({
        plugin: "acme-accounts",
        id: row.id,
        userId: OWNER,
        status: "paused",
        statusReason: "owner_paused",
        label: "@renamed",
        metadata: { displayName: "Renamed" },
      }),
    ).toBe(true)

    const after = await getAccountSecret({ allOwners: true, plugin: "acme-accounts", id: row.id })
    expect(after).toMatchObject({ status: "paused", statusReason: "owner_paused", label: "@renamed", metadata: { displayName: "Renamed" } })
    expect(table[0].updated_at).not.toBe(before)
  })

  it("never writes the ciphertext", async () => {
    const row = await upsertAccountSecret(upsertInput())
    const envelope = table[0].ciphertext
    await updateAccountSecret({ allOwners: true, plugin: "acme-accounts", id: row.id, ...( { ciphertext: "forged" } as object) })
    expect(table[0].ciphertext).toBe(envelope)
  })
})

describe("openAccountSecret", () => {
  it("returns the row and the decrypted secret", async () => {
    const row = await upsertAccountSecret(upsertInput())
    const opened = await openAccountSecret({ plugin: "acme-accounts", id: row.id })
    expect(opened?.row).toMatchObject({ id: row.id, externalId: "777" })
    expect(opened?.row).not.toHaveProperty("ciphertext")
    expect(opened?.secret).toEqual({ session: "SESSION-PLAINTEXT", apiHash: "HASH-PLAINTEXT" })
  })

  it("answers null outside the row's plugin or environment", async () => {
    const row = await upsertAccountSecret(upsertInput())
    expect(await openAccountSecret({ plugin: "other-plugin", id: row.id })).toBeNull()
    process.env.RUNTIME_ENV = "production"
    expect(await openAccountSecret({ plugin: "acme-accounts", id: row.id })).toBeNull()
  })

  it("an envelope moved onto another row cannot be opened — it is bound to its own account", async () => {
    const a = await upsertAccountSecret(upsertInput({ externalId: "A", secret: { session: "SESSION-A" } }))
    const b = await upsertAccountSecret(upsertInput({ externalId: "B", secret: { session: "SESSION-B" } }))
    const rowA = table.find((r) => r.id === a.id)!
    const rowB = table.find((r) => r.id === b.id)!
    rowB.ciphertext = rowA.ciphertext

    await expect(openAccountSecret({ plugin: "acme-accounts", id: b.id })).rejects.toThrow(/cannot be opened/)
    expect((await openAccountSecret({ plugin: "acme-accounts", id: a.id }))?.secret).toEqual({ session: "SESSION-A" })
  })

  it("an envelope is bound to its environment: another environment cannot open it even with the same instance key", async () => {
    const row = await upsertAccountSecret(upsertInput())
    table[0].runtime_env = "production"
    process.env.RUNTIME_ENV = "production"
    await expect(openAccountSecret({ plugin: "acme-accounts", id: row.id })).rejects.toThrow(/cannot be opened/)
  })

  it("the stored envelope is not the plain instance cipher's — a per-environment subkey seals it", async () => {
    await upsertAccountSecret(upsertInput())
    expect(() => decryptSecret(String(table[0].ciphertext))).toThrow()
  })

  it("a missing instance key surfaces as the named operator error, not as a corrupt envelope", async () => {
    const row = await upsertAccountSecret(upsertInput())
    mockConfig.NODARO_ENCRYPTION_KEY = ""
    resetInstanceCipherForTests()
    try {
      await expect(openAccountSecret({ plugin: "acme-accounts", id: row.id })).rejects.toBeInstanceOf(EncryptionKeyMissingError)
    } finally {
      mockConfig.NODARO_ENCRYPTION_KEY = "c".repeat(64)
      resetInstanceCipherForTests()
    }
  })

  it("throws when the envelope cannot be opened (a changed key), rather than inventing a secret", async () => {
    const row = await upsertAccountSecret(upsertInput())
    mockConfig.NODARO_ENCRYPTION_KEY = "d".repeat(64)
    resetInstanceCipherForTests()
    try {
      await expect(openAccountSecret({ plugin: "acme-accounts", id: row.id })).rejects.toThrow(/cannot be opened/i)
    } finally {
      mockConfig.NODARO_ENCRYPTION_KEY = "c".repeat(64)
      resetInstanceCipherForTests()
    }
  })
})
