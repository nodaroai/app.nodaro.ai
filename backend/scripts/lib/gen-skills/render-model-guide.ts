/**
 * Renders the AUTO-GEN block bodies for `docs/choosing-models.md` from the
 * `MODEL_CATALOG` + `MODEL_RECOMMENDATIONS` single source of truth in
 * `@nodaro/shared`. Pure functions; marker substitution is handled by
 * marker-blocks.ts and the wiring in gen-skills.ts.
 *
 * The catalog is authoritative — never hand-maintain model lists in the doc.
 * Edit `packages/shared/src/model-catalog.ts`, then `npm run gen:skills`.
 */
import type { ModelCatalogEntry, ModelKind, ModelRecommendation } from "@nodaro/shared/model-catalog"

export type CostTier = "Everyday" | "Standard" | "Premium"

/** Where one kind's models split into tiers, in credits. */
export interface CostTierCuts {
  /** At or below: Everyday. */
  everydayMax: number
  /** At or above (and above `everydayMax`): Premium. */
  premiumMin: number
}

/**
 * The cut points that split one kind's models into thirds by default price.
 *
 * RELATIVE on purpose, as the guide defines the tier ("relative within each
 * modality"). Fixed credit thresholds stayed on the pre-×10 credit scale after
 * the 2026-07-30 re-denomination and labelled 120 of 128 models Premium. Thirds
 * of the kind's own prices are scale-free, so a re-denomination cannot move a
 * tier. Equal prices always share a tier.
 */
export function costTierCuts(credits: readonly number[]): CostTierCuts {
  const sorted = [...credits].sort((a, b) => a - b)
  if (sorted.length === 0) return { everydayMax: 0, premiumMin: 0 }
  const last = sorted.length - 1
  const median = sorted[Math.floor(last / 2)]!
  const rankCut = sorted[Math.ceil((2 * last) / 3)]!
  return {
    everydayMax: sorted[Math.floor(last / 3)]!,
    // Premium always starts above the median price: a block of equal prices that holds the
    // median and the two-thirds rank would otherwise put most of the kind in Premium (equal
    // prices share a tier) — audio's many 30-credit models once cheaper speech models joined
    // (decided 2026-11-12). Where the rank cut is already above the median, it is the cut.
    premiumMin: rankCut > median ? rankCut : (sorted.find((c) => c > median) ?? rankCut),
  }
}

/** A model's tier: its default-variant credits against its kind's cut points. */
export function costTier(credits: number, cuts: CostTierCuts): CostTier {
  if (credits <= cuts.everydayMax) return "Everyday"
  if (credits >= cuts.premiumMin) return "Premium"
  return "Standard"
}

function escapeCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ")
}

/**
 * The Tier cell of a model that takes no part in the ranking (below): a dash,
 * never a figure, so it cannot read as a price.
 */
export const UNRANKED_TIER = "—"

/**
 * Does `e` take part in its kind's tier ranking? A model offered under the
 * deployment's own label (`ownLabel`) does not (decided 2026-11-11): it is
 * shown with {@link UNRANKED_TIER} and its price is left out of the cut
 * points, so adding one never moves another model's tier.
 */
export function isTierRanked(e: Pick<ModelCatalogEntry, "ownLabel">): boolean {
  return e.ownLabel !== true
}

/** The price a run is charged for `credits` of the price row `identifier`. */
export type ChargedCreditsOf = (identifier: string, credits: number) => number

const asListed: ChargedCreditsOf = (_identifier, credits) => credits

/**
 * Where a house model (a catalog entry offered under the deployment's own
 * label, `ownLabel`) is available, said from the catalog alone — this text is
 * generated without a plugin, so it never reads what an install serves
 * (docs/design/house-models.md).
 */
export const OWN_LABEL_AVAILABILITY = "Offered on Nodaro Cloud; a self-hosted install lists it only where its deployment serves it."

/** A catalog entry's "best for" cell: its description, and for a house model where it is offered. */
export function modelGuideDescription(e: Pick<ModelCatalogEntry, "description" | "ownLabel">): string {
  return e.ownLabel === true ? `${e.description} ${OWN_LABEL_AVAILABILITY}` : e.description
}

/**
 * One markdown table of every catalog entry of `kind`, excluding `mcpHidden`
 * (superseded) and `docsHidden` (withheld) models. Sorted cheapest-first so the everyday picks read at the
 * top; featured ("best in tier") models are flagged with ⭐.
 */
export function renderModelTable(
  catalog: Record<string, ModelCatalogEntry>,
  kind: ModelKind,
  chargedOf: ChargedCreditsOf = asListed,
): string {
  /** The default variant's charged price, and the price id it is charged from. */
  const priced = (e: ModelCatalogEntry) => {
    const row = e.pricing[0]
    return row ? { credits: chargedOf(row.identifier, row.credits), identifier: row.identifier } : { credits: 0, identifier: null }
  }
  const rows = Object.values(catalog)
    .filter((e) => e.kind === kind && !e.mcpHidden && !e.docsHidden && e.pickerHidden !== true)
    .map((e) => ({ e, ...priced(e) }))
    .sort((a, b) => {
      if (a.credits !== b.credits) return a.credits - b.credits
      return a.e.label.localeCompare(b.e.label)
    })

  const cuts = costTierCuts(rows.filter((r) => isTierRanked(r.e)).map((r) => r.credits))
  const lines: string[] = []
  lines.push("| Model | Family | Tier | Credits | Modes | Best for |")
  lines.push("| --- | --- | --- | --- | --- | --- |")
  for (const { e, credits, identifier } of rows) {
    const name = e.featured ? `⭐ ${e.label}` : e.label
    const modes = e.modes.join(", ")
    // The price id rides along invisibly, so docs-charged-prices.test.ts holds the figure to it.
    const price = identifier ? `${credits}<!-- credits: ${identifier} -->` : `${credits}`
    const tier = isTierRanked(e) ? costTier(credits, cuts) : UNRANKED_TIER
    lines.push(
      `| ${escapeCell(name)} | ${escapeCell(e.family)} | ${tier} | ${price} | ${escapeCell(modes)} | ${escapeCell(modelGuideDescription(e))} |`,
    )
  }
  return lines.join("\n")
}

/**
 * The specialist use-case → model table, rendered from
 * `MODEL_RECOMMENDATIONS`. Model ids are resolved to display labels via the
 * catalog, falling back to the raw id when an id is not catalogued.
 */
export function renderRecommendations(
  recommendations: readonly ModelRecommendation[],
  catalog: Record<string, ModelCatalogEntry>,
): string {
  const lines: string[] = []
  lines.push("| I want… | Models | Notes |")
  lines.push("| --- | --- | --- |")
  for (const rec of recommendations) {
    const models = rec.modelIds
      .map((id) => catalog[id]?.label ?? id)
      .join(", ")
    lines.push(
      `| ${escapeCell(rec.intent)} | ${escapeCell(models)} | ${escapeCell(
        rec.note,
      )} |`,
    )
  }
  return lines.join("\n")
}
