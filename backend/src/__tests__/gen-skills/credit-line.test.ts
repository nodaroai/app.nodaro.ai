import { describe, it, expect } from "vitest"
import { STATIC_CREDIT_COSTS } from "../../ee/billing/credits.js"
import { NODE_REGISTRY } from "../../lib/node-registry.js"
import { renderCreditCostLine } from "../../../scripts/lib/gen-skills/credit-line.js"
import { renderNodeDataShapeBlock } from "../../../scripts/lib/gen-skills/render-skill.js"
import type { NodeDef } from "../../../scripts/lib/gen-skills/parse-node-definitions.js"

/**
 * The header of every generated skill used to print the FRONTEND
 * `NODE_DEFINITIONS.creditCost` — a hand-typed number nothing at runtime reads,
 * which no reprice ever touched. After the ×10 re-denomination it told every
 * `get_node_skill` caller that add-captions costs 2 and transcribe 3, on ~198
 * files. These tests are the two halves of "that cannot come back": the header
 * ignores any number handed to it with the node definition, and what it DOES
 * print is the backend registry's figure plus the live-price pointer.
 */
describe("renderCreditCostLine", () => {
  it("prints the backend NODE_REGISTRY figure for a node that declares one", () => {
    const declared = NODE_REGISTRY.find((d) => d.creditCost !== undefined)
    expect(declared, "no NODE_REGISTRY entry declares a creditCost").toBeDefined()
    const line = renderCreditCostLine(declared!.type)
    expect(line).toContain(`\`${declared!.creditCost}\``)
    expect(line).toContain("GET /v1/nodes")
  })

  it("falls back to the price table for a node that declares none, like /v1/nodes does", () => {
    const filled = NODE_REGISTRY.find(
      (d) => d.creditCost === undefined && typeof STATIC_CREDIT_COSTS[d.type] === "number",
    )
    expect(filled, "no NODE_REGISTRY entry is priced only by the table").toBeDefined()
    expect(renderCreditCostLine(filled!.type)).toContain(
      `\`${STATIC_CREDIT_COSTS[filled!.type]}\``,
    )
  })

  it("says so plainly for a node nothing prices at all", () => {
    const line = renderCreditCostLine("text-prompt")
    expect(line).toContain("none declared")
    expect(line).not.toContain("GET /v1/nodes")
  })

  it("always names the live-price endpoint, declared figure or not", () => {
    for (const type of ["add-captions", "transcribe", "generate-image", "text-prompt", "no-such-node"]) {
      expect(renderCreditCostLine(type), type).toContain(
        "GET /v1/credits/model-cost?model=<model id>",
      )
    }
  })
})

describe("the skill header can never carry the frontend number again", () => {
  it("ignores a creditCost smuggled onto the node definition", () => {
    // 7331 is a sentinel: if someone re-adds `creditCost` to NodeDef and the
    // renderer starts reading it, this number appears in the output.
    const def = {
      type: "add-captions",
      label: "Add Captions",
      category: "processing",
      creditCost: 7331,
      inputs: ["in"],
      outputs: ["video"],
      defaultData: { label: "Add Captions" },
    } as unknown as NodeDef
    const out = renderNodeDataShapeBlock(def, undefined)
    expect(out).not.toContain("7331")
    expect(out).toContain(renderCreditCostLine("add-captions"))
  })

  it("keys the line off the node TYPE, so two nodes cannot share a price by accident", () => {
    const base: NodeDef = {
      type: "add-captions",
      label: "Add Captions",
      category: "processing",
      inputs: ["in"],
      outputs: ["video"],
      defaultData: {},
      sliders: [],
    }
    const other: NodeDef = { ...base, type: "transcribe" }
    expect(renderNodeDataShapeBlock(base, undefined)).toContain(renderCreditCostLine("add-captions"))
    expect(renderNodeDataShapeBlock(other, undefined)).toContain(renderCreditCostLine("transcribe"))
  })
})
