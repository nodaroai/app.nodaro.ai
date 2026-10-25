// Admin → Nodaro Motion's form model (pure): the per-engine draft as it is saved.

import type { AdminTrendFaceMasking, NodaroMotionEngine, NodaroMotionMasking } from "@/lib/api"
import { cleanMasking } from "../trends/model"

/** The setting as it is saved: each engine's cleaned setting; an engine left Off with nothing else set is left out. */
export function toSaved(draft: NodaroMotionMasking): NodaroMotionMasking {
  const out: NodaroMotionMasking = {}
  for (const [id, m] of Object.entries(draft) as Array<[NodaroMotionEngine, AdminTrendFaceMasking | undefined]>) {
    if (m) out[id] = cleanMasking(m)
  }
  return out
}
