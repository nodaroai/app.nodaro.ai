// @test-watches backend/src/**/*.ts
/**
 * EVERY LISTING OF FILES LEAVES OUT A ROW WITH NO FILE (decided 2026-11-12).
 *
 * A retention reaper keeps a reaped `assets` row and clears its address
 * (`lib/asset-file-column.ts`). A listing that hands such a row to a client
 * presents `url: null` as a file. So each user-facing `.from("assets")` read
 * that answers an ADDRESS (its select names `r2_url`, or every column) or a
 * COUNT (`count:` in its select) must either
 *   - be a listing that keeps only files: the chain is the argument of
 *     `onlyAssetFiles(…)` — the page and its count alike, so paging, cursors
 *     and `totalCount` describe the same list; or
 *   - carry a `// fileless-read: <why>` comment in or just above the chain
 *     saying why it may meet a row with no file (a lookup by id that checks
 *     the address in code, a count by key a row without one never matches).
 *
 * The reads, and the internal directories exempt as a whole, are the ones
 * `asset-restricted-reads.test.ts` holds (`asset-read-sites.ts`). An embed of
 * `assets` in another table's select is one related row, never a listing of
 * files, and is not held here.
 */
import { describe, expect, it } from "vitest"
import { userFacingAssetReads, type AssetRead } from "./asset-read-sites.js"

/** The text of the chain's first `.select(…)` call, between its parentheses. */
function selectArgs(chain: string): string {
  const start = chain.indexOf(".select(")
  if (start === -1) return ""
  let depth = 0
  for (let i = start + ".select".length; i < chain.length; i++) {
    const ch = chain[i]
    if (ch === "(") depth++
    else if (ch === ")" && --depth === 0) return chain.slice(start + ".select(".length, i)
  }
  return chain.slice(start + ".select(".length)
}

/** Whether the read answers an address (r2_url, every column) or a count. */
export function answersFilesOrCount(chain: string): boolean {
  const args = selectArgs(chain)
  return args.trim() === "" || /\br2_url\b|\*/.test(args) || /\bcount\s*:/.test(args)
}

/** The chain is the argument of `onlyAssetFiles(` (the call opens just before it). */
export const appliesFileRule = (read: Pick<AssetRead, "lead">) => /\bonlyAssetFiles\(\s*[\w.]*\s*$/.test(read.lead)

const saysWhy = (read: Pick<AssetRead, "chain" | "above">) => /fileless-read:\s*\S/.test(read.chain) || /fileless-read:\s*\S/.test(read.above)

describe("every user-facing assets read that answers an address or a count leaves a row with no file out, or says why", () => {
  const reads = userFacingAssetReads().filter((r) => r.fromAssets && answersFilesOrCount(r.chain))

  it("finds the reads it guards (the scan is not vacuous)", () => {
    expect(reads.length).toBeGreaterThan(8)
    const applying = reads.filter(appliesFileRule).map((r) => r.file)
    // The library's page and count, and browse_uploads' page and count.
    expect(applying.filter((f) => f === "routes/library.ts")).toHaveLength(2)
    expect(applying.filter((f) => f === "lib/mcp/tools/gallery.ts")).toHaveLength(2)
    expect(reads.some((r) => r.file === "lib/mcp/asset-resolver.ts")).toBe(true)
  })

  it("each one applies onlyAssetFiles to the chain itself, or carries a fileless-read: reason", () => {
    const missing = reads.filter((r) => !appliesFileRule(r) && !saysWhy(r)).map((r) => `${r.file}:${r.line}`)
    expect(missing).toEqual([])
  })

  it("a reason is never a substitute where the rule is applied, nor the rule hidden behind one (each read is one or the other)", () => {
    const both = reads.filter((r) => appliesFileRule(r) && saysWhy(r)).map((r) => `${r.file}:${r.line}`)
    expect(both).toEqual([])
  })
})

describe("the scanner's own reading", () => {
  it("reads an address or a count from the select, and nothing else", () => {
    expect(answersFilesOrCount(`.from("assets")\n.select("id, r2_url")`)).toBe(true)
    expect(answersFilesOrCount(`.from("assets")\n.select(\`id, r2_url, \${X}\`)`)).toBe(true)
    expect(answersFilesOrCount(`.from("assets")\n.select("*")`)).toBe(true)
    expect(answersFilesOrCount(`.from("assets")\n.select()`)).toBe(true)
    expect(answersFilesOrCount(`.from("assets")\n.select("id", { count: "exact", head: true })`)).toBe(true)
    expect(answersFilesOrCount(`.from("assets")\n.select("id, " + embed() + ", r2_url")`)).toBe(true)
    expect(answersFilesOrCount(`.from("assets")\n.select("created_at")\n.eq("r2_url", u)`)).toBe(false)
    expect(answersFilesOrCount(`.from("assets")\n.select("id, r2_key")`)).toBe(false)
  })

  it("counts the rule as applied only when the chain is the helper's argument", () => {
    expect(appliesFileRule({ lead: "    let q = onlyAssetFiles(\n      supabase\n      " })).toBe(true)
    expect(appliesFileRule({ lead: "x\ny\nconst q = onlyAssetFiles(supabase" })).toBe(true)
    expect(appliesFileRule({ lead: "onlyAssetFiles(a)\nconst q = supabase\n  " })).toBe(false)
    expect(appliesFileRule({ lead: "// onlyAssetFiles(\nconst q = await supabase\n  " })).toBe(false)
  })
})
