import { describe, it, expect } from "vitest"
import { PICKER_CATALOGS, type PickerOption } from "../picker-catalogs.js"
import { TERM_MAX_CHARS, deriveTerm, isSuspiciousDerivedTerm } from "../term.js"

/** A term is a phrase, not a sentence (see the convention in `term.ts`). */
const TERM_MAX_WORDS = 8

/**
 * Two ids in one catalog may share a term ONLY where they are deliberately the
 * same thing filed twice. `music-genre` cross-lists Amapiano under both the
 * electronic and the global groupings, so both ids legitimately inject
 * "amapiano". Anything else is a copy-paste that makes two picks
 * indistinguishable downstream — widen this set only for another deliberate
 * cross-listing, never to silence a collision.
 */
const DUPLICATE_TERM_EXCEPTIONS: ReadonlySet<string> = new Set(["music-genre • amapiano"])

/**
 * The compact-term guard.
 *
 * Every catalog option carries a `term` — the short professional phrase a
 * consumer injects in compact hint mode. `term` is RESOLVED at build time
 * (`resolveTerm`): an authored `term` on the catalog entry when there is one,
 * the mechanically-derived label otherwise.
 *
 * The derivation is safe for the large majority of labels, and predictably
 * WRONG for a few recognizable shapes — UI compounds ("None / Hard Cut",
 * "Fog / Mist"), parenthetical annotations ("Ultra-wide (14mm)",
 * "ISO 1600 (visible grain)"), and — in the catalogs listed below — bare
 * modifier words that only become a trade term with their category noun
 * attached. This test fails for exactly those entries, so the fix is to
 * author an explicit `term` on the catalog entry rather than to ship a
 * mangled fragment into every downstream prompt.
 */

/**
 * Catalogs whose labels are MODIFIERS, not standalone terms: a single derived
 * word there is suspicious and must be authored explicitly.
 *
 *  - `lighting`   — the standard trade terms literally contain the category
 *                   noun: "Short"/"Broad"/"Loop"/"Butterfly"/"Split"/"Hard"
 *                   mean nothing alone and must read "short lighting",
 *                   "loop lighting", "hard light". They also collide head-on
 *                   with common English words, which is the worst case for a
 *                   bare injection.
 *  - `color-look` — "Warm"/"Cool"/"Faded"/"Vibrant" are grade adjectives; the
 *                   term a colorist writes is "warm grade", "cool grade".
 *  - `mood`       — the labels are bare emotion adjectives ("Happy", "Sad",
 *                   "Tense"). Injected alone a bare adjective has nothing to
 *                   attach to; the catalog describes the SUBJECT's emotional
 *                   state, so the term names the expression or demeanor the
 *                   hint spells out — "melancholic expression", "cocky
 *                   smirk". ("melancholic mood" would be the wrong register:
 *                   it points the model at the scene, not the face.)
 *
 * Deliberately NOT in the set:
 *  - `tone` is free text, not a catalog at all.
 *  - `aesthetic` / `style` / `render-quality` bare labels are proper names of
 *    the thing itself ("cottagecore", "noir", "octane render") — already the
 *    professional term, so flagging them would be noise.
 *  - the multi-dim `person` / `styling` dimensions are bare by nature (dozens
 *    of one-word options per dimension); they are left out to keep this guard
 *    a work list rather than a wall. Widen the set here when a dimension is
 *    shown to inject ambiguously.
 */
const BARE_WORD_SUSPICIOUS_CATALOG_IDS: ReadonlySet<string> = new Set([
  "lighting",
  "color-look",
  "mood",
])

interface Row {
  readonly catalogId: string
  readonly option: PickerOption
}

/** Every option in the frozen upstream base, single-dim + multi-dim alike. */
function allRows(): Row[] {
  const rows: Row[] = []
  for (const c of PICKER_CATALOGS) {
    for (const o of c.options ?? []) rows.push({ catalogId: c.catalogId, option: o })
    for (const d of c.dimensions ?? []) {
      for (const o of d.options) rows.push({ catalogId: c.catalogId, option: o })
    }
  }
  return rows
}

const ROWS = allRows()

describe("catalog compact terms", () => {
  it("walks a non-trivial number of options", () => {
    expect(ROWS.length).toBeGreaterThan(1000)
  })

  it("every label whose derived term is unsafe has an explicit term authored", () => {
    const flagged: string[] = []
    for (const { catalogId, option } of ROWS) {
      const bareWordSuspicious = BARE_WORD_SUSPICIOUS_CATALOG_IDS.has(catalogId)
      if (!isSuspiciousDerivedTerm(option.label, { bareWordSuspicious })) continue
      const derived = deriveTerm(option.label)
      // An authored term is anything that is NOT just the derivation; when the
      // two are equal, nothing was authored and the mangled form would ship.
      if (option.term !== derived) continue
      flagged.push(`${catalogId} • ${option.id} • ${option.label} → ${derived}`)
    }
    expect(
      flagged,
      `${flagged.length} catalog entries need an explicit \`term\` (label cannot be safely lowercased):\n${flagged.join("\n")}`,
    ).toEqual([])
  })

  it("every resolved term is well-formed", () => {
    const bad: string[] = []
    for (const { catalogId, option } of ROWS) {
      const term = option.term
      const where = `${catalogId} • ${option.id} • ${option.label}`
      if (typeof term !== "string") {
        bad.push(`${where} → term is not a string (a builder path forgot to resolve it)`)
        continue
      }
      if (term.length > TERM_MAX_CHARS) {
        bad.push(`${where} → ${term.length} chars, over the ${TERM_MAX_CHARS} cap: "${term}"`)
      }
      if (term.includes("\n")) bad.push(`${where} → contains a newline: ${JSON.stringify(term)}`)
      if (term.endsWith(".")) bad.push(`${where} → ends with a period: "${term}"`)
      if (term === "" && option.promptHint !== "") {
        bad.push(`${where} → empty term on an entry that DOES inject a hint`)
      }
      const words = term.trim().split(/\s+/).filter(Boolean)
      if (words.length > TERM_MAX_WORDS) {
        bad.push(`${where} → ${words.length} words, over the ${TERM_MAX_WORDS} cap: "${term}"`)
      }
    }
    expect(bad, `${bad.length} malformed terms:\n${bad.join("\n")}`).toEqual([])
  })

  it("no two ids in a catalog resolve to the same term", () => {
    const byCatalog = new Map<string, Map<string, string[]>>()
    for (const { catalogId, option } of ROWS) {
      if (!option.term) continue // no-op "auto"/"none" entries all inject nothing
      let terms = byCatalog.get(catalogId)
      if (!terms) byCatalog.set(catalogId, (terms = new Map()))
      const ids = terms.get(option.term)
      if (ids) ids.push(option.id)
      else terms.set(option.term, [option.id])
    }
    const collisions: string[] = []
    for (const [catalogId, terms] of byCatalog) {
      for (const [term, ids] of terms) {
        const unique = [...new Set(ids)]
        if (unique.length < 2) continue
        if (DUPLICATE_TERM_EXCEPTIONS.has(`${catalogId} • ${term}`)) continue
        collisions.push(`${catalogId} • "${term}" ← ${unique.join(", ")}`)
      }
    }
    expect(
      collisions,
      `${collisions.length} terms are shared by two ids, so the two picks inject the same fragment:\n${collisions.join("\n")}`,
    ).toEqual([])
  })
})
