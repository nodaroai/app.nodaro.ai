// @test-watches backend/src/**/*.ts
/**
 * The user-facing reads of `assets`, as the guards over them read the source.
 *
 * There is no single read funnel for `assets` — each route and MCP tool
 * queries it itself — so two guards hold every user-facing read to a rule:
 * `asset-restricted-reads.test.ts` (a restricted file reads as one that does
 * not exist) and `asset-file-reads.test.ts` (a row with no address is no
 * file). Both scan the same reads, found here, so they cannot disagree on
 * which reads there are.
 *
 * A read is a `.from("assets")` chain with a `.select(` and no write, or a
 * chain on another table whose select embeds `assets` (`assets!…`,
 * `:assets(`), in a file outside the internal directories below. Those are
 * exempt as a whole, each for its stated reason: they run jobs, delete bytes,
 * sweep storage or show an administrator everything, and never list a user's
 * files to them.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"

const SRC = join(__dirname, "..", "..")

/** Directory prefixes (and file patterns) whose reads are internal, with why. */
export const INTERNAL_ASSET_READERS: ReadonlyArray<readonly [RegExp, string]> = [
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

export interface AssetRead {
  /** Path under backend/src, `/`-separated. */
  readonly file: string
  /** 1-based line of the `.from(…)` call. */
  readonly line: number
  /** The chain from that line on (see `chainAt`). */
  readonly chain: string
  /** The three lines above that line: where a comment about the read sits. */
  readonly above: string
  /** The three lines above, then the `.from(` line up to the call: where a call that wraps the chain opens. */
  readonly lead: string
  /** A read of `assets` itself; false for another table's select that embeds `assets`. */
  readonly fromAssets: boolean
}

/** Every user-facing read of `assets` under backend/src (see the header). */
export function userFacingAssetReads(): AssetRead[] {
  const reads: AssetRead[] = []
  for (const abs of walk(SRC)) {
    const file = relative(SRC, abs).split(sep).join("/")
    if (INTERNAL_ASSET_READERS.some(([re]) => re.test(file))) continue
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
      reads.push({ file, line: i + 1, chain, above, lead: `${above}\n${line.slice(0, from.index)}`, fromAssets })
    })
  }
  return reads
}
