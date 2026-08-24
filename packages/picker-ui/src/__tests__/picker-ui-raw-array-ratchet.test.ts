// Ratchet: freeze the set of picker-ui files that read a RAW BASE catalog array
// (STYLES, MOODS, ANIMALS, …) directly from @nodaro/prompts / @nodaro/shared
// instead of the pack-composed funnel. A picker that reads a raw array won't
// reflect a deployment's registered catalog packs, so this set may only SHRINK.
// (The person pickers were already repointed to `getRegisteredPeople()` — hence
// their absence here — and the dedicated `picker-ui-person-ratchet` test keeps
// them repointed with an empty allowlist.)
//
// The watched array names are DERIVED from the prompts funnel's own value
// imports (`packages/prompts/src/picker-catalogs.ts`) — the single source of
// truth — so a brand-new catalog is watched automatically. Regex scan + 4s
// ceiling (spec §3 finding 5).
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, dirname, relative } from "node:path"
import { fileURLToPath } from "node:url"

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..")
// The prompts funnel lives in a sibling package; the monorepo checkout CI runs
// against always has it at this path.
const FUNNEL = join(SRC, "..", "..", "prompts", "src", "picker-catalogs.ts")

// Tracked offenders pending repoint (Phase-0 scope note): the single-/multi-dim
// picker components + the central registry still read raw base arrays. May only
// shrink — repointing a file means deleting its line here (a stale entry, i.e. a
// listed file that no longer reads a raw array, also fails).
const ALLOWLIST = new Set<string>([
  "pickers/action-fx-picker.tsx",
  "pickers/aesthetic-picker.tsx",
  "pickers/animal-picker.tsx",
  "pickers/atmosphere-picker.tsx",
  "pickers/backdrop-picker.tsx",
  "pickers/camera-format-picker.tsx",
  "pickers/camera-motion-picker.tsx",
  "pickers/character-fx-picker.tsx",
  "pickers/color-look-picker.tsx",
  "pickers/composition-effects-picker.tsx",
  "pickers/era-picker.tsx",
  "pickers/exposure-settings-picker.tsx",
  "pickers/framing-picker.tsx",
  "pickers/furniture-picker.tsx",
  "pickers/hair-cut-browser.tsx",
  "pickers/held-prop-picker.tsx",
  "pickers/instrumentation-picker.tsx",
  "pickers/lens-picker.tsx",
  "pickers/lighting-picker.tsx",
  "pickers/loop-subject-picker.tsx",
  "pickers/material-picker.tsx",
  "pickers/music-genre-picker.tsx",
  "pickers/music-mood-picker.tsx",
  "pickers/photo-genre-picker.tsx",
  "pickers/photographer-picker.tsx",
  "pickers/pose-picker.tsx",
  "pickers/post-process-effects-picker.tsx",
  "pickers/render-quality-picker.tsx",
  "pickers/setting-picker.tsx",
  "pickers/style-picker.tsx",
  "pickers/styling-picker.tsx",
  "pickers/temporal-picker.tsx",
  "pickers/transition-picker.tsx",
  "pickers/vehicle-picker.tsx",
  "pickers/voice-character-picker.tsx",
  "pickers/voice-delivery-picker.tsx",
  "pickers/weapon-picker.tsx",
  "registry.tsx",
])

describe("picker-ui raw-array ratchet", () => {
  it("no NEW picker-ui file reads a raw base catalog array (funnel bypass)", () => {
    const start = Date.now()
    const watched = deriveWatchedArrays(readFileSync(FUNNEL, "utf8"))
    expect(watched.size, "derivation found no base arrays — did the prompts funnel move?").toBeGreaterThan(40)

    const offenders = new Set<string>()
    for (const f of walk(SRC)) {
      if (!(f.endsWith(".ts") || f.endsWith(".tsx")) || f.includes("__tests__")) continue
      if (importsAnyOf(readFileSync(f, "utf8"), watched).length) offenders.add(relative(SRC, f))
    }

    const newOffenders = [...offenders].filter((f) => !ALLOWLIST.has(f)).sort()
    expect(newOffenders, `New raw-array-reading picker(s) — read the registered/pack-composed set instead: ${newOffenders.join(", ")}`).toEqual([])

    const stale = [...ALLOWLIST].filter((f) => !offenders.has(f)).sort()
    expect(stale, `Stale ratchet allowlist entr(ies) — file no longer reads a raw array, delete the line: ${stale.join(", ")}`).toEqual([])

    expect(Date.now() - start, "ratchet exceeded 4s ceiling").toBeLessThan(4000)
  })
})

/** Raw base-array names, derived from the prompts funnel's own value imports. */
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

function importsAnyOf(source: string, watched: Set<string>): string[] {
  return [...new Set(importedNames(source).filter((n) => watched.has(n)))]
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}
