// @test-watches backend/src/**/*.ts
/**
 * EVERY READER HONOURS A RESTRICTION (migration 581).
 *
 * A file an administrator restricted after a complaint (`assets.restricted_at`
 * set) reads, for every caller and every user-facing read, exactly as a file
 * that does not exist. There is no single read funnel for `assets` — each
 * route and MCP tool queries it itself — so this guard holds every one of
 * them, the way `job-trash-reads.test.ts` holds the Trash: each `.from("assets")`
 * READ (a chain with a `.select(` and no write) in a file outside the internal
 * directories below must either FILTER `RESTRICTED_ASSET_COLUMN` in the chain
 * itself (`.is(…)` / `.not(…)`), or carry a `// restricted-read: <why>` comment
 * in or just above the chain saying why it may see a restricted file (a
 * write's own pre-check, a cursor's timestamp, a read that checks the column
 * in code, the restriction itself). The same holds for a chain on another
 * table whose select embeds `assets` (`assets!…`, `:assets(`).
 *
 * The internal directories are exempt as a whole, each for its stated reason
 * (`INTERNAL_ASSET_READERS` in asset-read-sites.ts, which finds the reads):
 * they run jobs, delete bytes and sweep storage, and never answer a user with
 * a restricted file.
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { userFacingAssetReads } from "./asset-read-sites.js"

const SRC = join(__dirname, "..", "..")

export interface ReadSite {
  readonly file: string
  readonly line: number
  readonly ok: boolean
}

export function assetReadSites(): ReadSite[] {
  // The reads, and the internal directories exempt as a whole, are found in
  // asset-read-sites.ts (shared with asset-file-reads.test.ts).
  const sites: ReadSite[] = userFacingAssetReads().map(({ file, line, chain, above }) => ({
    file,
    line,
    ok:
      /\.(is|not)\(\s*RESTRICTED_ASSET_COLUMN/.test(chain) ||
      /restricted-read:\s*\S/.test(chain) ||
      /restricted-read:\s*\S/.test(above),
  }))
  // An embed declared as a constant (saved-posts-store.ts) is read where the
  // constant is declared, not where it is used: the declaration carries the comment.
  const embedConstants = ["lib/saved-posts-store.ts"]
  for (const file of embedConstants) {
    const lines = readFileSync(join(SRC, file), "utf8").replace(/\r\n/g, "\n").split("\n")
    lines.forEach((line, i) => {
      if (!/:assets!|:assets\(/.test(line)) return
      const above = lines.slice(Math.max(0, i - 4), i).join("\n")
      sites.push({ file, line: i + 1, ok: /restricted-read:\s*\S/.test(above) || /restricted-read:\s*\S/.test(line) })
    })
  }
  return sites
}

describe("every user-facing assets read leaves a restricted file out", () => {
  const sites = assetReadSites()

  it("finds the reads it guards (the scan is not vacuous)", () => {
    expect(sites.length).toBeGreaterThan(8)
    expect(sites.some((s) => s.file === "routes/library.ts")).toBe(true)
    expect(sites.some((s) => s.file === "lib/mcp/tools/gallery.ts")).toBe(true)
    expect(sites.some((s) => s.file === "lib/mcp/asset-resolver.ts")).toBe(true)
    expect(sites.some((s) => s.file === "lib/saved-posts-store.ts")).toBe(true)
  })

  it("each one filters RESTRICTED_ASSET_COLUMN or says why it may read a restricted file", () => {
    const missing = sites.filter((s) => !s.ok).map((s) => `${s.file}:${s.line}`)
    expect(missing).toEqual([])
  })
})
