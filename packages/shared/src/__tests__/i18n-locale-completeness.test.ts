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
 * adds a new locale or a new catalog, they must add a sidecar for every
 * catalog (or every locale) — this test fails until they're all present.
 *
 * The locales are discovered from the sidecar suffixes, so a locale removed
 * from EVERY catalog would leave the matrix complete. EXPECTED_LOCALES pins
 * the list by hand, so dropping a locale from the registry AND its sidecars
 * still fails here until the list is edited too; the registry is held to it
 * as well. REQUIRED_CATALOGS pins the catalogs that must stay in the matrix.
 * This is the only CI check of locale completeness.
 */

import { readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import { I18N_CATALOGS, NON_EN_LOCALE_IDS, type LocaleId } from "../i18n/types.js"

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

/**
 * The supported locales besides English (inline in each catalog's source,
 * never a sidecar). To add a locale: add it here, to LANGUAGES and LocaleId
 * in packages/shared/src/i18n/types.ts, and a `<catalog>.<locale>.ts` sidecar
 * for every catalog. To drop one: remove it from all three and delete its
 * sidecars.
 */
const EXPECTED_LOCALES = ["ar", "de", "es", "fr", "he", "hi", "ja", "ko", "pt-BR", "ru", "zh-CN"] as const satisfies ReadonlyArray<Exclude<LocaleId, "en">>

/** Catalogs that must keep a sidecar for every locale (dropping one from I18N_CATALOGS would take it out of the matrix). */
const REQUIRED_CATALOGS = ["seasons"] as const

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

  it("the discovered locales are exactly EXPECTED_LOCALES (a locale gone from every catalog is caught)", () => {
    expect(
      LOCALES,
      "The sidecar suffixes in packages/shared/src/i18n/ do not match EXPECTED_LOCALES. English is inline in each catalog, never a sidecar. Adding a locale: add it to EXPECTED_LOCALES, to LANGUAGES and LocaleId in packages/shared/src/i18n/types.ts, and a <catalog>.<locale>.ts sidecar for every catalog. Removing one: remove it from all three and delete all of its sidecars.",
    ).toEqual([...EXPECTED_LOCALES].sort())
  })

  it("the language registry's non-English locales are exactly EXPECTED_LOCALES", () => {
    expect([...NON_EN_LOCALE_IDS].sort(), "LANGUAGES in packages/shared/src/i18n/types.ts and EXPECTED_LOCALES disagree — a locale is added or dropped in one only").toEqual([...EXPECTED_LOCALES].sort())
  })

  it("every REQUIRED_CATALOGS entry is still in I18N_CATALOGS (so the matrix still checks it)", () => {
    const missing = REQUIRED_CATALOGS.filter((c) => !(I18N_CATALOGS as readonly string[]).includes(c))
    expect(missing, `Catalogs dropped from I18N_CATALOGS (packages/shared/src/i18n/types.ts) leave the locale matrix: ${missing.join(", ")}`).toEqual([])
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
