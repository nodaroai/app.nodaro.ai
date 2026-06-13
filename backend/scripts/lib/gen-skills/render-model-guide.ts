/**
 * Renders the AUTO-GEN block bodies for `docs/choosing-models.md` from the
 * `MODEL_CATALOG` + `MODEL_RECOMMENDATIONS` single source of truth in
 * `@nodaro/shared`. Pure functions; marker substitution is handled by
 * marker-blocks.ts and the wiring in gen-skills.ts.
 *
 * The catalog is authoritative — never hand-maintain model lists in the doc.
 * Edit `packages/shared/src/model-catalog.ts`, then `npm run gen:skills`.
 */
import type {
  ModelCatalogEntry,
  ModelKind,
  ModelRecommendation,
} from "@nodaro/shared"

export type CostTier = "Everyday" | "Standard" | "Premium"

/**
 * Coarse, kind-aware price bucket for the "everyday vs advanced" framing.
 * Video credits live on a much higher scale than image/audio, so thresholds
 * differ per kind. Derived from `pricing[0].credits` (the default variant).
 */
export function costTier(kind: ModelKind, credits: number): CostTier {
  if (kind === "video") {
    if (credits <= 15) return "Everyday"
    if (credits >= 50) return "Premium"
    return "Standard"
  }
  if (kind === "audio") {
    if (credits <= 3) return "Everyday"
    if (credits >= 8) return "Premium"
    return "Standard"
  }
  // image
  if (credits <= 2) return "Everyday"
  if (credits >= 5) return "Premium"
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

  const lines: string[] = []
  lines.push("| Model | Family | Tier | Credits | Modes | Best for |")
  lines.push("| --- | --- | --- | --- | --- | --- |")
  for (const e of rows) {
    const credits = defaultCredits(e)
    const name = e.featured ? `⭐ ${e.label}` : e.label
    const modes = e.modes.join(", ")
    lines.push(
      `| ${escapeCell(name)} | ${escapeCell(e.family)} | ${costTier(
        e.kind,
        credits,
      )} | ${credits} | ${escapeCell(modes)} | ${escapeCell(e.description)} |`,
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
