/**
 * Import source policies (lib/import-source-policy.ts) over an in-memory
 * table: a site with no row is approved; the nearest listed parent domain
 * covers a subdomain, never a look-alike; disabled and permission-required
 * sites refuse with one generic message; a save goes through the one-transaction
 * RPC with the version the admin loaded; a failed read serves the rows read last.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mem = vi.hoisted(() => ({
  rows: [] as Array<{ domain: string; status: string; note: string | null; updated_by: string | null; updated_at: string }>,
  readError: null as { message: string } | null,
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  rpcError: null as { code?: string; message: string } | null,
}))

vi.mock("../supabase.js", () => ({
  supabase: {
    from: () => ({
      select: () => ({ order: async () => (mem.readError ? { data: null, error: mem.readError } : { data: mem.rows.map((r) => ({ ...r })), error: null }) }),
    }),
    rpc: async (name: string, args: Record<string, unknown>) => {
      mem.rpcCalls.push({ name, args })
      if (mem.rpcError) return { error: mem.rpcError }
      const policies = args.p_policies as Array<{ domain: string; status: string; note: string | null }>
      mem.rows = policies.map((p) => ({ domain: p.domain, status: p.status, note: p.note, updated_by: args.p_admin as string, updated_at: "2026-11-02T01:02:03.456Z" }))
      return { error: null }
    },
  },
}))

import {
  ImportSourceError,
  ImportSourceVersionError,
  assertImportSourceAllowed,
  forgetImportSourceCache,
  importSourceStatus,
  listImportSourcePolicies,
  normalizeDomain,
  policiesVersion,
  policyForHost,
  replaceImportSourcePolicies,
} from "../import-source-policy.js"

const row = (domain: string, status: string) => ({ domain, status, note: null, updated_by: null, updated_at: "2026-11-02T00:00:00Z" })

beforeEach(() => {
  mem.rows = []
  mem.readError = null
  mem.rpcCalls = []
  mem.rpcError = null
  forgetImportSourceCache()
})
afterEach(() => vi.restoreAllMocks())

describe("normalizeDomain / policyForHost", () => {
  it("covers the domain and its subdomains by the nearest listed parent, never a look-alike", () => {
    const rows = [
      { domain: "example.com", status: "disabled" as const, note: null, updatedBy: null, updatedAt: "" },
      { domain: "clips.example.com", status: "approved" as const, note: null, updatedBy: null, updatedAt: "" },
    ]
    expect(policyForHost("www.example.com", rows)?.status).toBe("disabled")
    expect(policyForHost("WWW.Example.COM.", rows)?.status).toBe("disabled")
    expect(policyForHost("m.clips.example.com", rows)?.status).toBe("approved")
    expect(policyForHost("notexample.com", rows)).toBeNull()
    expect(normalizeDomain(" WWW.www.Example.com. ")).toBe("example.com")
  })
})

describe("importSourceStatus / assertImportSourceAllowed", () => {
  it("a site with no row is approved; disabled and permission-required refuse with one generic message; restricted and pending pass", async () => {
    mem.rows = [row("blocked.test", "disabled"), row("ask.test", "permission_required"), row("fine.test", "restricted"), row("later.test", "pending_legal_review")]
    expect(await importSourceStatus("https://anything.test/video/1")).toBe("approved")
    expect(await importSourceStatus("https://www.fine.test:8443/v/1")).toBe("restricted")
    await expect(assertImportSourceAllowed("https://www.fine.test/v/1")).resolves.toBeUndefined()
    await expect(assertImportSourceAllowed("https://later.test/v/1")).resolves.toBeUndefined()
    await expect(assertImportSourceAllowed("https://m.blocked.test/v/1")).rejects.toBeInstanceOf(ImportSourceError)
    await expect(assertImportSourceAllowed("https://ask.test/v/1")).rejects.toMatchObject({ code: "import_source_disabled", message: "This link can't be imported here." })
    await expect(assertImportSourceAllowed("https://xn--80ak6aa92e.xn--p1ai/v/1")).resolves.toBeUndefined()
    await expect(assertImportSourceAllowed("not a url")).resolves.toBeUndefined()
  })

  it("reads the table once a minute; a failed read serves the rows read last, and none before any read", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date("2026-11-02T10:00:00Z"))
      // No read has succeeded yet: a failure serves none (every site approved) and is logged.
      mem.readError = { message: "connection refused" }
      expect(await importSourceStatus("https://blocked.test/1")).toBe("approved")
      expect(quiet).toHaveBeenCalledTimes(1)
      mem.readError = null
      mem.rows = [row("blocked.test", "disabled")]
      expect(await importSourceStatus("https://blocked.test/1")).toBe("disabled")
      // Within the minute the table is not read again.
      mem.rows = []
      vi.setSystemTime(new Date("2026-11-02T10:00:59Z"))
      expect(await importSourceStatus("https://blocked.test/1")).toBe("disabled")
      // After it, a read that fails serves the rows read last.
      vi.setSystemTime(new Date("2026-11-02T10:01:01Z"))
      mem.readError = { message: "connection refused" }
      expect(await importSourceStatus("https://blocked.test/1")).toBe("disabled")
      expect(quiet).toHaveBeenCalledTimes(2)
      // A fresh read (the admin screen) goes to the table whatever the cache holds.
      mem.readError = null
      expect(await listImportSourcePolicies({ fresh: true })).toEqual([])
      expect(await importSourceStatus("https://blocked.test/1")).toBe("approved")
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("replaceImportSourcePolicies", () => {
  it("calls the one-transaction RPC with the rows, the admin and the version loaded, and answers the fresh list", async () => {
    mem.rows = [row("old.test", "disabled")]
    const before = policiesVersion(await listImportSourcePolicies())
    const out = await replaceImportSourcePolicies([{ domain: "new.test", status: "disabled", note: "  " }, { domain: "keep.test", status: "approved", note: "ok" }], "admin-1", before)
    expect(mem.rpcCalls).toEqual([
      {
        name: "replace_import_source_policies",
        args: {
          p_policies: [
            { domain: "new.test", status: "disabled", note: null },
            { domain: "keep.test", status: "approved", note: "ok" },
          ],
          p_admin: "admin-1",
          p_expected_version: "1:1793577600000",
        },
      },
    ])
    expect(out.map((p) => `${p.domain}=${p.status}:${p.note ?? ""}`)).toEqual(["new.test=disabled:", "keep.test=approved:ok"])
    expect(policiesVersion(out)).toBe("2:1793581323456")
  })

  it("a list that moved since it was loaded is refused as a version error", async () => {
    mem.rpcError = { code: "40001", message: "changed" }
    await expect(replaceImportSourcePolicies([], "admin-1", "0:0")).rejects.toBeInstanceOf(ImportSourceVersionError)
    mem.rpcError = { message: "boom" }
    await expect(replaceImportSourcePolicies([], "admin-1", "0:0")).rejects.toThrow("write failed")
  })
})
