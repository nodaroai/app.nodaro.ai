import { describe, expect, it } from "vitest"
import { NODE_REGISTRY } from "../node-registry.js"
import { STATIC_CREDIT_COSTS } from "../../ee/billing/credits.js"
import { EDIT_PLAN_MODES } from "@nodaro/shared/edl"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { UGC_NODE_TYPES } from "@nodaro/shared/ugc"
import { VIDEO_ANALYSIS_BUCKET_CREDITS, VIDEO_AUDIT_BUCKET_CREDITS } from "@nodaro/shared/credits"

describe("NODE_REGISTRY: reduce", () => {
  it("has a 'reduce' entry with label, category=control, outputType=text", () => {
    const entry = NODE_REGISTRY.find((n) => n.type === "reduce")
    expect(entry).toBeDefined()
    // Display name is "Choose Best" (intent vocabulary); the type id stays reduce.
    expect(entry!.label).toBe("Choose Best")
    // Fan-in collapses N values into one — closest existing NodeCategory is
    // "control" (alongside list/loop/combine-text/split-text). The plan
    // suggested category "workflow" but no such category exists in the
    // NodeCategory union; "control" is the correct adapted value.
    expect(entry!.category).toBe("control")
    expect(entry!.outputType).toBe("text")
  })

  it("exposes strategyId as a required enum-style input with all 6 strategies", () => {
    const entry = NODE_REGISTRY.find((n) => n.type === "reduce")
    expect(entry).toBeDefined()
    const strategyField = entry!.inputSchema?.fields.find((f) => f.key === "strategyId")
    expect(strategyField).toBeDefined()
    expect(strategyField!.required).toBe(true)
    expect(strategyField!.options).toEqual([
      "pick-best-llm",
      "concat",
      "first-non-empty",
      "count",
      "vote",
      "merge-json",
    ])
  })

  it("declares a dynamic per-strategy credit cost", () => {
    const entry = NODE_REGISTRY.find((n) => n.type === "reduce")
    // The band spans the `reduce:<strategyId>` family: concat /
    // first-non-empty / count / vote / merge-json are 0cr, and pick-best-llm
    // tiers by its judge model. Derived from the price table here for the same
    // reason the descriptor derives it — the literal "0-3" this line used to
    // pin survived the ×10 re-denomination AND the judge-tier composites, so it
    // was wrong twice over while the test stayed green.
    const strategyPrices = Object.entries(STATIC_CREDIT_COSTS)
      .filter(([id]) => id.startsWith("reduce:"))
      .map(([, credits]) => credits)
    expect(strategyPrices.length).toBeGreaterThan(0)
    expect(entry!.creditCost).toBe(
      `${Math.min(...strategyPrices)}-${Math.max(...strategyPrices)}`,
    )
  })
})

describe("NODE_REGISTRY: video-audit", () => {
  it("has a 'video-audit' entry mirroring video-analysis's category/outputType shape", () => {
    const entry = NODE_REGISTRY.find((n) => n.type === "video-audit")
    expect(entry).toBeDefined()
    expect(entry!.label).toBe("AI Audit")
    // Mirrors video-analysis's own category/outputType — both are "processing"
    // nodes whose output is a JSON report on the data channel, not an
    // image/video/audio result.
    const videoAnalysisEntry = NODE_REGISTRY.find((n) => n.type === "video-analysis")
    expect(videoAnalysisEntry).toBeDefined()
    expect(entry!.category).toBe(videoAnalysisEntry!.category)
    expect(entry!.outputType).toBe("data")
  })

  it("requires videoUrl and exposes an optional analysis passthrough field", () => {
    const entry = NODE_REGISTRY.find((n) => n.type === "video-audit")
    const videoUrlField = entry!.inputSchema?.fields.find((f) => f.key === "videoUrl")
    expect(videoUrlField).toBeDefined()
    expect(videoUrlField!.required).toBe(true)
    const analysisField = entry!.inputSchema?.fields.find((f) => f.key === "analysis")
    expect(analysisField).toBeDefined()
    expect(analysisField!.required).toBeFalsy()
  })

  it("declares a creditCost range spanning the full VIDEO_ANALYSIS_BUCKET_CREDITS table", () => {
    const entry = NODE_REGISTRY.find((n) => n.type === "video-analysis")
    // Same discipline as the audit node below: the cheapest bucket (legacy fast
    // tier, 60s) to the priciest (smart, 600s ceiling), derived from the shared
    // table so a regeneration cannot leave this literal behind — it did once
    // (the 9_082 → 9_434 round moved the ceiling 2076 → 2081 unnoticed).
    const values = Object.values(VIDEO_ANALYSIS_BUCKET_CREDITS)
    expect(entry!.creditCost).toBe(`${Math.min(...values)}-${Math.max(...values)}`)
  })

  it("declares a creditCost range spanning the full VIDEO_AUDIT_BUCKET_CREDITS table", () => {
    const entry = NODE_REGISTRY.find((n) => n.type === "video-audit")
    // Range bounds match the shared bucket table exactly: the cheapest bucket
    // (analysis provided, 60s) to the priciest (auto family, 600s ceiling) —
    // see packages/shared/src/video-analysis-pricing.ts. Derived from the
    // table rather than hand-pasted so a reprice can't silently drift this test.
    const values = Object.values(VIDEO_AUDIT_BUCKET_CREDITS)
    expect(entry!.creditCost).toBe(`${Math.min(...values)}-${Math.max(...values)}`)
  })
})

describe("NODE_REGISTRY: creature entity", () => {
  // Mirrors the sibling entity descriptors (character / object / location):
  // category "entity", outputType "data" (OutputType has no entity-ref member;
  // the entity reference rides through the `data` channel like the other
  // entity nodes).
  it("has a 'creature' entry mirroring the object/character entity shape", () => {
    const entry = NODE_REGISTRY.find((n) => n.type === "creature")
    expect(entry).toBeDefined()
    expect(entry!.label).toBe("Animal/Creature")
    expect(entry!.category).toBe("entity")
    expect(entry!.outputType).toBe("data")
  })
})

describe("NODE_REGISTRY: edit-plan", () => {
  // Discovery is a contract: the SDK's nodes.run() sends the field names it
  // reads here, so a listed field the route refuses is a guaranteed 422.
  it("lists the required sources and not the raw offsets the route refuses", () => {
    const fields = NODE_REGISTRY.find((n) => n.type === "edit-plan")?.inputSchema?.fields ?? []
    expect(fields.find((f) => f.key === "sources")).toMatchObject({ type: "array", required: true })
    expect(fields.find((f) => f.key === "offsets")).toBeUndefined()
  })

  // GET /v1/nodes serves the description verbatim. The mode options derive from
  // EDIT_PLAN_MODES, so the prose must name every mode they offer or an agent
  // reading discovery never learns a mode exists.
  it("describes every mode its mode field offers", () => {
    const description = NODE_REGISTRY.find((n) => n.type === "edit-plan")?.description.toLowerCase() ?? ""
    for (const mode of EDIT_PLAN_MODES) expect(description).toContain(mode)
  })
})

describe("NODE_REGISTRY: the UGC video nodes", () => {
  // Discovery for the UGC chain (Nodaro Cloud only; GET /v1/nodes hides them
  // elsewhere through CLOUD_ONLY_NODE_TYPES). Each price is the node's own row:
  // UGC Script's band is derived from it, the free nodes state its 0, and UGC
  // Clip states in words that it is priced per clip.
  const EXPECTED = {
    "ugc-creator": { label: "UGC Creator", outputType: "image", creditCost: 0 },
    "ugc-script": { label: "UGC Script", outputType: "data", creditCost: 20 },
    "ugc-clips": { label: "UGC Clips", outputType: "data", creditCost: 0 },
    "ugc-clip": { label: "UGC Clip", outputType: "video", creditCost: "per-clip" },
    "ugc-cards": { label: "UGC Cards", outputType: "data", creditCost: 0 },
    "ugc-finish-clips": { label: "UGC Finish", outputType: "video", creditCost: 0 },
  } as const

  it("lists exactly the shared UGC node set, once each", () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...UGC_NODE_TYPES].sort())
    for (const type of UGC_NODE_TYPES) expect(NODE_REGISTRY.filter((n) => n.type === type), type).toHaveLength(1)
  })

  it.each(Object.entries(EXPECTED))("%s: label, AI video, output and price", (type, want) => {
    const entry = NODE_REGISTRY.find((n) => n.type === type)!
    expect(entry).toMatchObject({ type, label: want.label, category: "ai-video", outputType: want.outputType, creditCost: want.creditCost })
    expect(entry.description.length).toBeGreaterThan(0)
  })

  it("UGC Script's figure is its own price row; the free nodes' 0 is theirs", () => {
    expect(NODE_REGISTRY.find((n) => n.type === "ugc-script")!.creditCost).toBe(STATIC_CREDIT_COSTS["ugc-script"])
    for (const type of ["ugc-creator", "ugc-clips", "ugc-cards"]) {
      expect(NODE_REGISTRY.find((n) => n.type === type)!.creditCost, type).toBe(STATIC_CREDIT_COSTS[type])
    }
  })

  it("UGC Creator says that in the editor it draws options for you to pick from", () => {
    expect(NODE_REGISTRY.find((n) => n.type === "ugc-creator")!.description).toContain("In the editor it draws options for you to pick from.")
  })

  it("no description names a model", () => {
    for (const type of UGC_NODE_TYPES) {
      const description = NODE_REGISTRY.find((n) => n.type === type)!.description.toLowerCase()
      for (const id of Object.keys(MODEL_CATALOG)) expect(description, `${type} names ${id}`).not.toContain(id.toLowerCase())
    }
  })
})
