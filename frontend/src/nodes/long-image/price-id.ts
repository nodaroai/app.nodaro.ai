import { longImageDataCreditId, longImageWiredCreditId } from "@nodaro/render-rules"
import type { UnitCreditId } from "../kit"
import { definition } from "./definition.generated"

// The row a run of the node is charged, by the same rule as the backend
// price.ee.ts creditId (@nodaro/render-rules long-image.ts): with the canvas's
// wires, each wired picture input of the mode counts as one picture (the Run
// button, the config panel, the editor's run estimate — and the server's run
// estimate, handed the same wired inputs); with the node's data alone, the most
// its mode can send, never below the run.
export const creditId: UnitCreditId = (data, wiredInputs) =>
  wiredInputs ? longImageWiredCreditId(definition.type, data, wiredInputs) : longImageDataCreditId(definition.type, data)
