/**
 * Renders the AUTO-GEN block bodies for `docs/choosing-models.md` from the
 * `MODEL_CATALOG` + `MODEL_RECOMMENDATIONS` single source of truth in
 * `@nodaro/shared`. Pure functions; marker substitution is handled by
 * marker-blocks.ts and the wiring in gen-skills.ts.
 *
 * The catalog is authoritative — never hand-maintain model lists in the doc.
 * Edit `packages/shared/src/model-catalog.ts`, then `npm run gen:skills`.
 */
import type { ModelCatalogEntry, ModelKind, ModelRecommendation } from "@nodaro/shared"

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
  return {
    everydayMax: sorted[Math.floor(last / 3)]!,
    premiumMin: sorted[Math.ceil((2 * last) / 3)]!,
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

function defaultCredits(entry: ModelCatalogEntry): number {
  return entry.pricing[0]?.credits ?? 0
}

/**
 * One markdown table of every catalog entry of `kind`, excluding `mcpHidden`
 * (superseded) models. Sorted cheapest-first so the everyday picks read at the
 * top; featured ("best in tier") models are flagged with ⭐.
 */
export function renderModelTable(
  catalog: Record<string, ModelCatalogEntry>,
  kind: ModelKind,
): string {
  const rows = Object.values(catalog)
    .filter((e) => e.kind === kind && !e.mcpHidden)
    .sort((a, b) => {
      const ca = defaultCredits(a)
      const cb = defaultCredits(b)
      if (ca !== cb) return ca - cb
      return a.label.localeCompare(b.label)
    })

  const cuts = costTierCuts(rows.map(defaultCredits))
  const lines: string[] = []
  lines.push("| Model | Family | Tier | Credits | Modes | Best for |")
  lines.push("| --- | --- | --- | --- | --- | --- |")
  for (const e of rows) {
    const credits = defaultCredits(e)
    const name = e.featured ? `⭐ ${e.label}` : e.label
    const modes = e.modes.join(", ")
    lines.push(
      `| ${escapeCell(name)} | ${escapeCell(e.family)} | ${costTier(credits, cuts)} | ${credits} | ${escapeCell(modes)} | ${escapeCell(e.description)} |`,
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
