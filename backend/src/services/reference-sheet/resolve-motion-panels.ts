import { planSheetPanels, matchVariant } from "@nodaro/shared"
import type { EntityKind, SheetSection, SheetFlavour, PanelRequest } from "@nodaro/shared"

export interface ResolvedMotionPanel {
  section: string
  variant: string
  label: string
  url: string
}
export interface MotionPanelResolution {
  present: ResolvedMotionPanel[]
  missing: PanelRequest[]
}

/** Resolve a sheet's planned panels against the entity's FLAT motion bucket by
 *  name===variant (motion clips aren't per-board — they all live in one column,
 *  see MOTION_COLUMN). Pure. The `present` order matches planSheetPanels order,
 *  so the Nth present clip lines up with the Nth slot from `sheetSlots`. */
export function resolveMotionPanels(
  entityKind: EntityKind,
  sections: readonly SheetSection[],
  flavour: SheetFlavour,
  motionBucket: ReadonlyArray<{ name?: string; url?: string }>,
): MotionPanelResolution {
  const plan = planSheetPanels(entityKind, sections, flavour)
  const present: ResolvedMotionPanel[] = []
  const missing: PanelRequest[] = []
  for (const p of plan) {
    const match = matchVariant(motionBucket, p.variant)
    if (match?.url) present.push({ section: p.section, variant: p.variant, label: p.label, url: match.url })
    else missing.push(p)
  }
  return { present, missing }
}
