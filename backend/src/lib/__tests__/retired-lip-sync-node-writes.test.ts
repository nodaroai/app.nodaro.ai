/**
 * A Lip Sync node written into a workflow (MCP `create_workflow` /
 * `update_workflow_json` / `import_workflow`, Copilot edits, templates) that
 * names a model retired from Lip Sync (decided 2026-11-12) is stored as it was
 * written: the write boundary's passes never move it to another model — the
 * new-node model rule judges only a lever whose model the node does not name,
 * and the parameter healing does not read a Lip Sync provider. Its run is then
 * refused with the retirement's sentence (payload-builder-retired-lip-sync.test.ts).
 */
import { describe, it, expect } from "vitest"
import { nodeModelLevers, planNodeModels } from "@nodaro/render-rules"
import { normalizeNodeModelParams } from "@nodaro/shared/nodes"
import { RETIRED_LIP_SYNC_PROVIDERS } from "@nodaro/shared/models"

describe("a written Lip Sync node on a retired model is stored as written", () => {
  /** A deployment that withholds every model: the strictest the new-node rule can be. */
  const withholdsEverything = { restricted: true, withheld: () => true }

  for (const provider of Object.keys(RETIRED_LIP_SYNC_PROVIDERS)) {
    it(`${provider}: the new-node model rule keeps the model the node names`, () => {
      const data = { label: "Lip Sync", provider, pads: "0 10 0 0" }
      const plan = planNodeModels(nodeModelLevers("lip-sync"), data, withholdsEverything, { onlyUnnamed: true })
      expect(plan.moved).toEqual([])
      expect(plan.data).toEqual(data)
    })

    it(`${provider}: the write boundary's parameter healing leaves the node as it is`, () => {
      const node = { id: "lip-sync-1", type: "lip-sync", data: { label: "Lip Sync", provider, resolution: "720p" } }
      const healed = normalizeNodeModelParams([node])
      expect(healed.nodes).toEqual([node])
      expect(healed.adjustments).toEqual([])
    })
  }
})
