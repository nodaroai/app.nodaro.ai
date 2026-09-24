/**
 * The daemon-host toolkit vs everyone else's.
 *
 * `tk.accountSecrets.upsert/open` are the store's only encrypt and decrypt
 * sites, and they exist only in the toolkit the daemon host builds — so a
 * session is never decrypted outside the process that holds it. The last case
 * keeps that true structurally: `role: "daemon"` may be asked for in exactly
 * one production file, the host's entry point.
 */
import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"
import { SCAN_TIMEOUT_MS, relPath, sourceFiles } from "../../__tests__/source-scan.js"

// Same reasoning as toolkit.test.ts: the real modules, minus the network.
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn() }, redis: {} }))

import { buildToolkit } from "../toolkit.js"
import { acquireLease, releaseLease, renewLease } from "../../redis-lease.js"
import {
  deleteAccountSecret,
  getAccountSecret,
  listAccountSecrets,
  openAccountSecret,
  updateAccountSecret,
  upsertAccountSecret,
} from "../../plugin-account-secrets.js"

describe("buildToolkit — daemon role", () => {
  it("every process gets the metadata surface of the account-secret store, and nothing that decrypts", () => {
    const tk = buildToolkit()
    expect(tk.accountSecrets?.list).toBe(listAccountSecrets)
    expect(tk.accountSecrets?.get).toBe(getAccountSecret)
    expect(tk.accountSecrets?.update).toBe(updateAccountSecret)
    expect(tk.accountSecrets?.delete).toBe(deleteAccountSecret)
    expect(tk.accountSecrets).not.toHaveProperty("upsert")
    expect(tk.accountSecrets).not.toHaveProperty("open")
  })

  it("the daemon host's toolkit adds the encrypt and decrypt sites", () => {
    const tk = buildToolkit({ role: "daemon" })
    expect(tk.accountSecrets?.upsert).toBe(upsertAccountSecret)
    expect(tk.accountSecrets?.open).toBe(openAccountSecret)
    expect(tk.accountSecrets?.list).toBe(listAccountSecrets)
  })

  it("tk.redis.kv cannot write, bump, expire or delete a lease key — only tk.redis.lease owns that namespace", async () => {
    const kv = buildToolkit().redis.kv
    await expect(kv.set("plugin:lease:acct", "forged")).rejects.toThrow(/lease/)
    await expect(kv.del("ok-key", "plugin:lease:acct")).rejects.toThrow(/lease/)
    await expect(kv.incr("plugin:lease:acct")).rejects.toThrow(/lease/)
    await expect(kv.expire("plugin:lease:acct", 1)).rejects.toThrow(/lease/)
  })

  it("both carry the lease primitive and the daemon client", () => {
    for (const tk of [buildToolkit(), buildToolkit({ role: "daemon" })]) {
      expect(tk.redis.lease).toEqual({ acquire: acquireLease, renew: renewLease, release: releaseLease })
      expect(typeof tk.daemons?.request).toBe("function")
    }
  })

  it(
    "only the daemon host's entry point asks for the daemon toolkit",
    () => {
      const callers = sourceFiles()
        .filter((file) => {
          const text = readFileSync(file, "utf8")
          return text.includes("daemon") && /role:\s*["']daemon["']/.test(text)
        })
        .map(relPath)

      // Exact, not "contains": an extra caller is the leak, and a missing one
      // means the pattern stopped matching and this guard went vacuous.
      expect(callers, "the decrypting toolkit must be built only by src/plugin-daemons.ts").toEqual([
        "plugin-daemons.ts",
      ])
    },
    SCAN_TIMEOUT_MS,
  )
})
