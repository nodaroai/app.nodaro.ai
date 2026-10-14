// @test-watches backend/skills/nodes/*.md
import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { STATIC_CREDIT_COSTS } from "../../ee/billing/credits.js"
import { statedPrices } from "../../ee/billing/stated-prices.js"
import { NODE_REGISTRY, chargedDescriptor } from "../../lib/node-registry.js"
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
 * print is the backend registry's figure, CHARGED (the price a run costs on
 * Nodaro Cloud, priced like `GET /v1/nodes` prices it), plus the live-price
 * pointer.
 */
describe("renderCreditCostLine", () => {
  it("prints the backend NODE_REGISTRY figure, charged, for a node that declares one", () => {
    const declared = NODE_REGISTRY.find((d) => typeof d.creditCost === "string" && /^\d+-\d+$/.test(d.creditCost))
    expect(declared, "no NODE_REGISTRY entry declares a credit band").toBeDefined()
    const charged = chargedDescriptor(declared!, statedPrices()).creditCost
    expect(charged, "a band is charged end by end, never quoted at its rows").not.toBe(declared!.creditCost)
    const line = renderCreditCostLine(declared!.type)
    expect(line).toContain(`\`${charged}\` charged`)
    expect(line).not.toContain("list price")
    expect(line).toContain("GET /v1/nodes")
  })

  it("falls back to the price table for a node that declares none, like /v1/nodes does", () => {
    const filled = NODE_REGISTRY.find(
      (d) => d.creditCost === undefined && typeof STATIC_CREDIT_COSTS[d.type] === "number",
    )
    expect(filled, "no NODE_REGISTRY entry is priced only by the table").toBeDefined()
    const charged = statedPrices().credits(filled!.type)
    expect(charged).toBeGreaterThan(STATIC_CREDIT_COSTS[filled!.type] as number)
    expect(renderCreditCostLine(filled!.type)).toContain(`\`${charged}\``)
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

describe("every checked-in node skill states the price line its generator would print", () => {
  // `gen:skills:check` regenerates and diffs in its own CI job; this is the same
  // guarantee for the price line inside Backend Tests, so a skill that quotes a
  // stale figure (Forced Alignment's 3 against a charged 30, #1590) fails here too.
  const dir = join(__dirname, "..", "..", "..", "skills", "nodes")
  // `ai-writer` is a deprecated type with no node definition: the generator no
  // longer writes its skill, which is kept frozen for get_node_skill callers.
  const NOT_GENERATED = new Set(["ai-writer.md"])
  const files = readdirSync(dir).filter((f) => f.endsWith(".md") && !NOT_GENERATED.has(f))

  it("finds the generated skills", () => {
    expect(files.length).toBeGreaterThan(100)
  })

  it("each file's **Credit cost:** line is renderCreditCostLine(its node type)", () => {
    const stale: string[] = []
    for (const file of files) {
      const text = readFileSync(join(dir, file), "utf8")
      const type = /^node_type:\s*(\S+)/m.exec(text)?.[1]
      const line = text.split("\n").find((l) => l.startsWith("**Credit cost:**"))
      if (!type || !line) continue
      if (line !== renderCreditCostLine(type)) stale.push(`${file}: ${line}`)
    }
    expect(stale, "regenerate with `npm run gen:skills`").toEqual([])
  })
})

