/**
 * The node units' rows in @nodaro/shared (tools/units/README.md): the readers
 * of `generated/unit-contracts.ts` and the one rule every table that composes
 * them keeps — a type is hand-written or a node unit, never both. Internal:
 * no entry exports this module, so it adds nothing to the published surface;
 * the tables that compose its rows (producer-types, presentation-utils,
 * json-kinds, fan-out-rows, preview-gate) are what consumers read.
 */
import { UNIT_CONTRACTS, UNIT_JSON_PIPS, UNIT_NON_PROMPT_INPUTS, UNIT_PRESENTS, UNIT_REVIEW_HOLDS } from "./generated/unit-contracts.js"

/**
 * `legacy ∪ units` as a set, `legacy` first, refusing a type that is in both —
 * a type lives in one place (G1; the editor's and the server's composeSet keep
 * the same rule). Throws at module load, so any import of the set fails.
 */
export function composeUnitSet(what: string, legacy: readonly string[], units: readonly string[]): ReadonlySet<string> {
  const clash = units.filter((t) => legacy.includes(t))
  if (clash.length > 0) throw new Error(`${what}: ${clash.join(", ")} is both hand-written and a node unit — a type lives in one place (tools/units/README.md)`)
  return new Set([...legacy, ...units])
}

/** The node units of one producer kind (`contract.producer`), in generated order. */
export const unitProducers = (kind: "audio" | "video" | "image" | "dynamic"): string[] =>
  UNIT_CONTRACTS.filter(([, producer]) => producer === kind).map(([type]) => type)

/** The node units a published app shows as `kind` (`contract.presents`). */
export const unitsPresenting = (kind: "image" | "video" | "audio" | "text"): string[] =>
  UNIT_PRESENTS.filter(([, presents]) => presents === kind).map(([type]) => type)

/** What each node unit's JSON (look) output pips carry (`contract.jsonPips`). */
export const unitJsonPips = (): ReadonlyArray<readonly [string, Readonly<Record<string, "transcript" | "edl" | "other">>]> => UNIT_JSON_PIPS

/** Each node unit's input pips that are never a prompt lane (`contract.nonPromptInputs`). */
export const unitNonPromptInputs = (): ReadonlyArray<readonly [string, ReadonlyArray<string>]> => UNIT_NON_PROMPT_INPUTS

/** The use-case units whose review-on run ends at a Preview that holds what follows (`contract.reviewHold`). */
export const unitReviewHolds = (): readonly string[] => UNIT_REVIEW_HOLDS
