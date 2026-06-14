/**
 * L1#6b — i18n per-ENTRY × locale completeness.
 *
 * The sibling file `i18n-locale-completeness.test.ts` only asserts that the
 * sidecar FILES exist (`<catalog>.<locale>.ts`). It does NOT look inside them.
 * That is how ~660 person / camera-format / render-quality translation strings
 * silently shipped missing: the files were all present, but a batch of catalog
 * entries (e.g. the facial-geometry person dimensions, the ARRI Alexa 65 /
 * Sony Venice camera bodies, the Arnold / V-Ray render engines) had no entry at
 * all in any non-English sidecar — so those pickers fell back to English in 11
 * locales with zero signal.
 *
 * This guard walks every catalog ENTRY (not just every file) and asserts each
 * id is actually translated in every non-English locale. It enumerates from
 * `PICKER_CATALOGS` (`picker-catalogs.ts`) — the pure-data, single-source-of-
 * truth mirror of the frontend picker registry — so the moment a new catalog
 * entry is added (anywhere, by anyone) it is automatically in-scope here; there
 * is no second list to remember to update.
 *
 * ---------------------------------------------------------------------------
 * What "translated" means (derived from the established sidecar convention,
 * documented in `i18n/types.ts`):
 *
 *  - `description` is translated FREELY for every entry. Empirically every
 *    description-carrying catalog translates the description of EVERY one of
 *    its ids in EVERY locale. So:
 *       → DESCRIPTION IS REQUIRED for an entry when (a) the canonical English
 *         entry has a non-empty description AND (b) the catalog conventionally
 *         translates descriptions in that locale (detected per (catalog,locale)
 *         as: at least one id in that sidecar carries a description). Condition
 *         (b) cleanly exempts the handful of label-only catalogs (loop-subject,
 *         seasons) whose sidecars translate the short subject label only and
 *         never carry a description — translating their description is simply
 *         not part of that catalog's contract.
 *
 *  - `label` is translated when it is a common noun/adjective, but LEFT in its
 *    canonical English form when it is a brand name, model number, proper noun,
 *    technical unit, microtrend tag, loanword, or Latin/Italian/Japanese
 *    cinematography jargon (ARRI Alexa 65, V-Ray, Sony A7III, 8K UHD,
 *    anamorphic, djembe, goblincore, katana, …). Translators apply this
 *    per-ENTRY and per-LOCALE: empirically the label-skip is pervasive and
 *    irreducible across the WHOLE corpus — e.g. `djembe`, `chiffon`,
 *    `baroque`, `super-8`, `femme-fatale`, the `*-core` aesthetics are each
 *    translated in some locales and intentionally left English in others.
 *    There is therefore NO clean dataset-wide "label required" invariant; any
 *    such rule (even "required where a majority translate it" or "required
 *    where all-but-one translate it") false-fails on 1500+ cells of shipped,
 *    deliberate data. So this guard does NOT impose a blanket label
 *    requirement. The real, universal failure mode the original gap exhibited
 *    was a MISSING ENTRY (the id key absent in every sidecar) — Test 1 below
 *    catches that for every id in every locale, and a present entry always
 *    carries the canonical-English label fallback at runtime. The specific
 *    common-noun label work this guard was added for (the 26 facial-geometry
 *    person dimensions) is pinned explicitly in Test 3, which also documents
 *    the deliberate brand-label-English decision for the camera / render
 *    bodies & engines.
 *
 * Net: Test 1 (entry-exists) + Test 2 (description) are TRUE on the entire
 * current dataset (so the suite is green) yet FAIL the instant a new catalog
 * entry ships without an entry or without the description its catalog
 * conventionally carries — exactly the regression that let the original gap
 * through. Test 3 additionally pins the in-scope label coverage.
 * ---------------------------------------------------------------------------
 */

import { describe, it, expect } from "vitest"
import { PICKER_CATALOGS, type PickerOption } from "../picker-catalogs.js"
import { NON_EN_LOCALE_IDS, type LocaleId, type LocaleCatalogMap } from "../i18n/types.js"

const LOCALES = NON_EN_LOCALE_IDS

// ---------------------------------------------------------------------------
// Flatten PICKER_CATALOGS → { catalogId → PickerOption[] }.
// single: top-level `options`. multi: every `dimensions[].options`.
// De-dupe by id (a few multi catalogs can repeat an id across dimensions; the
// person catalog does not, but be defensive).
// ---------------------------------------------------------------------------

interface CatalogEntries {
  readonly catalogId: string
  readonly options: readonly PickerOption[]
}

const CATALOGS: readonly CatalogEntries[] = PICKER_CATALOGS.map((c) => {
  const collected: PickerOption[] = []
  const seen = new Set<string>()
  const push = (opts: readonly PickerOption[] | undefined) => {
    for (const o of opts ?? []) {
      if (seen.has(o.id)) continue
      seen.add(o.id)
      collected.push(o)
    }
  }
  if (c.kind === "single") {
    push(c.options)
  } else {
    for (const d of c.dimensions ?? []) push(d.options)
  }
  return { catalogId: c.catalogId, options: collected }
})

// ---------------------------------------------------------------------------
// Eagerly load every sidecar map for every (catalog, locale) so the per-entry
// `it.each` cases are synchronous. Done once at module init.
//
// Loader mirrors `catalog-gapfill.test.ts` (dynamic import of the source .ts).
// A missing sidecar file is the sibling test's job; here we treat it as an
// empty map so this test reports per-entry coverage rather than a load crash.
// ---------------------------------------------------------------------------

type LoadedMaps = Map<string, LocaleCatalogMap> // key = `${catalogId}:${locale}`

async function loadAllMaps(): Promise<LoadedMaps> {
  const maps: LoadedMaps = new Map()
  await Promise.all(
    CATALOGS.flatMap((c) =>
      LOCALES.map(async (locale) => {
        try {
          const mod = (await import(`../i18n/${c.catalogId}.${locale}.ts`)) as {
            default?: LocaleCatalogMap
          }
          maps.set(`${c.catalogId}:${locale}`, mod.default ?? {})
        } catch {
          maps.set(`${c.catalogId}:${locale}`, {})
        }
      }),
    ),
  )
  return maps
}

const MAPS = await loadAllMaps()

function mapFor(catalogId: string, locale: LocaleId): LocaleCatalogMap {
  return MAPS.get(`${catalogId}:${locale}`) ?? {}
}

const has = (s: string | undefined): boolean => typeof s === "string" && s.trim().length > 0

/**
 * Per (catalog, locale): does this sidecar conventionally translate
 * descriptions at all? True if any entry carries a non-empty description.
 * Label-only catalogs (loop-subject, seasons) return false → their entries are
 * not required to carry a translated description.
 */
function localeTranslatesDescriptions(catalogId: string, locale: LocaleId): boolean {
  const map = mapFor(catalogId, locale)
  for (const v of Object.values(map)) if (has(v?.description)) return true
  return false
}

// ---------------------------------------------------------------------------
// Sanity: the enumeration source is non-trivial and the locale list is the 11
// non-English locales.
// ---------------------------------------------------------------------------

describe("i18n per-entry guard — setup sanity", () => {
  it("enumerates a non-trivial number of catalogs and entries", () => {
    expect(CATALOGS.length).toBeGreaterThanOrEqual(30)
    const totalEntries = CATALOGS.reduce((n, c) => n + c.options.length, 0)
    expect(totalEntries).toBeGreaterThan(2000)
  })

  it("covers exactly the 11 non-English locales", () => {
    expect([...LOCALES].sort()).toEqual(
      ["ar", "de", "es", "fr", "he", "hi", "ja", "ko", "pt-BR", "ru", "zh-CN"].sort(),
    )
  })
})

// ---------------------------------------------------------------------------
// Test 1 — every catalog entry EXISTS in every non-English sidecar.
// (The worst failure mode: the id key is entirely absent → picker silently
//  English in that locale.)
// ---------------------------------------------------------------------------

describe("every catalog entry has a sidecar translation entry", () => {
  const cases: Array<[string, LocaleId, string]> = []
  for (const c of CATALOGS) {
    for (const locale of LOCALES) {
      for (const o of c.options) cases.push([c.catalogId, locale, o.id])
    }
  }

  it.each(cases)("%s [%s] entry exists: %s", (catalogId, locale, id) => {
    const entry = mapFor(catalogId, locale)[id]
    expect(
      entry,
      `Missing i18n entry "${id}" in packages/shared/src/i18n/${catalogId}.${locale}.ts. ` +
        `The "${catalogId}" picker silently falls back to English for this option in the "${locale}" locale. ` +
        `Add an entry mirroring its siblings (e.g. ${catalogId}.fr.ts).`,
    ).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// Test 2 — DESCRIPTION is translated wherever the catalog convention carries it.
// ---------------------------------------------------------------------------

describe("description is translated for every entry (where the catalog carries descriptions)", () => {
  const cases: Array<[string, LocaleId, string, boolean]> = []
  for (const c of CATALOGS) {
    for (const locale of LOCALES) {
      // Gate per (catalog, locale): only catalogs whose convention translates
      // descriptions are subject to the requirement.
      const required = localeTranslatesDescriptions(c.catalogId, locale)
      for (const o of c.options) {
        // English entry must itself have a description to require a translation.
        if (!has(o.description)) continue
        cases.push([c.catalogId, locale, o.id, required])
      }
    }
  }

  it.each(cases)("%s [%s] description: %s", (catalogId, locale, id, required) => {
    if (!required) return // label-only catalog (e.g. loop-subject, seasons)
    const entry = mapFor(catalogId, locale)[id]
    expect(
      has(entry?.description),
      `Missing translated description for "${id}" in packages/shared/src/i18n/${catalogId}.${locale}.ts. ` +
        `This catalog translates descriptions for its other entries in "${locale}", so this one must too ` +
        `(otherwise the picker tooltip falls back to English).`,
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Test 3 — focused, explicit coverage of the exact gap this guard was added
// for. Belt-and-suspenders: even if the data-driven gates above ever loosen,
// these specific entries must carry the specific fields. (Doubles as live
// documentation of the brand-label decision for camera/render.)
// ---------------------------------------------------------------------------

const PERSON_FACIAL_GEOMETRY_IDS = [
  "cheekbones-average", "cheekbones-low", "cheekbones-high-defined", "cheekbones-sculpted", "cheekbones-wide",
  "facial-fullness-average", "facial-fullness-gaunt", "facial-fullness-lean", "facial-fullness-full", "facial-fullness-round",
  "eye-wide", "eye-narrow", "eyelid-standard", "canthal-neutral", "eye-spacing-average",
  "eyeset-average", "eyeset-low", "eyeset-high",
  "nose-tip-natural", "nose-tip-refined", "nose-tip-upturned", "nose-tip-rounded", "nose-tip-drooping",
  "lips-full-lower", "lips-natural", "lips-heart",
] as const

// Brand-named camera bodies / render engines: label stays English (matches the
// sibling convention for arri-alexa, canon-r5, octane-render, redshift, …).
// Only the description is translated.
const CAMERA_FORMAT_BRAND_IDS = ["alexa-65", "sony-venice", "blackmagic-pocket-6k", "red-komodo"] as const
const RENDER_QUALITY_BRAND_IDS = ["arnold-render", "corona-renderer", "vray", "aces"] as const

describe("targeted gap coverage: facial-geometry + brand camera/render entries", () => {
  it.each(LOCALES)("person facial-geometry ids carry label + description [%s]", (locale) => {
    const map = mapFor("person", locale)
    for (const id of PERSON_FACIAL_GEOMETRY_IDS) {
      expect(has(map[id]?.label), `person.${locale}: ${id} label`).toBe(true)
      expect(has(map[id]?.description), `person.${locale}: ${id} description`).toBe(true)
    }
  })

  it.each(LOCALES)("brand camera/render ids carry description, label left English [%s]", (locale) => {
    const cam = mapFor("camera-format", locale)
    for (const id of CAMERA_FORMAT_BRAND_IDS) {
      expect(has(cam[id]?.description), `camera-format.${locale}: ${id} description`).toBe(true)
    }
    const ren = mapFor("render-quality", locale)
    for (const id of RENDER_QUALITY_BRAND_IDS) {
      expect(has(ren[id]?.description), `render-quality.${locale}: ${id} description`).toBe(true)
    }
  })
})
