import { describe, expect, it } from "vitest"
import { NODE_REGISTRY } from "../node-registry.js"
import { VIDEO_AUDIT_BUCKET_CREDITS } from "@nodaro/shared"

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
    // Range string "0-3" reflects the spread across strategies — concat /
    // first-non-empty / count / vote / merge-json are 0cr; pick-best-llm is
    // 3cr. The composite key `reduce:<strategyId>` does the real lookup at
    // runtime (see backend/src/ee/billing/credits.ts).
    expect(entry!.creditCost).toBe("0-3")
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
