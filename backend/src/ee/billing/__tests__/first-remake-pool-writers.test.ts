// @test-watches backend/src/**/*.ts
/**
 * "First Remake on us" (migration 684): the cover is never in the account's
 * pools, so nothing in the server may hand a usage log's credits back to them
 * by hand — the SQL settle paths return a covered hold's share to the cover.
 * The pool top-up RPCs called from TypeScript are pinned here: a NEW caller
 * fails until it is read, and a caller that settles a usage log must refuse a
 * hold that drew on the cover (`from_cover`) before it adds anything. The SQL
 * side is pinned by supabase/tests/first-remake-offer.behavior.sql (L).
 */
import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const SRC = fileURLToPath(new URL("../../../", import.meta.url))
const POOL_RPC = /rpc\(\s*["'](add_subscription_credits|add_topup_credits)["']/

function sources(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (name === "__tests__" || name === "node_modules") continue
    if (statSync(path).isDirectory()) out.push(...sources(path))
    else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) out.push(path)
  }
  return out
}

const callers = sources(SRC)
  .map((path) => ({ file: relative(SRC, path), src: readFileSync(path, "utf8") }))
  .filter(({ src }) => POOL_RPC.test(src))

describe("the pool top-up RPCs called from TypeScript", () => {
  it("are called from known files only", () => {
    expect(callers.map((c) => c.file).sort()).toEqual(["ee/billing/credits.ts", "ee/billing/subscription-grant.ts"])
  })

  it("a caller that settles a usage log refuses a covered hold before it adds anything", () => {
    for (const { file, src } of callers) {
      if (!/from\(\s*["']usage_logs["']\s*\)/.test(src)) continue
      // Every add made on a usage log's behalf comes after the from_cover refusal in the same function.
      const refusal = src.indexOf("refund fallback REFUSED for a first-Remake covered usage log")
      expect(refusal, `${file}: the refund fallback must refuse a covered hold`).toBeGreaterThan(-1)
      const fallback = src.slice(src.indexOf("private static async settleRefund"))
      const end = fallback.indexOf("\n  }\n")
      const body = fallback.slice(0, end > 0 ? end : undefined)
      const firstAdd = body.search(POOL_RPC)
      const guard = body.indexOf("from_cover")
      expect(guard, `${file}: settleRefund reads from_cover`).toBeGreaterThan(-1)
      expect(firstAdd === -1 || guard < firstAdd, `${file}: from_cover is checked before any pool top-up`).toBe(true)
      expect(src, `${file}: the commit fallback refuses a covered hold too`).toContain("commit fallback REFUSED for a first-Remake covered usage log")
    }
  })
})
