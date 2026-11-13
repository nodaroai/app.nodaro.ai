// @test-watches docs/choosing-models.md
/**
 * A catalog entry marked `pickerHidden` is a model the platform runs on its own
 * (the trained-character model), never one a person or a client picks (decided
 * 2026-11-12). It is listed nowhere a model is offered, and it is still a model
 * a deployment's restriction can name.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { listModels, MODEL_CATALOG, MODEL_RECOMMENDATIONS, modelIdsByKindMode, type ModelKind, type ModelMode } from "@nodaro/shared/model-catalog"
import { buildModelTree, searchModelVariants } from "@nodaro/shared/models"
import { GATEABLE_MODEL_IDS } from "../lib/availability-override.js"

const HIDDEN = Object.values(MODEL_CATALOG).filter((m) => m.pickerHidden === true)
const KINDS: readonly ModelKind[] = ["image", "video", "audio"]
const MODES = [...new Set(Object.values(MODEL_CATALOG).flatMap((m) => m.modes))] as ModelMode[]

describe("a model the platform runs on its own", () => {
  it("is the trained-character model, and only it", () => {
    expect(HIDDEN.map((m) => m.id)).toEqual(["flux-lora-character"])
  })

  it("is in no model listing: GET /v1/models and MCP list_models (`listModels`), with or without a filter", () => {
    for (const m of HIDDEN) {
      expect(listModels().map((e) => e.id)).not.toContain(m.id)
      expect(listModels({ kind: m.kind }).map((e) => e.id)).not.toContain(m.id)
      for (const mode of m.modes) expect(listModels({ mode }).map((e) => e.id)).not.toContain(m.id)
      expect(listModels({ family: m.family }).map((e) => e.id)).not.toContain(m.id)
    }
  })

  it("creates no node from the editor's Models tab, and add-node search does not find it", () => {
    const tree = buildModelTree().flatMap((l) => l.models.map((v) => v.id))
    for (const m of HIDDEN) {
      expect(tree).not.toContain(m.id)
      expect(searchModelVariants(m.label).map((v) => v.id)).not.toContain(m.id)
      expect(searchModelVariants(m.id).map((v) => v.id)).not.toContain(m.id)
    }
  })

  it("is in no MCP tool model enum", () => {
    for (const kind of [...KINDS, null]) {
      for (const mode of MODES) {
        let ids: readonly string[] = []
        try {
          ids = modelIdsByKindMode(kind, [mode], { includeHidden: true })
        } catch {
          continue // no model of that kind and mode
        }
        for (const m of HIDDEN) expect(ids, `${String(kind)} ${mode}`).not.toContain(m.id)
      }
    }
  })

  it("is recommended nowhere and is in no docs model table", () => {
    const guide = readFileSync(join(__dirname, "..", "..", "..", "docs", "choosing-models.md"), "utf8")
    for (const m of HIDDEN) {
      expect(MODEL_RECOMMENDATIONS.flatMap((r) => r.modelIds)).not.toContain(m.id)
      expect(guide).not.toContain(`credits: ${m.id} -->`)
      expect(guide).not.toContain(`| ${m.label} |`)
    }
  })

  it("is still a model a restriction names, and Admin → Availability lists it with its label", () => {
    for (const m of HIDDEN) {
      expect(GATEABLE_MODEL_IDS.has(m.id)).toBe(true)
      // What GET /v1/admin/availability lists (ee/routes/admin-availability.ts): every catalog entry, by label.
      expect(Object.entries(MODEL_CATALOG).find(([id]) => id === m.id)?.[1].label).toBe("Trained character (FLUX LoRA)")
    }
  })
})
