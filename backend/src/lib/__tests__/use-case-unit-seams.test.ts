// @test-units-by-name composes the in-memory fixture use-case unit it declares beside the real units (both aggregates mocked)
import { describe, expect, it, vi } from "vitest"
import { z } from "zod"
import type { UnitDescriptor, UnitUseCase } from "../../nodes/kit.js"

/**
 * The server seams a use-case node unit reaches, on an in-memory fixture unit
 * in the registry and use-cases aggregates: its body joins USE_CASE_BODIES,
 * GET /v1/nodes serves it with the use-case band and its use-case.ts input
 * schema (in the legacy entries' key order), its first output being text makes
 * it a text source, and its capability makes it Nodaro-exclusive.
 */
const FIXTURE: UnitDescriptor = {
  type: "fixture-case",
  label: "Fixture Case",
  category: "processing",
  description: "Run the fixture chain over a recording.",
  outputType: "text",
  position: { after: "apply-edl" },
  inputs: ["media"],
  outputs: ["text", "json"],
  handles: {
    inputs: [{ id: "media", label: "Recording", accepts: ["video", "audio"] }],
    outputs: [
      { id: "text", label: "Text", kind: "text" },
      { id: "json", label: "Plan", kind: "look" },
    ],
  },
  execution: { kind: "use-case", builder: "fixture" },
  capabilities: ["edition:nodaro-exclusive"],
}
const USE_CASE: UnitUseCase = {
  body: z.object({ mediaUrls: z.array(z.string()).min(1).max(1), depth: z.number().optional() }),
  inputSchema: { fields: [{ key: "depth", type: "number" }] },
}

// The real units stay (a real use-case unit's type is in USE_CASE_NODE_TYPES, so its body must be found).
vi.mock("../../nodes/_generated/registry.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../nodes/_generated/registry.js")>()
  return { UNIT_REGISTRY: Object.assign(Object.create(null), real.UNIT_REGISTRY, { "fixture-case": FIXTURE }) }
})
vi.mock("../../nodes/_generated/use-cases.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../nodes/_generated/use-cases.js")>()
  return { UNIT_USE_CASES: Object.assign(Object.create(null), real.UNIT_USE_CASES, { "fixture-case": USE_CASE }) }
})

describe("a use-case node unit on the server seams", () => {
  it("its body joins USE_CASE_BODIES beside the real units' ones", async () => {
    const { USE_CASE_BODIES, usecaseInputSchemaOf } = await import("../use-case/bodies.js")
    expect((USE_CASE_BODIES as Record<string, unknown>)["fixture-case"]).toBe(USE_CASE.body)
    expect(USE_CASE_BODIES["tighten-episode"]).toBeDefined()
    expect(usecaseInputSchemaOf("fixture-case")).toBe(USE_CASE.inputSchema)
    // Not a use-case node: no use-case input schema.
    expect(usecaseInputSchemaOf("apply-edl")).toBeUndefined()
  })

  it("GET /v1/nodes: the use-case band and its own input schema, keys in the legacy entries' order, after its position.after", async () => {
    const { NODE_REGISTRY } = await import("../node-registry.js")
    const i = NODE_REGISTRY.findIndex((d) => d.type === "fixture-case")
    expect(NODE_REGISTRY[i - 1]?.type).toBe("apply-edl")
    const entry = NODE_REGISTRY[i]!
    expect(Object.keys(entry)).toEqual(["type", "label", "category", "description", "outputType", "creditCost", "inputSchema"])
    expect(entry).toMatchObject({ creditCost: "per-minute", inputSchema: USE_CASE.inputSchema })
    // A hand-registered per-minute entry with its own input schema (Apply EDL) — the key order every entry keeps.
    const legacy = NODE_REGISTRY.find((d) => d.type === "apply-edl")!
    expect(Object.keys(legacy).slice(0, 7)).toEqual(Object.keys(entry))
  })

  it("a unit whose first output is text is a text source", async () => {
    const { TEXT_SOURCE_NODE_TYPES } = await import("../../services/workflow-engine/input-resolver.js")
    expect(TEXT_SOURCE_NODE_TYPES.has("fixture-case")).toBe(true)
  })

  it("the edition:nodaro-exclusive capability joins NODARO_EXCLUSIVE_NODE_TYPES", async () => {
    const { NODARO_EXCLUSIVE_NODE_TYPES } = await import("../cloud-only-nodes.js")
    expect(NODARO_EXCLUSIVE_NODE_TYPES.has("fixture-case")).toBe(true)
    expect(NODARO_EXCLUSIVE_NODE_TYPES.has("tighten-episode")).toBe(true)
  })
})
