import { describe, it, expect, vi } from "vitest"

import {
  buildLlmStructuredBody,
  DEFAULT_LLM_MODEL,
  GENERATE_CONTEXT_HEADER,
  LEGACY_LLM_MODEL_ALIASES,
  LLM_MODELS,
  renderGenerateInput,
} from "../generate"

/**
 * The generator's wire contract (spec §8). The renderers are pure functions of the
 * registry and are covered by their own suites, so they are stubbed here; what this
 * pins is the BODY `llm.structuredJob` receives — the enum-free structural schema,
 * the `studio_production` schema name, the D10 default model, and the caps that keep
 * a ~20-scene plan inside every selectable model's `maxOutputTokens`.
 */

vi.mock("../registry", () => ({
  buildFormatRegistry: () => ({ marker: "registry" }),
}))
vi.mock("../json-schema", () => ({
  renderStructuralJsonSchema: (r: unknown) => ({ type: "object", from: r }),
}))
vi.mock("../render-skill", () => ({
  renderSystemPrompt: (r: unknown) => `SKILL ${JSON.stringify(r)}`,
}))

describe("renderGenerateInput (append context, spec §6.4)", () => {
  it("is the bare brief without a context", () => {
    expect(renderGenerateInput("a chase")).toBe("a chase")
  })
  it("appends the production block with exact @names, film ids, scenes and folders", () => {
    const out = renderGenerateInput("add three scenes", {
      cast: [{ kind: "character", name: "Natalie" }, { kind: "location", name: "Old Bridge" }],
      film: { cameraFormatId: "arri-alexa", moodId: ["tense"] },
      scenes: ["The chase begins", "Scene 2"],
      folders: ["Act 1"],
    })
    expect(out).toBe(
      [
        "add three scenes",
        "",
        "## This plan APPENDS to an existing production",
        "Cast already in the production — mention them with exactly these names: @Natalie (character), @Old Bridge (location).",
        "Film look already set (ids): cameraFormatId=arri-alexa. Write `film` only if the brief asks to change it.",
        "Existing scenes (2): The chase begins; Scene 2.",
        "Folders: Act 1.",
      ].join("\n"),
    )
  })
})

describe("buildLlmStructuredBody", () => {
  it("renders the registry prompt + structural schema around the given input, with the fixed wire ids", () => {
    const body = buildLlmStructuredBody({ input: "a chase in Rome", llmModel: "gpt-6-astra" })
    expect(body).toMatchObject({
      input: "a chase in Rome",
      schemaName: "studio_production",
      llmModel: "gpt-6-astra",
      maxRetries: 2,
      maxTokens: 16384,
      origin: "studio",
    })
    expect(typeof body.system).toBe("string")
    expect(body.jsonSchema).toEqual(expect.any(Object))
  })

  it("names Fable as the default and lists exactly the three selectable models, in toggle order", () => {
    expect(DEFAULT_LLM_MODEL).toBe("claude-fable-5")
    expect([...LLM_MODELS]).toEqual(["claude-fable-5", "gpt-6-astra", "gemini-3.8-flash"])
    expect(LLM_MODELS).toContain(DEFAULT_LLM_MODEL)
  })

  it("sends 16384 output tokens on every selectable model (one cap, no per-model branch)", () => {
    for (const llmModel of LLM_MODELS) {
      expect(buildLlmStructuredBody({ input: "a chase in Rome", llmModel }).maxTokens).toBe(16384)
    }
  })

  it("every legacy alias names a model the toggle still offers (a dead target would break Retry)", () => {
    // Sol's slot is Astra's now — a run stored under the retired id retries there.
    expect(LEGACY_LLM_MODEL_ALIASES["gpt-5.6-sol"]).toBe("gpt-6-astra")
    for (const [retired, replacement] of Object.entries(LEGACY_LLM_MODEL_ALIASES)) {
      expect(LLM_MODELS).toContain(replacement)
      // An alias for a CURRENT id would shadow the model the user actually picked.
      expect(LLM_MODELS as ReadonlyArray<string>).not.toContain(retired)
    }
  })

  it("the context header is the exact line renderGenerateInput opens the block with", () => {
    expect(GENERATE_CONTEXT_HEADER).toBe("## This plan APPENDS to an existing production")
    expect(renderGenerateInput("brief", { cast: [], scenes: ["A"], folders: [] })).toBe(
      `brief\n\n${GENERATE_CONTEXT_HEADER}\nExisting scenes (1): A.`,
    )
  })
})
