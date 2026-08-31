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
 */
import { PROMPT_HINT_SEPARATOR } from "./prompt-hint-join.js"

/**
 * How many of the first `kept` direction clauses may STAY if `deficit`
 * characters have to leave the body. Walks the fold order from the TAIL,
 * subtracting each clause plus the separator it brought, and stops as soon as
 * enough has been reclaimed.
 *
 * The shed order is therefore `DIRECTION_FIELDS` order REVERSED. Note what that
 * is and is not: the table's order is a COMPATIBILITY order (grouped by family,
 * with the legacy `DirectionFields` block pinned last so every pre-registry
 * caller's fold stays byte-identical) — it is NOT a ranking of how load-bearing
 * a dimension is, and this function does not claim one. Tail-first is chosen
 * because it is deterministic, matches the fold order the API documents, and
 * needs no second ordering to drift out of sync with the table. A caller mixing
 * legacy keys with the newer ones can therefore lose e.g. `lightingId` before a
 * decorative `isoValue` clause; if that ever matters, the fix is an explicit
 * priority column on `DIRECTION_FIELDS`, not a second hand-kept list here.
 *
 * Deliberately approximate (assembly is not perfectly additive); the caller
 * re-assembles and re-checks, and this function strictly decreases `kept`
 * whenever `deficit > 0`, so that loop terminates.
 */
export function keepableDirectionHints(
  directionHints: readonly string[],
  kept: number,
  deficit: number,
): number {
  let remaining = deficit
  let next = kept
  while (next > 0 && remaining > 0) {
    next -= 1
    remaining -= directionHints[next]!.length + PROMPT_HINT_SEPARATOR.length
  }
  return next
}
