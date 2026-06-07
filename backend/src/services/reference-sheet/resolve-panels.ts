import { planSheetPanels, BOARD_TO_COLUMN, matchVariant } from "@nodaro/shared"
import type { EntityKind, SheetSection, SheetFlavour, PanelRequest } from "@nodaro/shared"

export type EntityBuckets = Record<string, ReadonlyArray<{ name?: string; url?: string }> | undefined>
export interface ResolvedPanelRef { section: string; board: string; variant: string; label: string; url: string }
export interface PanelResolution { present: ResolvedPanelRef[]; missing: PanelRequest[] }

/** Plan panels for `sections`, then locate each in the entity buckets by
 *  `name === variant`. Pure. */
export function resolvePanels(
  entityKind: EntityKind, sections: readonly SheetSection[], flavour: SheetFlavour, buckets: EntityBuckets,
): PanelResolution {
  const plan = planSheetPanels(entityKind, sections, flavour)
  const present: ResolvedPanelRef[] = []
  const missing: PanelRequest[] = []
  for (const p of plan) {
    const column = BOARD_TO_COLUMN[entityKind][p.board]
    const items = (column ? buckets[column] : undefined) ?? []
    const match = matchVariant(items, p.variant)
    if (match?.url) present.push({ section: p.section, board: p.board, variant: p.variant, label: p.label, url: match.url })
    else missing.push(p)
  }
  return { present, missing }
}
