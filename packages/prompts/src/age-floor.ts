/**
 * The minor-age floor — Layer 1 of spec 2026-09-01-app-reports-triage-design.md
 * §3.3 (W1-a). Content-free: this module decides WHICH catalog entries a minor
 * subject may not carry; the clause a deployment appends lives in its
 * registered PromptPolicy (backend/src/lib/prompt-policies/), never here.
 *
 * `ADULT_ONLY_FLAG`, `ADULT_AGE_IDS`, `MINOR_IMPLYING_TYPE_IDS` and
 * `isMinorAge` live in the import-free leaf `age-signal.ts` and are
 * re-exported here unchanged — this module's own catalog-funnel imports
 * (`person-packs.js`, `picker-catalogs.js`) are exactly what `person.ts` /
 * `styling.ts` must NOT reach through, on pain of reopening the
 * person → age-floor → picker-catalogs load-time cycle (see `age-signal.ts`'s
 * header). `person.ts` / `styling.ts` import `isMinorAge` from
 * `age-signal.ts` directly instead of from here.
 */

import { getRegisteredPeople } from "./person-packs.js"
import { getRegisteredPickerCatalogs, type PickerCatalog, type PickerOption } from "./picker-catalogs.js"
import { isMinorAge, ADULT_AGE_IDS, MINOR_IMPLYING_TYPE_IDS } from "./age-signal.js"

export { ADULT_ONLY_FLAG, ADULT_AGE_IDS, MINOR_IMPLYING_TYPE_IDS, isMinorAge } from "./age-signal.js"

/** Shape shared by every catalog entry the floor reads. */
export interface AdultOnlyEntry {
  readonly id: string
  readonly promptHint: string
  readonly term?: string
  readonly adultOnly?: true
}

/** The picker catalogs (by `catalogId`) this floor sweeps beside person.
 *  Exported because it is the SINGLE source of truth for two things that used
 *  to be maintained by hand and drifted: which catalogs `getAdultOnlyEntries`
 *  sweeps for the flag, and which analyzer keys `FLOORED_PICKER_KEYS` strips
 *  flagged ids out of (a `photo-genre` swept for the flag but absent from the
 *  strip list let `glamour-portrait` survive on a minor). */
export const ADULT_SWEPT_CATALOG_IDS = ["styling", "mood", "pose", "photo-genre"] as const

/** Membership form of the list above (the sweep does one lookup per catalog). */
const ADULT_SWEPT_CATALOG_ID_SET: ReadonlySet<string> = new Set(ADULT_SWEPT_CATALOG_IDS)

/** Flatten a catalog's options regardless of shape: single-dim catalogs carry
 *  `options` directly, multi-dim ones carry `dimensions[].options` (mirrors
 *  `applyDeny` in catalog-packs.ts, the other consumer that has to handle
 *  both shapes). */
function optionsOf(catalog: PickerCatalog): ReadonlyArray<PickerOption> {
  if (catalog.kind === "single") return catalog.options ?? []
  return (catalog.dimensions ?? []).flatMap((d) => d.options)
}

/** Every entry, across the swept catalogs, that carries the flag. Reads every
 *  catalog through the pack-composed funnel — `getRegisteredPeople()` for
 *  person, `getRegisteredPickerCatalogs()` for styling/mood/pose/photo-genre —
 *  so a pack-added or pack-replaced entry is included. */
export function getAdultOnlyEntries(): ReadonlyArray<AdultOnlyEntry> {
  const catalogEntries = getRegisteredPickerCatalogs()
    .filter((c) => ADULT_SWEPT_CATALOG_ID_SET.has(c.catalogId))
    .flatMap(optionsOf)
  const all: ReadonlyArray<AdultOnlyEntry> = [...getRegisteredPeople(), ...catalogEntries]
  return all.filter((e) => e.adultOnly === true)
}

/** The set of flagged ids (fast membership for the collectors). */
export function getAdultOnlyIds(): ReadonlySet<string> {
  return new Set(getAdultOnlyEntries().map((e) => e.id))
}

/**
 * The pre-W1-b `promptHint` of every `adultOnly` entry the spec
 * (2026-09-01-app-reports-triage-design §3.3) listed for rewording — including
 * the two the harness kept at their current wording (harmless double coverage) —
 * plus the hard-coded midriff+navel fold clause. These strings are permanently part of the strip
 * set: a consumer that has not bumped `@nodaro/prompts` still emits them, and
 * the client-assembled `seedPrompt` path is exactly how the 2026-07-30
 * minor-age prompts reached a provider. Retiring can only ever cause an EXTRA
 * strip, and only for a subject `isMinorAge` has already judged a minor — so
 * the list only grows, never shrinks.
 *
 * `promptHint` ONLY, for the same reason `getAdultOnlyHintStrings` gives:
 * `term` is short display vocabulary and the composed-catalog projection
 * back-fills a derived `term` for every option, so terms collide with benign
 * everyday text. Assembled prompts and client seedPrompts are built from
 * hints, never from terms. The three W1-b entries that are NOT flagged —
 * `texture-dewy`, `texture-baby-soft`, `eye-state-staring-camera` (spec
 * §3.3's "deliberately not flagged" list) — are absent: their old wording
 * never belonged to the floor.
 *
 * 15 flagged hints + the fold literal = 16.
 */
export const RETIRED_ADULT_ONLY_HINT_STRINGS: ReadonlyArray<string> = [
  // bust-very-full
  "very full bust",
  // silhouette-hourglass
  "hourglass silhouette",
  // waist-defined
  "defined waist",
  // lip-state-glossy
  "with high-shine glossy wet-look lips",
  // lip-state-parted
  "with lips slightly parted, taking a soft breath",
  // lip-state-bitten
  "playfully biting the lower lip",
  // eye-state-half-lidded
  "with heavy half-lidded sleepy eyes",
  // texture-glistening
  "with glistening skin, sweat or oil catching the light",
  // texture-shower-fresh-wet
  "with just-out-of-the-shower wet skin, water beading on the surface and rolling in slow droplets down the curves of the body",
  // feature-bare-shoulders
  "with bare shoulders exposed, the line of the collarbone and shoulder muscles uncovered",
  // feature-collarbone-visible
  "with a prominent collarbone clearly defined and catching the light",
  // feature-midriff-visible
  "wearing a cropped style with the midriff visible",
  // state-fitted — the 2026-07-30 incident clause
  "the clothing fitted and form-conscious, hugging the contours of the body",
  // state-wet
  "the clothing soaked and wet, the fabric clinging to the body and dripping water",
  // pose `biting-lip` (the lip-state-bitten twin)
  "biting the lower lip with a subtle playful expression",
  // the hard-coded midriff+navel fold in emitIndependentFragments — not any
  // entry's hint, so retiring it ADDS a needle for a clause that really is
  // emitted verbatim.
  "wearing a cropped style, midriff and navel visible",
]

/** Every full prompt-hint string a flagged entry can inject, lower-cased,
 *  longest first — the backend policy strips text that contains any of them
 *  (Layer 2), which is how flagged wording arriving inside free text (a
 *  client-assembled seedPrompt) is caught. Seeded with
 *  `RETIRED_ADULT_ONLY_HINT_STRINGS` so a catalog rewording can never narrow
 *  the strip set for a consumer still shipping the pre-rephrase wording.
 *
 *  `promptHint` ONLY, deliberately — `term` is analyzer/UI vocabulary
 *  (compact-mode display), and `picker-catalogs.ts`'s composed-catalog
 *  projection back-fills a `term` for EVERY option via `deriveTerm(label)`
 *  when no explicit term was authored (e.g. "lounging", "cropped top",
 *  "school uniform", "lying down"). Those short, generic derived terms are
 *  exactly the kind of everyday word that collides with unrelated, benign
 *  text and over-strips it. Assembled prompts and client seedPrompts are
 *  built from HINTS, never from terms, so hints are the only strings that
 *  can actually arrive verbatim in free text — terms don't need to be (and
 *  must not be) swept here. */
export function getAdultOnlyHintStrings(): ReadonlyArray<string> {
  const out = new Set<string>(RETIRED_ADULT_ONLY_HINT_STRINGS)
  for (const e of getAdultOnlyEntries()) {
    if (e.promptHint) out.add(e.promptHint.toLowerCase())
  }
  return [...out].filter((s) => s.length >= 8).sort((a, b) => b.length - a.length)
}

/**
 * Every full prompt-hint string that DESCRIBES A MINOR — the mirror of
 * `getAdultOnlyHintStrings`, and the needle list for the TEXT signal below.
 *
 * Why a text signal exists at all: `isMinorAge` reads the structured picker
 * value, and the P0 arrival path does not have one. A thin client can create a
 * character row carrying only `{nodeId, name, projectId}` and send the picker
 * selection as an already-assembled `seedPrompt`, so `row.person === null`
 * while the prompt itself says "a young child around 5 years old". That client
 * assembles the text FROM THESE HINTS, which is exactly why the catalog is the
 * drift-proof needle list: a new minor age entry is swept the day it is added,
 * with no second list to remember.
 *
 * Selection is DERIVED, never hand-listed: an `age` entry is a minor unless its
 * id is in the `ADULT_AGE_IDS` allow-list (so a new age id is inside the floor
 * by default — same ratchet as `isMinorAge`), plus every `type` entry named by
 * `MINOR_IMPLYING_TYPE_IDS`. Read through the pack-composed funnel
 * (`getRegisteredPeople()`), so a deployment pack's entries are swept too.
 *
 * `promptHint` ONLY — never `term` and never `label`, for the same reason
 * `getAdultOnlyHintStrings` gives: `term` is short display vocabulary
 * ("in their teens" as a compact chip) and the composed-catalog projection
 * back-fills a derived `term` for every option, so terms collide with benign
 * text. The `>= 8` filter drops `age-custom`'s empty hint (`""`), which would
 * otherwise match every string ever written.
 */
let cachedMinorHints: ReadonlyArray<string> | null = null
let cachedMinorHintSourceCount = -1
export function getMinorAgeHintStrings(): ReadonlyArray<string> {
  const people = getRegisteredPeople()
  if (cachedMinorHints && cachedMinorHintSourceCount === people.length) return cachedMinorHints
  const out = new Set<string>()
  for (const e of people) {
    const minorAge = e.dimension === "age" && !ADULT_AGE_IDS.has(e.id)
    const minorType = e.dimension === "type" && MINOR_IMPLYING_TYPE_IDS.has(e.id)
    if (!minorAge && !minorType) continue
    if (e.promptHint) out.add(e.promptHint.toLowerCase())
  }
  cachedMinorHintSourceCount = people.length
  cachedMinorHints = [...out].filter((s) => s.length >= 8).sort((a, b) => b.length - a.length)
  return cachedMinorHints
}

function escapeReSource(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** One needle's regex source: the phrase's tokens — split on whitespace AND
 *  hyphens — escaped and rejoined by `[\s-]+`, so it matches however the text
 *  that carries it happened to be spaced or hyphenated. */
function needleTokenSource(needle: string): string {
  return needle
    .trim()
    .split(/[\s-]+/)
    .filter((t) => t.length > 0)
    .map(escapeReSource)
    .join("[\\s-]+")
}

/**
 * The word-bounded alternation SOURCE for a needle list — the one place both
 * layers of the floor build their matcher, so they can never disagree about
 * what "the same phrase" means.
 *
 * Two properties, both load-bearing:
 *  - **Separator tolerance.** A catalog hint is authored with single spaces
 *    ("very full bust"), but the free text that carries it is written by a
 *    human or an LLM and arrives as "very-full bust" or "very   full    bust".
 *    A literal alternation misses those, and a miss is a flagged phrase
 *    reaching the provider on a minor's prompt. Each needle's tokens are
 *    joined by `[\s-]+`, which requires AT LEAST one separator — so
 *    "very fullbust" (no separator at all) is still not a match, and the
 *    phrase can't silently widen into a substring rule.
 *  - **Word boundaries.** `(?<![\w-])` / `(?![\w-])` keep a needle from
 *    gluing onto an adjacent word's characters ("mesh tops" must survive a
 *    "mesh top" needle).
 *
 * Ordering is the CALLER's: pass needles longest-first so the alternation
 * consumes the longest match at a given position instead of leaving debris.
 * Returns `null` when there is nothing to match (an empty list would otherwise
 * compile to `(?:)`, which matches everywhere). Flags are the caller's too —
 * `"i"` for a `.test()` instance, `"gi"` for one used with `String.replace`.
 */
export function buildNeedleAlternationSource(needles: ReadonlyArray<string>): string | null {
  const alts = needles.map(needleTokenSource).filter((s) => s.length > 0)
  if (alts.length === 0) return null
  return `(?<![\\w-])(?:${alts.join("|")})(?![\\w-])`
}

/** Needle alternation over `getMinorAgeHintStrings()`, word-bounded on both
 *  sides so a hint can only match a whole phrase. Deliberately NOT global:
 *  this instance is only ever `.test()`ed, and a `/g` regex would carry
 *  `lastIndex` across calls. Cached by needle count (packs are registered
 *  before the first prompt is assembled). */
let cachedMinorNeedleRe: RegExp | null = null
let cachedMinorNeedleCount = -1
function minorNeedleRegex(): RegExp | null {
  const needles = getMinorAgeHintStrings()
  if (cachedMinorNeedleRe && cachedMinorNeedleCount === needles.length) return cachedMinorNeedleRe
  cachedMinorNeedleCount = needles.length
  const src = buildNeedleAlternationSource(needles)
  cachedMinorNeedleRe = src === null ? null : new RegExp(src, "i")
  return cachedMinorNeedleRe
}

/**
 * NUMBER-FIRST age shapes: the ones `buildAgeFragment` (person.ts) emits for a
 * CUSTOM age ("N years old", "N year old", "N-year-old") and the catalog's own
 * "2-3 years old" range (the FIRST number decides), plus the colloquial tails a
 * human or an LLM writes instead — "12yo", "12 yo", "12 y.o.", "12 y/o",
 * "12 yr old", "12-yr-old", "12yrs old", "12 years of age". The cut is `< 20`,
 * the same boundary `isMinorAge` uses for `customAge` and the same one
 * `buildAgeFragment` switches to "in their teens" at.
 *
 * Both boundaries are load-bearing. The LEADING one stops a match inside a
 * larger token; the TRAILING one is what makes "a 5 year older sibling" a
 * non-hit ("old" may not glue onto "older") and what stops "yo" from firing
 * inside "12 young" or "12 yoga". Used via `matchAll`, which clones the regex
 * rather than advancing this instance's `lastIndex`.
 */
const NUMERIC_AGE_RE =
  /(?<![\w-])(\d{1,3})(?:\s*-\s*\d{1,3})?\s*-?\s*(?:years?\s*-?\s*old|yrs?\s*-?\s*old|y(?:\.\s*o\.?|\/o|o)|years?\s+of\s+age)(?![\w-])/gi

/**
 * AGE-FIRST shapes, where the number trails the word instead of leading it:
 * "age 12", "aged 12", "at the age of 12". The leading boundary is what keeps
 * "image 12" / "page 12" out (the `age` there is glued to a preceding word
 * character), and the trailing one keeps "aged 12th" out.
 */
const PREFIXED_AGE_RE = /(?<![\w-])aged?\s+(?:of\s+)?(\d{1,3})(?![\w-])/gi

/** Every rule that reads a NUMBER out of the text, each capturing the age in
 *  group 1. Iterated together below so a new shape is one array entry. */
const AGE_NUMBER_RULES: ReadonlyArray<RegExp> = [NUMERIC_AGE_RE, PREFIXED_AGE_RE]

/** The one NON-numeric shape `buildAgeFragment` emits below 20 (`${n} years
 *  old, in their teens`). Kept as its own rule rather than as a catalog term.
 *  Separator-tolerant on the same terms as the needle alternation, so
 *  "in  their  teens" and "in-their-teens" are the same phrase. */
const IN_THEIR_TEENS_RE = /(?<![\w-])in[\s-]+their[\s-]+teens(?![\w-])/i

/**
 * True when free text describes a MINOR subject. Three rules, in order:
 *   1. any minor-age / minor-implying-type prompt hint, word-bounded;
 *   2. a numeric age below 20 in any shape `buildAgeFragment` emits;
 *   3. the literal "in their teens".
 *
 * Deliberately NOT a bare-word check: "child", "teen", "kid" alone must never
 * fire, or an adult prompt that merely MENTIONS a child ("a mother holding her
 * child") would be floored — the spec's "adults are byte-identical" is a hard
 * requirement, so every rule here is a full phrase or a bounded number.
 *
 * Pairs with `isMinorAge`, never replaces it: the structured picker value is
 * the primary signal; this catches the same subject when only the assembled
 * text survives.
 */
export function containsMinorAgeHint(text: string | null | undefined): boolean {
  if (typeof text !== "string" || text.trim().length === 0) return false
  const re = minorNeedleRegex()
  if (re && re.test(text)) return true
  for (const rule of AGE_NUMBER_RULES) {
    for (const m of text.matchAll(rule)) {
      const n = Number(m[1])
      if (Number.isFinite(n) && n < 20) return true
    }
  }
  return IN_THEIR_TEENS_RE.test(text)
}

/** The analyzer/import value keys the floor strips flagged ids out of:
 *  `person` plus EVERY catalog the flag sweep reads. DERIVED, never
 *  hand-listed — the hand-written version omitted `photo-genre` while the
 *  sweep included it, so a minor kept `glamour-portrait`. The analyzer JSON is
 *  keyed by picker type id (`describe-to-picker.ts`), which is the same string
 *  as the catalog id, so this list IS the set of keys to visit. */
export const FLOORED_PICKER_KEYS = ["person", ...ADULT_SWEPT_CATALOG_IDS] as const

function stripIds(obj: Record<string, unknown>, drop: ReadonlySet<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string") {
      if (!drop.has(v)) out[k] = v
    } else if (Array.isArray(v)) {
      const kept = v.filter((x) => !(typeof x === "string" && drop.has(x)))
      if (kept.length > 0) out[k] = kept
    } else {
      out[k] = v
    }
  }
  return out
}

/** Analyzer / import post-filter: when the person value describes a minor,
 *  remove every flagged id from the person, styling, pose and mood values.
 *  Identity (same reference) for an adult. */
export function applyMinorAgeFloorToPickerValues<T extends Record<string, unknown>>(values: T): T {
  const person = values.person
  if (!person || typeof person !== "object" || !isMinorAge(person as { age?: string; customAge?: number; type?: string })) return values
  const drop = getAdultOnlyIds()
  const out: Record<string, unknown> = { ...values }
  for (const key of FLOORED_PICKER_KEYS) {
    const v = out[key]
    if (v && typeof v === "object" && !Array.isArray(v)) out[key] = stripIds(v as Record<string, unknown>, drop)
  }
  return out as T
}
