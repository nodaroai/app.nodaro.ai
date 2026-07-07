import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { BLUEPRINT_IDS } from "../../../../services/shot-sequence/blueprint-params.js"

const doc = readFileSync(resolve(__dirname, "../../../../../../docs/mcp/shot-sequence.md"), "utf-8")

describe("docs/mcp/shot-sequence.md blueprint catalog", () => {
  it("documents every blueprint id (drift guard vs BLUEPRINT_IDS)", () => {
    for (const id of BLUEPRINT_IDS) {
      expect(doc, `docs/mcp/shot-sequence.md is missing a table row for "${id}"`).toContain(`\`${id}\``)
    }
  })
})
