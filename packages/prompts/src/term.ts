/**
 * Compact professional TERMS for picker-catalog entries.
 *
 * Every picker catalog entry carries a long `promptHint` — a full mechanism
 * description injected downstream by `getParameterPromptHint`. A `term` is the
 * SHORT form of the same entry: the two-to-four word phrase a professional
 * would actually write in a prompt ("whip pan left", "hard cut", "medium
 * close-up") when the consumer wants a compact instruction instead of a
 * paragraph.
 *
 * The split of responsibilities is:
 *   - `label`       → what USERS see in the picker.
 *   - `promptHint`  → what MODELS read in verbose ("full") hint mode.
 *   - `term`        → what MODELS read in compact hint mode.
 *
 * ---------------------------------------------------------------------------
 * THE CONVENTION EVERY CATALOG FOLLOWS
 * ---------------------------------------------------------------------------
 * 1. The catalog's entry interface gains an OPTIONAL `term?: string`. It is
 *    authored only where the label does not already read as the professional
 *    term (see `isSuspiciousDerivedTerm` for the failure shapes); everywhere
 *    else the lowercased label IS the term and no data is added.
 * 2. Alongside each `get<Name>PromptHint(id)` getter, the catalog exports a
 *    sibling `get<Name>Term(id)` implemented as
 *      `export function get<Name>Term(id: string | undefined | null): string {
 *         return resolveTerm(get<Name>(id))
 *       }`
 *    — same arity, same lookup, same empty-string-on-miss behavior, so the two
 *    getters can never disagree about which entry they are describing.
 * 3. An authored `term` is:
 *      - lowercase,
 *      - at most `TERM_MAX_CHARS` characters,
 *      - at most 8 words,
 *      - with NO trailing period,
 *      - phrased the way a professional cinematographer / photographer /
 *        sound designer / stylist would write it in a prompt.
 *    Entries with no standard trade term (exotic morph/portal transitions and
 *    the like) get a short descriptive phrase instead — never a sentence, and
 *    never the long `promptHint`.
 * 4. An entry whose `promptHint` is `""` — the no-op "auto" / "none" entries —
 *    injects NOTHING, so its resolved term is `""` too. `resolveTerm` enforces
 *    that; do not author a `term` on such an entry expecting it to be used.
 *
 * A guard test (`__tests__/catalog-terms.test.ts`) walks every registered
 * catalog and fails for entries whose label cannot be safely lowercased into a
 * term and that have no explicit `term` authored — so the convention above is
 * enforced, not merely documented.
 */

/** Hard cap on an authored/derived term. Longer than this is a hint, not a term. */
export const TERM_MAX_CHARS = 60

/**
 * The minimal shape of a catalog entry that can resolve a term: an id, the
 * user-facing label, the long hint (whose emptiness marks a no-op entry), and
 * the optional authored short term.
 */
export interface TermCarrier {
  readonly id: string
  readonly label: string
  readonly promptHint: string
  readonly term?: string
}

/** Parenthetical segments — "Ultra-wide (14mm)", "ISO 1600 (visible grain)". */
const PARENTHETICAL = /\([^)]*\)/g

/**
 * Mechanical label → term derivation: lowercase, drop parenthetical segments,
 * collapse whitespace, trim.
 *
 * Deliberately NOT clever: it does not split on "/" or strip category nouns.
 * A label like "None / Hard Cut" or "Fog / Mist" has to SURFACE as suspicious
 * (see `isSuspiciousDerivedTerm`) so a human authors the right term — guessing
 * here would quietly inject the wrong wording into every prompt.
 */
export function deriveTerm(label: string): string {
  return label
    .replace(PARENTHETICAL, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

/** Punctuation that marks a UI compound / annotation rather than a trade term. */
const SUSPICIOUS_CHARS = ["/", "(", ")", ":", "&", "→", "×"] as const

export interface SuspiciousTermOptions {
  /**
   * Treat a single-word derived term as suspicious. Set for catalogs whose
   * labels are bare MODIFIERS that only read as a professional term with
   * their category noun attached — lighting "Short" → "short lighting",
   * color-look "Warm" → "warm grade".
   */
  readonly bareWordSuspicious?: boolean
}

/**
 * Is the mechanically-derived term unsafe to inject as-is?
 *
 * True when the label is a UI compound or carries an annotation ("None / Hard
 * Cut", "Ultra-wide (14mm)", "Key: Rembrandt"), when nothing survives the
 * derivation, or — under `bareWordSuspicious` — when the result is a lone word
 * that needs its category noun to mean anything to a model.
 */
export function isSuspiciousDerivedTerm(
  label: string,
  opts: SuspiciousTermOptions = {},
): boolean {
  if (SUSPICIOUS_CHARS.some((c) => label.includes(c))) return true
  const derived = deriveTerm(label)
  if (derived.length === 0) return true
  if (opts.bareWordSuspicious && !derived.includes(" ")) return true
  return false
}

/**
 * The single resolution point every consumer reads: an explicit `term` when
 * the catalog authored one, the derived label otherwise, and `""` for a no-op
 * entry (missing entry, or an "auto"/"none" entry whose `promptHint` is empty
 * and which therefore injects nothing).
 */
export function resolveTerm(entry: TermCarrier | undefined | null): string {
  if (!entry) return ""
  if (entry.promptHint === "") return ""
  return entry.term ?? deriveTerm(entry.label)
}
