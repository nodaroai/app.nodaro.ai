import { layerSplitHoldCreditId } from "@nodaro/render-rules"
import type { UnitCreditId } from "../kit"
import { definition } from "./definition.generated"

// The row a run holds, named from the node's settings — the same rule as the
// backend price.ee.ts creditId (@nodaro/render-rules layer-split.ts): its size's
// tier, at the most images it may return (Max layers plus the base).
export const creditId: UnitCreditId = (data) => layerSplitHoldCreditId(definition.type, data)
