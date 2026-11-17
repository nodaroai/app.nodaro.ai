import { hasCredits } from "@/lib/edition"
import { surfaceBillingSelfServe } from "@/lib/surface-selectors"

/**
 * Whether a page may send the person to the plans (/pricing) to get a
 * feature their plan lacks: a billing edition with self-serve purchase on,
 * the same rule that shows the sidebar's Pricing entry. Elsewhere (a prepaid
 * deployment, an edition without billing) nothing can be bought, so a page
 * says what the plan lacks without the link.
 */
export function plansOnSale(): boolean {
  return hasCredits() && surfaceBillingSelfServe()
}
