import { planSheetGeneration, type PanelGenRequest } from "./plan-generation.js"
import type { EntityKind, SheetSection, SheetFlavour } from "./types.js"

export interface SheetCostEstimate {
  present: number
  missing: PanelGenRequest[]
  prepareCost: number
  assemblyCost: number
  total: number
  /** True when the plan exceeds MAX_PANELS_PER_SHEET (planSheetPanels throws). */
  overflow: boolean
}

/**
 * Pure cost estimate for a sheet plan. Wraps `planSheetGeneration` so a
 * MAX_PANELS overflow (which throws in the planner) becomes `overflow:true`
 * instead of crashing the caller's render. `perPanelCost`/`assemblyCost` are
 * injected by the UI (constants from the adapter) so the shared layer stays
 * pricing-agnostic.
 */
export function estimateSheetCost(
  entityKind: EntityKind,
  sections: readonly SheetSection[],
  flavour: SheetFlavour,
  buckets: Record<string, ReadonlyArray<{ name?: string; url?: string }> | undefined>,
  name: string,
  perPanelCost: number,
  assemblyCost: number,
): SheetCostEstimate {
  try {
    const { presentUrls, missing } = planSheetGeneration(entityKind, sections, flavour, buckets, name)
    const prepareCost = missing.length * perPanelCost
    return { present: presentUrls.length, missing, prepareCost, assemblyCost, total: prepareCost + assemblyCost, overflow: false }
  } catch {
    return { present: 0, missing: [], prepareCost: 0, assemblyCost, total: assemblyCost, overflow: true }
  }
}
