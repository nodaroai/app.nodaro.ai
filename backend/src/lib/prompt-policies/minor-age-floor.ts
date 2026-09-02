/**
 * Minor-age floor - Layer 2 (spec 2026-09-01-app-reports-triage-design.md
 * S3.3 W1-a). Layer 1 (@nodaro/prompts) stops a minor's picker values from
 * EMITTING adult-only hints; this policy is what catches the same wording when
 * it arrives as free text - the 2026-07-30 incident: the client assembled the
 * styling clause into `seedPrompt`, which `buildPortraitPrompt` concatenates
 * verbatim and no catalog change can reach.
 *
 * Deployment content (the clause text) lives HERE, in the backend, per the
 * prompt-policy registry's contract and @nodaro/prompts' content-free guard.
 * Applied once, server-side, at the entity image chokepoint; a browser-side
 * assembly never sees it, so it cannot double.
 */
import type { PromptPolicy } from "../prompt-policy.js"
import { getAdultOnlyHintStrings, buildNeedleAlternationSource } from "@nodaro/prompts"
import { CLOTHED_DEFAULT, CLOTHED_MATCH_REFERENCES, MODEST_ATTIRE_CLAUSE } from "../character-prompts.js"

/** Re-exported so `prompt-policies/index.ts` and every existing import site
 *  keep reading the clause from the policy. It is DEFINED in
 *  `lib/character-prompts.ts` (W1-a) because the assembly layer needs it too:
 *  the scaffolding functions there pick it as the clothing clause for a minor.
 *  One definition, one import direction (here → character-prompts), no cycle. */
export { MODEST_ATTIRE_CLAUSE }

/** The two self-disabling clothing floors (lib/character-prompts.ts) that a
 *  minor's prompt must not carry - they yield to any preceding wardrobe text,
 *  which for a minor is exactly the risk this floor exists to close. Imported
 *  directly (not copied) so this can never drift from the actual floor text;
 *  `character-prompts.ts` imports ONLY from `@nodaro/prompts`, so importing it
 *  here introduces no cycle back into `prompt-policy.ts` / `prompt-policies/`. */
const SELF_DISABLING_FLOORS = [CLOTHED_MATCH_REFERENCES, CLOTHED_DEFAULT]

/**
 * A private marker that can never occur in real prompt text - used to tag a
 * matched needle's span so the CLAUSE it sits in can be repaired (fix round 2)
 * rather than dropped outright. Bare token, NO padding whitespace: the
 * clause-splitting regex below consumes whatever whitespace immediately
 * follows a clause's terminating punctuation (including any the marker itself
 * would contribute), so a marker padded with its own leading space fails the
 * clause's containment check once that leading space has already been eaten
 * by the split - verified empirically, not just reasoned about.
 */
const SENTINEL = "MINOR_AGE_FLOOR_HIT"

/**
 * Needle regex over every flagged promptHint (@nodaro/prompts) plus the two
 * self-disabling floors, longest string first. Several catalog hints carry an
 * internal comma (e.g. "the clothing fitted and form-conscious, hugging the
 * contours of the body") - a shorter flagged phrase can be a literal
 * substring of a longer one ("lips slightly parted" inside "with lips
 * slightly parted, taking a soft breath"), so ordering longest-first is what
 * makes the alternation consume the longest match at a given position instead
 * of leaving the remainder as debris.
 *
 * Built through `buildNeedleAlternationSource` (@nodaro/prompts) rather than
 * from a local escape+join, so this alternation and Layer 1's
 * `containsMinorAgeHint` matcher are the SAME definition of "the same phrase"
 * and cannot drift. That builder supplies both properties this policy needs:
 * word-boundary guards on each side (`(?<![\w-])` / `(?![\w-])`) so a needle
 * can only match a whole word/phrase and never glues onto an adjacent word's
 * characters (e.g. inside an unrelated compound like "mesh tops"); and
 * separator tolerance — each needle's tokens are joined by `[\s-]+`, so a
 * catalog phrase authored with single spaces still matches the text that
 * carries it however the writer spaced or hyphenated it ("very-full bust",
 * "very   full    bust"). Without that tolerance the clause still landed but
 * the flagged wording itself survived the strip, which is the whole point of
 * Layer 2.
 *
 * Global + case-insensitive; used ONLY via `String.replace` (which resets
 * `lastIndex` itself) - never `.test()`/`.exec()` on this shared instance,
 * which would carry `lastIndex` state across calls. Cached by needle COUNT:
 * `@nodaro/prompts`' registered catalogs are fixed once `loadOverlay()` (which
 * registers any deployment catalog packs) has run and BEFORE the first prompt
 * is ever assembled in either process, so the needle list is stable for the
 * lifetime of the cache; the count check is just a cheap invalidation in case
 * a pack is ever registered after the first call (e.g. in tests).
 */
let cachedNeedleRe: RegExp | null = null
let cachedNeedleCount = -1
function needleRegex(): RegExp {
  const all = [...getAdultOnlyHintStrings(), ...SELF_DISABLING_FLOORS.map((s) => s.toLowerCase())]
  const sorted = [...new Set(all)].sort((a, b) => b.length - a.length)
  if (cachedNeedleRe && cachedNeedleCount === sorted.length) return cachedNeedleRe
  cachedNeedleCount = sorted.length
  const src = buildNeedleAlternationSource(sorted)
  // `null` only if every needle were empty — impossible while
  // SELF_DISABLING_FLOORS are compile-time constants, but a never-matching
  // regex is the safe degenerate rather than an everything-matches one.
  cachedNeedleRe = src === null ? /(?!)/g : new RegExp(src, "gi")
  return cachedNeedleRe
}

/** Fix round 2: connector words that can introduce a flagged needle
 *  ("... with NEEDLE", "... wearing NEEDLE") and so are removed together with
 *  it, and can also be left dangling at the START of a clause once the needle
 *  before them is gone ("... and NEEDLE and a soft smile" -> "and a soft
 *  smile" -> "a soft smile"). */
const CONNECTOR_WORDS = "with|in|wearing|and|while|plus|showing|having"
/** Sentinel preceded by AT MOST one connector word — both removed as a unit. */
const SENTINEL_WITH_CONNECTOR_RE = new RegExp(`(?:\\b(?:${CONNECTOR_WORDS})\\s+)?${SENTINEL}`, "gi")
/** A clause that now dangles a bare connector at its start once the needle
 *  (and its own preceding connector, if any) is gone. */
const LEADING_DANGLING_CONNECTOR_RE = new RegExp(`^(?:${CONNECTOR_WORDS})\\b\\s*`, "i")
/** Word tokens, for the keep/drop threshold below. */
const WORD_TOKEN_RE = /[a-z0-9]+/gi

/** Collapse the punctuation debris a clause repair/drop leaves behind, in
 *  order: doubled/stray-spaced commas; a comma stranded right before a
 *  terminator; a doubled full stop; a doubled comma; a leading orphan
 *  terminator; a TRAILING orphan comma/semicolon (the last kept clause had
 *  continued into a now-dropped clause); then collapse whitespace and trim. */
function tidyPunctuation(text: string): string {
  return text
    .replace(/\s+,/g, ",")
    .replace(/\s+([.!?;])/g, "$1")
    .replace(/\.\s*\./g, ".")
    .replace(/,\s*,/g, ",")
    .replace(/^[.,;]\s*/, "")
    .replace(/[,;]\s*$/, "")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Fix round 2 — bounded hybrid repair for one sentinel-carrying clause.
 * Whole-clause drop (fix round 1) over-corrected: when the needle shared a
 * clause with the SUBJECT (no comma between them, e.g. "a child around 7
 * years old with lips slightly parted, taking a soft breath" is one clause
 * once the comma-internal needle is sentinel'd), dropping the clause lost the
 * subject and age along with the flagged wording.
 *
 * Repair instead of drop:
 *  1. Remove the sentinel together with ONE immediately preceding connector
 *     word, if present (the needle's own lead-in — "with NEEDLE", "wearing
 *     NEEDLE" — collapses along with it).
 *  2. If the clause now STARTS with a dangling connector left over from
 *     something the needle wasn't adjacent to (e.g. "... and NEEDLE and a
 *     soft smile" -> "and a soft smile"), strip that leading connector too.
 *  3. Only NOW check size: a clause with fewer than 2 remaining word tokens
 *     is content-free (the needle WAS the clause) and gets dropped; 2+ tokens
 *     means real content survived (a subject, or unrelated trailing text)
 *     and the clause is kept as repaired.
 * Returns `null` for a dropped clause, the repaired string otherwise.
 * A non-sentinel clause passes through unchanged.
 */
function repairClause(clause: string): string | null {
  if (!clause.includes(SENTINEL)) return clause
  let repaired = clause.replace(SENTINEL_WITH_CONNECTOR_RE, "").replace(/\s+/g, " ").trim()
  repaired = repaired.replace(LEADING_DANGLING_CONNECTOR_RE, "")
  const tokenCount = (repaired.match(WORD_TOKEN_RE) ?? []).length
  return tokenCount < 2 ? null : repaired
}

/** Repair or drop every clause that carries a flagged needle (see
 *  `repairClause`), leaving every other clause untouched. Tag each needle
 *  match with the sentinel first, split into clauses on `.`/`,`/`;`
 *  boundaries (keeping the separator with the clause it ends — a
 *  comma-internal needle match consumes its own internal comma, so it never
 *  introduces a split point), repair/drop per clause, rejoin, tidy
 *  punctuation. */
function stripFlaggedClauses(prompt: string): string {
  const marked = prompt.replace(needleRegex(), SENTINEL)
  if (!marked.includes(SENTINEL)) return prompt
  const clauses = marked.split(/(?<=[.,;])\s+/)
  const kept = clauses.map(repairClause).filter((c): c is string => c !== null)
  return tidyPunctuation(kept.join(" "))
}

/** Pure transform: repair or drop every clause carrying a flagged needle or a
 *  self-disabling clothing floor, then append the modest clause - but ONLY if
 *  it is not already present after stripping. Stripping always runs first,
 *  unconditionally: a prompt that already carries the modest clause text
 *  ahead of un-stripped flagged wording (the bypass this fixes) still gets
 *  that wording removed. Idempotent because the second call strips nothing
 *  new and finds the clause already present. */
export function applyMinorAgeFloorToPrompt(prompt: string): string {
  const stripped = stripFlaggedClauses(prompt)
  if (stripped.includes(MODEST_ATTIRE_CLAUSE)) return stripped
  let body = stripped
  if (body.length > 0 && !/[.!?]$/.test(body)) body += "."
  return body.length > 0 ? `${body} ${MODEST_ATTIRE_CLAUSE}.` : `${MODEST_ATTIRE_CLAUSE}.`
}

export const minorAgeFloorPolicy: PromptPolicy = {
  id: "minor-age-floor",
  apply: (a) => (a.kind === "image" && a.subjectMinor === true ? { ...a, prompt: applyMinorAgeFloorToPrompt(a.prompt) } : a),
}
