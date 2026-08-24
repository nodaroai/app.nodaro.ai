/**
 * Every read of a saved entity is scoped to its owner.
 *
 * Characters, objects, creatures and locations are read by the MCP tools, by
 * the Copilot through them, by the Copilot's write-time ownership check, and by
 * the orchestrator's run-time hydration. That is one question — "is this row
 * this user's?" — asked from four places, and the four kinds have already
 * drifted apart once: `characters` never got migration 338's workspace
 * disjunct, so the database's own answer differs per kind.
 *
 * Structural on purpose. The drift is not a wrong answer, it is a MISSING
 * clause next to a `.from("characters")`, and the only place to catch that is
 * where it is written. A block either goes through `entityOwnerFilter` or
 * spells out both halves itself.
 *
 * The unit is a blank-line-separated block — a query chain plus whatever reads
 * its rows — matching `project-scope-guard.test.ts`, which guards the sibling
 * invariant for `project_id`.
 */
import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const SRC = join(__dirname, "..", "..", "..")

/** Where entity reads legitimately live. */
const SEARCH_DIRS = [join(SRC, "lib"), join(SRC, "ee", "copilot")]

const ENTITY_TABLES = ["characters", "objects", "creatures", "locations"]

/**
 * Files whose entity reads are NOT owner-scoped, each for a stated reason.
 *
 * Deliberately empty of "legacy" entries that merely predate the helper: the
 * two long-standing tool files below DO scope correctly, they simply spell the
 * predicate out inline, and the guard accepts that. An entry here means the
 * read genuinely is not the caller's own row, and needs a sentence saying why.
 */
const EXEMPT: Record<string, string> = {
  "lib/reconcile/replicate.ts":
    "A background sweep with no caller: it finds the character behind a stuck " +
    "Replicate training by `lora_training_replicate_id`, which is a provider " +
    "task id, not a user's request. There is no owner to scope to.",
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__") continue
      walk(full, out)
    } else if (entry.endsWith(".ts")) {
      out.push(full)
    }
  }
  return out
}

/** A block that names an entity table in a `.from(...)`, literal or via a map. */
function readsAnEntityTable(block: string): boolean {
  if (ENTITY_TABLES.some((t) => block.includes(`.from("${t}")`))) return true
  // `.from(ENTITY_TABLE[kind])` — the data-driven form the hydrator uses.
  return /\.from\(\s*ENTITY_TABLE\[/.test(block)
}

function isOwnerScoped(block: string): boolean {
  if (block.includes("entityOwnerFilter")) return true
  return /\.eq\(\s*"user_id"/.test(block) && /\.is\(\s*"deleted_at"/.test(block)
}

describe("saved-entity reads are owner-scoped", () => {
  const files = SEARCH_DIRS.flatMap((dir) => walk(dir))

  it("the scan itself finds the entity reads", () => {
    // A walker that matched nothing would pass the guard below silently.
    const hits = files.filter((f) => ENTITY_TABLES.some((t) => readFileSync(f, "utf8").includes(`.from("${t}")`)))
    expect(hits.length).toBeGreaterThan(2)
  })

  it("every block that queries an entity table also scopes it to the owner", () => {
    const offenders: string[] = []
    for (const file of files) {
      const rel = relative(SRC, file).replace(/\\/g, "/")
      if (EXEMPT[rel]) continue
      const source = readFileSync(file, "utf8")
      let line = 1
      for (const block of source.split(/\r?\n\s*\r?\n/)) {
        const blockLine = line
        line += block.split(/\r?\n/).length + 1
        // A `.select()` is what makes it a READ — except after a write, where
        // PostgREST uses `.select()` to return the row it just changed. Writes
        // are authorized by their own tool/route and guarded elsewhere.
        if (!readsAnEntityTable(block) || !block.includes(".select(")) continue
        if (/\.(update|insert|upsert|delete)\(/.test(block)) continue
        if (isOwnerScoped(block)) continue
        offenders.push(`${rel}:${blockLine}`)
      }
    }
    expect(offenders, `entity reads with no owner scope:\n  ${offenders.join("\n  ")}`).toEqual([])
  })
})
