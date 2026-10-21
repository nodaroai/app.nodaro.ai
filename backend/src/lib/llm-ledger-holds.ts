// @reads-none classifies credit ids; reads nothing
/**
 * Which reserved holds can carry a metered LLM billing LEDGER — the only ones
 * whose cancel or sweep must consult the job's billing evidence (R63). Every
 * other hold (an image, a video, a tier LLM id, any fixed price) refunds on a
 * cancel exactly as it always did, with no ledger read: a failed read of a
 * ledger it can never have must not keep its hold.
 *
 * Two kinds, both derived from the funnels that make them:
 *  - a metered LLM hold — its id parses as one (`parseMeteredLlmId`, the
 *    sweeps' own parser; passed in, as it is Cloud code);
 *  - a FIXED-price hold carrying metered calls (`reserveFixedPlusLlmCalls`,
 *    the scrapes' per-item analysis): one usage log under the scrape's fixed
 *    id, the calls' spend in the job's ledger. Its id is the scrape's own
 *    (`<node type>:<tier>`), so the node types below are what may reserve one
 *    — and `reserveFixedPlusLlmCallsImpl` REFUSES a fixed id outside them,
 *    so a new caller cannot hold calls under an id this file would miss.
 */
import { INSTAGRAM_SCRAPE_NODE_TYPE, META_ADS_SCRAPE_NODE_TYPE } from "@nodaro/shared/social"

/** The node types whose fixed-price hold may carry metered LLM calls (`reserveFixedPlusLlmCalls`). */
export const FIXED_PLUS_LLM_CALLS_NODE_TYPES: ReadonlySet<string> = new Set([META_ADS_SCRAPE_NODE_TYPE, INSTAGRAM_SCRAPE_NODE_TYPE])

/** Is `action` a fixed-price id that may carry metered LLM calls? */
export function isFixedPlusLlmCallsHoldId(action: string): boolean {
  const head = action.split(":", 1)[0] ?? ""
  return FIXED_PLUS_LLM_CALLS_NODE_TYPES.has(head)
}

/** Can a hold under `action` carry a metered LLM ledger (R63)? */
export function holdCanCarryLlmLedger(action: unknown, parseMeteredLlmId: (id: string) => unknown): boolean {
  return typeof action === "string" && (parseMeteredLlmId(action) !== null || isFixedPlusLlmCallsHoldId(action))
}
