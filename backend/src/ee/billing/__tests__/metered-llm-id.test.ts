// @test-watches supabase/migrations/*.sql frontend/src/nodes/** backend/src/nodes/**
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { LLM_MODEL_IDS } from "@nodaro/shared/llm-models"
import { STATIC_CREDIT_COSTS } from "../credits.js"
import { METERED_LLM_FEATURES } from "../llm-typical-usage.js"
import { parseMeteredLlmId } from "../metered-llm-id.js"

describe("parseMeteredLlmId", () => {
  it("parses metered ids, including a colon feature and :direct; rejects tier ids", () => {
    expect(parseMeteredLlmId("reduce:pick-best-llm:claude-opus-5.5")).toEqual({ feature: "reduce:pick-best-llm", modelId: "claude-opus-5.5" })
    expect(parseMeteredLlmId("llm-chat:claude-opus-5.5:direct")).toEqual({ feature: "llm-chat", modelId: "claude-opus-5.5", lane: "direct" })
    expect(parseMeteredLlmId("llm-chat:premium")).toBeNull()
  })

  it("rejects everything that is not <feature>:<registry model>[:direct]", () => {
    for (const id of [
      "llm-chat",
      "llm-chat:",
      "llm-chat:economy",
      "llm-structured:premium-direct",
      "content-ideas:10",
      "llm-chat:claude-opus-5.5:kie",
      "llm-chat:claude-opus-5.5:direct:direct",
      "llm-chat:not-a-model",
      "nope:claude-opus-5.5",
      // a borrowed KIE slug resolves through getLlmModel, but is not a registry id
      "llm-chat:gpt-6-1-sol",
      "reduce:claude-opus-5.5",
    ]) {
      expect(parseMeteredLlmId(id), id).toBeNull()
    }
  })

  it("every feature × every registry model round-trips, with and without :direct", () => {
    for (const feature of METERED_LLM_FEATURES) {
      for (const modelId of LLM_MODEL_IDS) {
        expect(parseMeteredLlmId(`${feature}:${modelId}`)).toEqual({ feature, modelId })
        expect(parseMeteredLlmId(`${feature}:${modelId}:direct`)).toEqual({ feature, modelId, lane: "direct" })
      }
    }
  })

  it("no stored price id parses as metered, so the resolver shadows no real row", () => {
    const shadowed = Object.keys(STATIC_CREDIT_COSTS).filter((id) => parseMeteredLlmId(id) !== null)
    expect(shadowed).toEqual([])

    const migrationsDir = join(__dirname, "..", "..", "..", "..", "..", "supabase", "migrations")
    const seeded = new Set<string>()
    for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"))) {
      const sql = readFileSync(join(migrationsDir, file), "utf8")
      for (const m of sql.matchAll(/'([a-z0-9][a-z0-9.:_-]*)'/gi)) seeded.add(m[1]!)
    }
    expect(seeded.size).toBeGreaterThan(500)
    expect([...seeded].filter((id) => parseMeteredLlmId(id) !== null)).toEqual([])
  })
})
