// @vitest-environment node
import { describe, it, expect } from "vitest"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { LLM_MODELS } from "@nodaro/shared/llm-models"
import { MODEL_EXTRA_VALUES, modelLines, modelValuesOf, modelsOfLine } from "../model-lines"

describe("model product lines", () => {
  it("Kling holds kling-3.0", () => {
    expect(modelsOfLine("Kling")).toContain("kling-3.0")
  })

  it("the Claude line lists claude-opus-5.5", () => {
    const claude = modelLines().find((l) => l.line === "Claude")
    expect(claude?.models.map((m) => m.id)).toContain("claude-opus-5.5")
  })

  it("a line is named once: catalog and LLM models of one series share it", () => {
    const names = modelLines().map((l) => l.line)
    expect(new Set(names).size).toBe(names.length)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
  })

  it("every catalog model and every LLM model is matchable through its line", () => {
    for (const m of Object.values(MODEL_CATALOG)) expect(modelsOfLine(m.series)).toContain(m.id)
    for (const m of LLM_MODELS) expect(modelsOfLine(m.series)).toContain(m.id)
  })

  it("a retired LLM is left out of the list but still matched", () => {
    const retired = LLM_MODELS.find((m) => m.retired)
    expect(retired).toBeDefined()
    const listed = modelLines().flatMap((l) => l.models.map((m) => m.id))
    expect(listed).not.toContain(retired!.id)
    expect(modelsOfLine(retired!.series)).toContain(retired!.id)
  })

  it("Suno also matches the value its node stores (data.model 'V5', not the catalog id)", () => {
    const suno = modelsOfLine("Suno")
    expect(suno).toContain("suno-v5")
    expect(suno).toContain("V5")
  })

  it("an exact Suno pick matches its catalog id and the value its node stores", () => {
    expect(new Set(modelValuesOf("suno-v5"))).toEqual(new Set(["suno-v5", "V5"]))
  })

  it("a model stored under its own id, or one the catalog does not know, is itself", () => {
    expect(modelValuesOf("kling-3.0")).toEqual(["kling-3.0"])
    expect(modelValuesOf("claude-opus-5.5")).toEqual(["claude-opus-5.5"])
    expect(modelValuesOf("my-custom-model")).toEqual(["my-custom-model"])
  })

  it("a line is the values of its models, and MODEL_EXTRA_VALUES counts the extra ones", () => {
    let extra = 0
    for (const { line, models } of modelLines()) {
      for (const m of models) for (const v of modelValuesOf(m.id)) expect(modelsOfLine(line)).toContain(v)
    }
    for (const m of Object.values(MODEL_CATALOG)) extra += modelValuesOf(m.id).length - 1
    expect(MODEL_EXTRA_VALUES).toBe(extra)
    expect(MODEL_EXTRA_VALUES).toBeGreaterThan(0)
  })

  it("an unknown line matches nothing", () => {
    expect(modelsOfLine("No Such Line")).toEqual([])
  })
})
