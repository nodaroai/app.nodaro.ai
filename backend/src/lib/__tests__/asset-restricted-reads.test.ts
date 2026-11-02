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
 * The internal directories are exempt as a whole, each for its stated reason:
 * they run jobs, delete bytes and sweep storage, and never answer a user with
 * a restricted file.
 */
import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"

const SRC = join(__dirname, "..", "..")

/** Directory prefixes (and file patterns) whose reads are internal, with why. */
const INTERNAL: ReadonlyArray<readonly [RegExp, string]> = [
  [/^workers\//, "job execution: a worker reads what the job it runs refers to"],
  [/^services\//, "the workflow engine and artifact services, server-side"],
  [/^providers\//, "provider adapters, server-side"],
  [/^scripts\//, "operator scripts"],
  [/^ee\/scripts\//, "operator scripts"],
  [/^ee\/billing\//, "storage accounting and cleanup count every file"],
  [/^ee\/pipelines\/(?!stages\/post-merge\.ts)/, "pipeline orchestration internals; the one read that reaches the user (the final output's address in the completion event, stages/post-merge.ts) filters"],
  [/^ee\/lib\/trends\//, "trend runs' own files, read to delete them"],
  [/^ee\/routes\/admin[^/]*\.ts$/, "admin tools see every file"],
  [/^ee\/copilot\/(?!tools\/asset-refs\.ts)/, "a Copilot turn's own bookkeeping; the model's asset reads are in tools/asset-refs.ts, which filters"],
  [/^lib\/(asset-delete|media-delete|key-ownership|site-capture-store|scraped-media|saved-post-still|retained-images|retained-videos)\.ts$/, "who owns stored bytes, and the copies kept of them: a restricted file still owns its bytes until the purge"],
  [/^lib\/(media-import|media-url-import|asset-records)\.ts$/, "an import's own write and its dedup pre-check"],
  [/^lib\/rights-complaints\.ts$/, "a complaint is matched against every file, restricted ones first of all"],
  [/^lib\/content-restrictions\.ts$/, "the restriction itself"],
  [/^lib\/(app-expunge-targets|collect-app-r2-keys|app-run-content)\.ts$/, "expunging a published app's content, every file included"],
  [/^lib\/private-plugins\/(?!toolkit\.ts)/, "the plugin toolkit's internals; its one asset read in toolkit.ts filters"],
]

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name === "__tests__" || name === "node_modules" || name === "generated") continue
      walk(p, out)
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".d.ts")) {
      out.push(p)
    }
  }
  return out
}

/** The chain that starts at `start`: every following line while a paren is
 *  open, or while the next line continues it (`.`, `//`, `)`). */
function chainAt(lines: readonly string[], start: number): string {
  const out: string[] = []
  let depth = 0
  for (let i = start; i < lines.length; i++) {
    const line = lines[i]!
    out.push(line)
    for (const ch of line.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, "")) {
      if (ch === "(") depth++
      else if (ch === ")") depth--
    }
    const next = lines[i + 1]?.trim() ?? ""
    if (depth <= 0 && !/^(\.|\/\/|\))/.test(next)) break
    if (out.length > 40) break
  }
  return out.join("\n")
}

export interface ReadSite {
  readonly file: string
  readonly line: number
  readonly ok: boolean
}

export function assetReadSites(): ReadSite[] {
  const sites: ReadSite[] = []
  for (const abs of walk(SRC)) {
    const file = relative(SRC, abs).split(sep).join("/")
    if (INTERNAL.some(([re]) => re.test(file))) continue
    const lines = readFileSync(abs, "utf8").replace(/\r\n/g, "\n").split("\n")
    lines.forEach((line, i) => {
      const from = line.match(/\.from\(["']([a-z_]+)["']\)/)
      if (!from) return
      const chain = chainAt(lines, i)
      const fromAssets = from[1] === "assets"
      // An assets embed in another table's select (`still:assets!thumbnail_asset_id(...)`, `x:assets(...)`).
      const embed = !fromAssets && /\.select\([\s\S]*?(\bassets!|:assets\()/.test(chain)
      if (!fromAssets && !embed) return
      if (fromAssets && /\.(update|insert|upsert|delete)\(/.test(chain)) return
      if (fromAssets && !chain.includes(".select(")) return
      const above = lines.slice(Math.max(0, i - 3), i).join("\n")
      const ok =
        /\.(is|not)\(\s*RESTRICTED_ASSET_COLUMN/.test(chain) ||
        /restricted-read:\s*\S/.test(chain) ||
        /restricted-read:\s*\S/.test(above)
      sites.push({ file, line: i + 1, ok })
    })
  }
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
