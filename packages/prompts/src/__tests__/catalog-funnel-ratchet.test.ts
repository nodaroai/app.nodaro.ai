// Ratchet: freeze the set of prompts/src files that read a RAW BASE catalog
// array (STYLES, MOODS, PEOPLE, …) directly instead of the pack-composed funnel
// (`getRegisteredPickerCatalogs()` / `getRegisteredPeople()`). A file that reads
// a raw array bypasses deployment-registered packs, so the seam only holds if
// that set can only SHRINK.
//
// The watched array names are DERIVED from `picker-catalogs.ts`'s own value
// imports — the ONE file that legitimately pulls every base array in to compose
// the funnel — so a brand-new catalog is watched automatically (no hand-list to
// drift). Substring/regex scan + a 4s ceiling (spec §3 finding 5: AST walks blew
// the CI budget).
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, dirname, relative } from "node:path"
import { fileURLToPath } from "node:url"

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..")
const FUNNEL = join(SRC, "picker-catalogs.ts")

// Files allowed to read raw base arrays today, two kinds:
//   • composition roots — the funnels the rest of the world reads FROM. These
//     are NOT debt; they are where the base arrays legitimately enter.
//   • tracked offenders — pending repoint (Phase-0 scope note). May only shrink.
// A stale entry (a listed file that no longer reads a raw array) fails too, so
// the list cannot rot: repointing a file means deleting its line here.
const ALLOWLIST = new Set<string>([
  "picker-catalogs.ts", // composition root: the aggregate funnel composes every base array
  "person-packs.ts", // composition root: getRegisteredPeople() composes packs onto raw PEOPLE
  "picker-analyzer-registry.ts", // tracked offender: describe-to-picker analyzer, repoint pending
  "picker-wiring.ts", // tracked offender: repoint pending
])

describe("catalog funnel import ratchet", () => {
  it("no NEW prompts file reads a raw base catalog array (funnel bypass)", () => {
    const start = Date.now()
    const watched = deriveWatchedArrays(readFileSync(FUNNEL, "utf8"))
    // Guard the guard: if the derivation ever silently finds nothing (funnel
    // moved/renamed), the whole ratchet would go vacuous — fail loudly instead.
    expect(watched.size, "derivation found no base arrays — is picker-catalogs.ts still the funnel?").toBeGreaterThan(40)

    const offenders = new Set<string>()
    for (const f of walk(SRC)) {
      if (!f.endsWith(".ts") || f.includes("__tests__")) continue
      if (importsAnyOf(readFileSync(f, "utf8"), watched).length) offenders.add(relative(SRC, f))
    }

    const newOffenders = [...offenders].filter((f) => !ALLOWLIST.has(f)).sort()
    expect(newOffenders, `New direct raw-array reader(s) — read the pack-composed funnel instead: ${newOffenders.join(", ")}`).toEqual([])

    const stale = [...ALLOWLIST].filter((f) => !offenders.has(f)).sort()
    expect(stale, `Stale ratchet allowlist entr(ies) — file no longer reads a raw array, delete the line: ${stale.join(", ")}`).toEqual([])

    expect(Date.now() - start, "ratchet exceeded 4s ceiling").toBeLessThan(4000)
  })
})

/**
 * The raw base-array export names, DERIVED from the funnel's own value imports:
 * uppercase identifiers (`STYLES`, `PEOPLE`, `ANIMALS`, …) minus the metadata
 * siblings (`*_LABELS` / `*_ORDER` / `*_FIELD_BY_*`). `import type { … }` and
 * `export … from` are ignored, so type re-exports and the defining modules never
 * match.
 */
function deriveWatchedArrays(funnelSource: string): Set<string> {
  const watched = new Set<string>()
  for (const name of importedNames(funnelSource)) {
    if (/^[A-Z][A-Z0-9_]*$/.test(name) && !/_LABELS$|_ORDER$|_FIELD_BY_/.test(name)) watched.add(name)
  }
  return watched
}

/** Names this source VALUE-imports (skips `import type {…}` and inline `type` specifiers). */
function importedNames(source: string): string[] {
  const names: string[] = []
  const re = /import\s+(?:[\w*]+\s*,\s*)?\{([^}]*)\}\s*from\s*["'][^"']+["']/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source))) {
    for (let spec of m[1].split(",")) {
      spec = spec.trim()
      if (!spec || spec.startsWith("type ")) continue
      names.push(spec.split(/\s+as\s+/)[0].trim())
    }
  }
  return names
}

/** Watched names this source imports (the bypass signal). */
function importsAnyOf(source: string, watched: Set<string>): string[] {
  return [...new Set(importedNames(source).filter((n) => watched.has(n)))]
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}
