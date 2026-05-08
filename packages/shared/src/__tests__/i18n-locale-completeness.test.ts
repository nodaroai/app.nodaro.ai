/**
 * L1#6 — i18n catalog × locale completeness.
 *
 * Per CLAUDE.md `packages/shared/` note: the i18n sidecar files
 * (`packages/shared/src/i18n/<catalog>.<locale>.ts`) are loaded by the
 * frontend via `import.meta.glob("../../../packages/shared/src/i18n/*.*.ts")`
 * — each per-locale chunk gets code-split. The Dockerfile must copy
 * `packages/shared/src/i18n/` (NOT just dist) for the glob to find files
 * at production build time.
 *
 * If even one catalog×locale file is missing, that picker silently falls
 * back to English in production. The user sees mixed English + their
 * locale (or just English) and the bug is invisible until reported.
 *
 * This walk asserts every (catalog, locale) pair exists. If a developer
 * adds a new locale or a new catalog, they must add 36 (or 11) new sidecar
 * files — this test fails until they're all present.
 */

import { readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import { I18N_CATALOGS } from "../i18n/types.js"

const I18N_DIR = join(__dirname, "..", "i18n")

/**
 * Discover supported locales by scanning the i18n directory. The locale list
 * is implicitly defined by the set of suffixes that appear on sidecar files
 * — there's no central LOCALES enum (yet). Adding a new locale means adding
 * a sidecar file for every catalog.
 */
function discoverLocales(): string[] {
  const all = readdirSync(I18N_DIR)
  const localePattern = /^[^.]+\.([a-zA-Z-]+)\.ts$/
  const locales = new Set<string>()
  for (const f of all) {
    if (f === "types.ts" || f === "index.ts") continue
    const m = f.match(localePattern)
    if (m) locales.add(m[1])
  }
  return [...locales].sort()
}

const LOCALES = discoverLocales()

// Sanity: a non-trivial number of locales
describe("locale discovery sanity", () => {
  it("found at least 5 locales (non-trivial coverage)", () => {
    expect(LOCALES.length).toBeGreaterThanOrEqual(5)
  })

  it("includes baseline locales known to exist (fr, de, es, ja)", () => {
    expect(LOCALES).toContain("fr")
    expect(LOCALES).toContain("de")
    expect(LOCALES).toContain("es")
    expect(LOCALES).toContain("ja")
  })
})

// Build set of actually-present sidecar files for fast lookup
const PRESENT_FILES = new Set(
  readdirSync(I18N_DIR).filter(
    (f) => f !== "types.ts" && f !== "index.ts" && f.endsWith(".ts"),
  ),
)

/**
 * Allowlist of (catalog, locale) pairs intentionally without a sidecar.
 * Empty by default — every cell of the matrix should be filled.
 */
const KNOWN_MISSING_LOCALES: ReadonlySet<string> = new Set<string>([])

// ---------------------------------------------------------------------------
// Test 1 — every (catalog, locale) cell has a sidecar file.
// ---------------------------------------------------------------------------

describe("i18n catalog × locale matrix is complete", () => {
  const cases: Array<[string, string]> = []
  for (const catalog of I18N_CATALOGS) {
    for (const locale of LOCALES) {
      cases.push([catalog, locale])
    }
  }

  it.each(cases)(
    'sidecar file %s.%s.ts exists',
    (catalog, locale) => {
      if (KNOWN_MISSING_LOCALES.has(`${catalog}.${locale}`)) return
      const filename = `${catalog}.${locale}.ts`
      expect(
        PRESENT_FILES.has(filename),
        `Missing sidecar file: packages/shared/src/i18n/${filename}. The "${catalog}" picker will silently fall back to English in the "${locale}" locale. Either add the file (mirror the structure of an existing locale, e.g. ${catalog}.fr.ts), or add "${catalog}.${locale}" to KNOWN_MISSING_LOCALES with a comment.`,
      ).toBe(true)
    },
  )
})

// ---------------------------------------------------------------------------
// Test 2 — KNOWN_MISSING_LOCALES integrity.
// ---------------------------------------------------------------------------

describe("KNOWN_MISSING_LOCALES integrity", () => {
  it("every allowlist entry is genuinely missing from disk", () => {
    const stale: string[] = []
    for (const entry of KNOWN_MISSING_LOCALES) {
      const [catalog, locale] = entry.split(".")
      if (PRESENT_FILES.has(`${catalog}.${locale}.ts`)) stale.push(entry)
    }
    expect(
      stale,
      `These KNOWN_MISSING_LOCALES entries now have sidecar files — remove from allowlist: ${stale.join(", ")}`,
    ).toEqual([])
  })

  it("every allowlist entry references a known catalog and a known locale", () => {
    const knownCats = new Set(I18N_CATALOGS)
    const knownLocs = new Set(LOCALES)
    const invalid: string[] = []
    for (const entry of KNOWN_MISSING_LOCALES) {
      const [catalog, locale] = entry.split(".")
      if (!knownCats.has(catalog as (typeof I18N_CATALOGS)[number]) || !knownLocs.has(locale)) {
        invalid.push(entry)
      }
    }
    expect(
      invalid,
      `These KNOWN_MISSING_LOCALES entries reference unknown catalog or locale — remove or fix: ${invalid.join(", ")}`,
    ).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Test 3 — no orphan files (sidecars whose catalog is not in I18N_CATALOGS).
// Catches: developer renames a catalog, forgets to delete old sidecars.
// ---------------------------------------------------------------------------

describe("no orphan i18n sidecar files", () => {
  it("every sidecar file's catalog name is in I18N_CATALOGS", () => {
    const knownCats = new Set(I18N_CATALOGS)
    const orphans: string[] = []
    for (const f of PRESENT_FILES) {
      // Filename: <catalog>.<locale>.ts. Catalog can contain hyphens.
      const m = f.match(/^(.+)\.([a-zA-Z-]+)\.ts$/)
      if (!m) continue
      const [, catalog] = m
      if (!knownCats.has(catalog as (typeof I18N_CATALOGS)[number])) {
        orphans.push(f)
      }
    }
    expect(
      orphans,
      `These i18n sidecar files don't correspond to any catalog in I18N_CATALOGS — they're loaded by the glob but never resolved. Remove them, or add the catalog to I18N_CATALOGS in packages/shared/src/i18n/types.ts: ${orphans.join(", ")}`,
    ).toEqual([])
  })
})
