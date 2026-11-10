// @registry-enumerates prices the credit ids of the graph it is given through CreditsService — credit ids, not node types, so not a @registry-lookup
/**
 * THE PRICE A BUILT-IN TEMPLATE'S CARD LISTS.
 *
 * A built-in template (`lib/tutorial-seed/templates/*.json`) stores its listed
 * price on the doc (`estimatedCredits`, `estimatedPerMinuteCredits`), and the
 * seeder copies it into `workflow_templates` as the card's figure: the seeder
 * is core and cannot price a graph. The figure is the CHARGED price, the one
 * the Run button and `GET /v1/credits/model-cost` show, never the price-table
 * rows before the deployment's pricing settings apply: the listing of the
 * graph the sync writes (`estimateWorkflowListingAt`, the rules every
 * published listing follows), each node charged as the hosted deployment
 * charges it (`statedPriceTable`, the settings the docs state their prices
 * at, speech priced by length and LLM calls metered, as they are there).
 *
 * Both figures are whole credits (the per-minute column is an integer), and a
 * card is never below what a run is charged (decided 2026-11-10): each step is
 * listed at its own charge, rounded up to a whole credit, as the run charges
 * it, and the card adds them up — the fixed charges into the fixed figure,
 * each length-priced step's charge per minute into the per-minute figure (a
 * render the price table rates at 15 a minute is charged 16.5, so it lists
 * 17). It is the rule a listing a user publishes is priced by.
 *
 * `backend/scripts/template-prices.ts --fix` writes these figures into every
 * built-in template; `template-listing-prices.test.ts` fails a stored figure
 * that differs from them.
 */
import { speechLengthPricingEnabled } from "../../lib/config.js"
import { templateForPreviewStopRule } from "../../lib/tutorial-seed/preview-gate.js"
import type { TutorialTemplateDoc } from "../../lib/tutorial-seed/types.js"
import { CreditsService, type AppListingEstimate, type ChargedPriceTable, type EstimateEdge, type EstimateNode } from "./credits.js"
import { statedPriceTable } from "./stated-prices.js"

/** What a built-in template's doc stores for its card. */
export interface TemplateCardPrice {
  /** The fixed credits. */
  readonly estimatedCredits: number
  /** The credits per minute of the recording; absent when no part follows its length. */
  readonly estimatedPerMinuteCredits?: number
  /** The listing holds a metered LLM call's estimate (shown `≈`). */
  readonly estimate: boolean
}

/**
 * A template that holds a UGC video (a UGC Clip) is priced by the UGC estimate,
 * which plans the video with the private plugin: no function here can derive
 * its figure, which its own test pins and the release's estimate check
 * re-derives from the live estimate (`ugc-templates.test.ts`).
 */
export function pricedByTheUgcEstimate(doc: Pick<TutorialTemplateDoc, "nodes">): boolean {
  return (doc.nodes as ReadonlyArray<{ type?: unknown }>).some((n) => n.type === "ugc-clip")
}

/** Up to a whole credit, never down (a float's last digit never adds one). */
export const wholeCreditsUp = (credits: number): number => Math.ceil(Math.round(credits * 1e6) / 1e6)

/**
 * A card's two figures from its listing at the charged prices: its fixed parts
 * and its per-minute parts, each the sum of the steps' own charges (whole
 * credits already, `chargedCredits`), held to whole credits rounded up.
 */
export function cardPriceOf(listing: AppListingEstimate): TemplateCardPrice {
  const perMinute = wholeCreditsUp(listing.previewPerMinute + listing.finalPerMinute)
  return {
    estimatedCredits: wholeCreditsUp(listing.preview + listing.final),
    ...(perMinute > 0 ? { estimatedPerMinuteCredits: perMinute } : {}),
    estimate: listing.estimate === true,
  }
}

/** The card price of one template graph at `prices` (the hosted deployment's charged prices by default). */
export function templateCardPrice(
  nodes: ReadonlyArray<unknown>,
  edges: ReadonlyArray<unknown>,
  prices: ChargedPriceTable = statedPriceTable(),
): TemplateCardPrice {
  // Speech is priced by length where the card is charged (on at the hosted deployment since
  // 2026-10-08, docs/deployment.md): a figure priced at the flat rows would be another price.
  if (!speechLengthPricingEnabled()) throw new Error("a template's card is priced as the hosted deployment charges, with SPEECH_LENGTH_PRICING_ENABLED on")
  return cardPriceOf(CreditsService.estimateWorkflowListingAt(prices, nodes as ReadonlyArray<EstimateNode>, edges as ReadonlyArray<EstimateEdge>, "template"))
}

/**
 * Both figures a doc stores: the doc as authored (its renders at Preview, the
 * card where the preview stop rule is on) and, for a doc that opts into the
 * gate (`withoutPreviewStopRule`), the graph the sync writes where the rule is
 * off (`templateForPreviewStopRule`). The seeder writes whichever the
 * deployment's rule picks, so each is priced on its own graph.
 */
export function templateCardPrices(doc: TutorialTemplateDoc): {
  readonly authored: TemplateCardPrice
  readonly withoutPreviewStopRule?: TemplateCardPrice
} {
  const authored = templateCardPrice(doc.nodes, doc.edges)
  if (!doc.withoutPreviewStopRule) return { authored }
  const off = templateForPreviewStopRule(doc, false)
  return { authored, withoutPreviewStopRule: templateCardPrice(off.nodes, off.edges) }
}
