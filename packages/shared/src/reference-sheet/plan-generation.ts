import { planSheetPanels } from "./panel-plan.js"
import { BOARD_TO_COLUMN, BOARD_TO_ASSET_TYPE } from "./catalog.js"
import { buildPanelPrompt } from "./panel-prompts.js"
import type { EntityKind, SheetSection, SheetFlavour } from "./types.js"

/** A `generate-*-asset` request for one missing panel. */
export interface PanelGenRequest {
  assetType: string        // e.g. "headAngles" | "expressions" | "custom"
  variant: string          // preset variant or custom label (also the attachName)
  attachToColumn: string   // DB column (snake_case) the worker appends to
  attachName: string       // == variant
  userPrompt?: string      // present for custom assetType / custom entries
}

export interface SheetGenerationPlan {
  presentUrls: string[]
  missing: PanelGenRequest[]
}

/** Find the bucket item whose `name` equals `variant` and which carries a
 *  non-empty `url` (single source of truth — the same predicate the still + motion
 *  panel resolvers use to locate a planned panel in an entity's buckets). */
export function matchVariant(
  items: ReadonlyArray<{ name?: string; url?: string }>,
  variant: string,
): { name?: string; url?: string } | undefined {
  return items.find((it) => it?.name === variant && typeof it?.url === "string" && it.url.length > 0)
}

/** Pure: given the entity's current buckets (keyed by DB column), split the
 *  planned panels into already-present URLs and the generate-requests needed for
 *  the rest. The surface fires each request, awaits, then calls the compose API. */
export function planSheetGeneration(
  entityKind: EntityKind,
  sections: readonly SheetSection[],
  flavour: SheetFlavour,
  bucketsByColumn: Record<string, ReadonlyArray<{ name?: string; url?: string }> | undefined>,
  name: string,
): SheetGenerationPlan {
  const plan = planSheetPanels(entityKind, sections, flavour)
  const presentUrls: string[] = []
  const missing: PanelGenRequest[] = []
  for (const p of plan) {
    const column = BOARD_TO_COLUMN[entityKind][p.board]
    const items = (column ? bucketsByColumn[column] : undefined) ?? []
    const match = matchVariant(items, p.variant)
    if (match?.url) {
      presentUrls.push(match.url)
      continue
    }
    const assetType = BOARD_TO_ASSET_TYPE[entityKind][p.board] ?? "custom"
    const userPrompt =
      p.custom ? p.prompt :
      assetType === "custom" ? buildPanelPrompt(entityKind, p.board, p.variant, name) :
      undefined
    missing.push({ assetType, variant: p.variant, attachToColumn: column, attachName: p.variant, userPrompt })
  }
  return { presentUrls, missing }
}
