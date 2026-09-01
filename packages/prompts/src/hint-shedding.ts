/**
 * The shed arithmetic shared by the image (`assembleImageInput`) and video
 * (`composeVideoPromptText`) cap-aware assemblers, so the two surfaces cannot
 * drift in WHICH clause goes first when a provider's prompt cap overflows.
 *
 * Only the arithmetic lives here. Each surface keeps its own loop, because what
 * they MEASURE differs: the image side reads `buildImagePrompt`'s
 * `overflowChars` (the cap clamp reports how much it cut), while the video side
 * measures the resolver-FRAMED body against the route's effective ceiling. Both
 * hand this function the same question — "how many of the first `kept` clauses
 * may stay if `deficit` characters have to leave the body?" — and both re-assemble
 * and re-check afterwards.
 *
 * WHAT COUNTS AS A SHEDDABLE CLAUSE (both surfaces, one answer): every clause
 * the platform RENDERED from catalog ids — the SUBJECT fold and the cinematic
 * DIRECTION fold alike. They are decoration of the same class, so exempting
 * either would not save it: the overflow would simply land in the provider's
 * order-blind tail clamp, severing reference bindings or the end of the user's
 * prose instead — precisely the bug this machinery exists to prevent. Never
 * sheddable: the user's prose, the bound references and the framing text the
 * reference resolver adds, and the structured fragment (user CONTENT).
 *
 * THE LIST IS A SURVIVAL ORDER, NOT A STRING ORDER. It was both until the
 * `[style]` section landed; now a look clause is lifted out of the body and
 * reads after every motion clause however early it folds
 * (`prompt-style-section.ts`). Position here still answers exactly one question
 * — who leaves first — and `clauseCosts` is how the caller tells this function
 * what a clause actually costs in a shape it can no longer infer from the
 * clause text alone.
 */
import { PROMPT_HINT_SEPARATOR } from "./prompt-hint-join.js"

/**
 * How many of the first `kept` hint clauses may STAY if `deficit`
 * characters have to leave the body. Walks the fold order from the TAIL,
 * subtracting each clause plus the separator it brought, and stops as soon as
 * enough has been reclaimed.
 *
 * The name is historical (direction was the first and for a while the only
 * channel); the list both callers pass is now the COMBINED fold —
 * `[...subject, ...direction]` on both surfaces — so the shed order is that
 * combined order REVERSED: the direction block empties first, then the subject
 * block. Deliberate, and the reason the two folds share one list: a fully
 * specified person renders ~30 clauses, so a subject fold left unsheddable
 * would be the single biggest way to push an overflow into the order-blind
 * clamp, while a decorative grade or ISO value survives.
 *
 * Within the direction block the order is `DIRECTION_FIELDS` order REVERSED
 * (and within the subject block, `SUBJECT_FIELDS` reversed). Note what that
 * is and is not: each table's order is a COMPATIBILITY order (grouped by family,
 * with the legacy `DirectionFields` block pinned last so every pre-registry
 * caller's fold stays byte-identical) — it is NOT a ranking of how load-bearing
 * a dimension is, and this function does not claim one. Tail-first is chosen
 * because it is deterministic, matches the fold order the API documents, and
 * needs no second ordering to drift out of sync with the table. A caller mixing
 * legacy keys with the newer ones can therefore lose e.g. `lightingId` before a
 * decorative `isoValue` clause; if that ever matters, the fix is an explicit
 * priority column on `DIRECTION_FIELDS`, not a second hand-kept list here.
 *
 * `clauseCosts[i]` is what clause `i` really adds to the assembled prompt.
 * Without it each clause is charged its text plus one separator, which is what
 * a clause folded inline costs — but a clause that lands in the `[style]`
 * section carries section bytes too (the first one carries the whole header),
 * and under-charging it makes this walk cover the deficit with MORE clauses
 * than it needs. Both in-package callers pass exact composed-length deltas
 * (`sectionedClauseCosts`); the default keeps the pre-section arithmetic for
 * anyone else.
 *
 * Still deliberately approximate (assembly is not perfectly additive — a
 * downstream frame can grow or shrink around the body); the caller re-assembles
 * and re-checks, and this function strictly decreases `kept` whenever
 * `deficit > 0`, so that loop terminates however the costs are priced.
 */
export function keepableDirectionHints(
  hintClauses: readonly string[],
  kept: number,
  deficit: number,
  clauseCosts?: readonly number[],
): number {
  let remaining = deficit
  let next = kept
  while (next > 0 && remaining > 0) {
    next -= 1
    remaining -= clauseCosts?.[next] ?? hintClauses[next]!.length + PROMPT_HINT_SEPARATOR.length
  }
  return next
}
