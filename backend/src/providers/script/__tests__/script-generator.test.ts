/**
 * Script generator tests.
 *
 * generateScript() turns a concept + scene count into a structured
 * GeneratedScript by calling an LLM and parsing the JSON response.
 *
 * The interesting bits are:
 *   - Model resolution: explicit llmModel > legacy provider map > feature
 *     default. Legacy provider names ("gemini" / "claude" / "gpt") map to
 *     specific LLM model IDs.
 *   - Markdown stripping: LLMs often wrap JSON in ```json fences
 *   - Validation: response must have a title and a non-empty scenes array
 *   - Normalization: duration ↔ durationHint mirror each other; mood
 *     coerced to an array
 *   - Empty-response and parse-failure error paths
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => {
  const llmComplete = vi.fn()
  const getLlmModel = vi.fn((id: string) => ({
    id,
    displayName: `Model-${id}`,
    maxOutputTokens: 8192,
  }))
  return { llmComplete, getLlmModel }
})

vi.mock("../../../lib/llm-client.js", () => ({
  llmComplete: mocks.llmComplete,
}))

vi.mock("@nodaro/shared", () => ({
  getLlmModel: mocks.getLlmModel,
  LLM_FEATURE_DEFAULTS: {
    "generate-script": "default-script-model",
  },
}))

import { generateScript } from "../script-generator.js"

const VALID_SCRIPT = {
  title: "The Awakening",
  totalDuration: 60,
  scenes: [
    {
      sceneNumber: 1,
      visualDescription: "WIDE SHOT — a misty forest",
      action: "the hero awakens",
      mood: "mysterious",
      durationHint: 8,
      imagePrompt: "misty forest cinematic",
    },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.llmComplete.mockResolvedValue({ text: JSON.stringify(VALID_SCRIPT) })
})

// ===========================================================================
// 1) Model resolution
// ===========================================================================

describe("generateScript — model resolution", () => {
  it("uses explicit llmModel when provided", async () => {
    await generateScript("p", 3, undefined, undefined, undefined, "claude-sonnet-4.6")

    expect(mocks.llmComplete).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: "claude-sonnet-4.6" }),
    )
  })

  it("explicit llmModel beats legacy provider", async () => {
    await generateScript("p", 3, undefined, undefined, "gemini", "claude-sonnet-4.6")

    expect(mocks.llmComplete).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: "claude-sonnet-4.6" }),
    )
  })

  it("maps legacy provider 'gemini' → gemini-3-flash", async () => {
    await generateScript("p", 3, undefined, undefined, "gemini")

    expect(mocks.llmComplete).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: "gemini-3-flash" }),
    )
  })

  it("maps legacy provider 'claude' → claude-sonnet-4.6", async () => {
    await generateScript("p", 3, undefined, undefined, "claude")

    expect(mocks.llmComplete).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: "claude-sonnet-4.6" }),
    )
  })

  it("maps legacy provider 'gpt' → gpt-5.2", async () => {
    await generateScript("p", 3, undefined, undefined, "gpt")

    expect(mocks.llmComplete).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: "gpt-5.2" }),
    )
  })

  it("falls back to LLM_FEATURE_DEFAULTS when neither llmModel nor provider set", async () => {
    await generateScript("p")

    expect(mocks.llmComplete).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: "default-script-model" }),
    )
  })
})

// ===========================================================================
// 2) Prompt construction
// ===========================================================================

describe("generateScript — user prompt construction", () => {
  it("includes scene count and target duration", async () => {
    await generateScript("a journey", 7, undefined, 90)

    const call = mocks.llmComplete.mock.calls[0][0]
    const userMsg = (call.messages[0] as { content: string }).content
    expect(userMsg).toContain("7-scene")
    expect(userMsg).toContain("90 seconds")
    expect(userMsg).toContain("a journey")
  })

  it("default targetDuration is 60s", async () => {
    await generateScript("a journey", 5)

    const call = mocks.llmComplete.mock.calls[0][0]
    const userMsg = (call.messages[0] as { content: string }).content
    expect(userMsg).toContain("60 seconds")
  })

  it("default sceneCount is 5", async () => {
    await generateScript("a journey")

    const call = mocks.llmComplete.mock.calls[0][0]
    const userMsg = (call.messages[0] as { content: string }).content
    expect(userMsg).toContain("5-scene")
  })

  it("appends tone when provided", async () => {
    await generateScript("a journey", 3, "noir thriller")

    const call = mocks.llmComplete.mock.calls[0][0]
    const userMsg = (call.messages[0] as { content: string }).content
    expect(userMsg).toContain("Tone: noir thriller")
  })

  it("omits Tone line when tone is undefined", async () => {
    await generateScript("a journey", 3)

    const call = mocks.llmComplete.mock.calls[0][0]
    const userMsg = (call.messages[0] as { content: string }).content
    expect(userMsg).not.toContain("Tone:")
  })

  it("uses the system prompt with cinematic-script instructions", async () => {
    await generateScript("p")

    const call = mocks.llmComplete.mock.calls[0][0]
    expect(call.system).toContain("cinematic script writer")
    expect(call.system).toContain("ONLY valid JSON")
  })
})

// ===========================================================================
// 3) maxTokens cap
// ===========================================================================

describe("generateScript — maxTokens cap", () => {
  it("uses model.maxOutputTokens when below 16384", async () => {
    mocks.getLlmModel.mockReturnValueOnce({ id: "x", displayName: "X", maxOutputTokens: 8192 })
    await generateScript("p", 3, undefined, undefined, undefined, "x")

    expect(mocks.llmComplete).toHaveBeenCalledWith(
      expect.objectContaining({ maxTokens: 8192 }),
    )
  })

  it("caps maxTokens at 16384 when model exceeds it", async () => {
    mocks.getLlmModel.mockReturnValueOnce({ id: "x", displayName: "X", maxOutputTokens: 200000 })
    await generateScript("p", 3, undefined, undefined, undefined, "x")

    expect(mocks.llmComplete).toHaveBeenCalledWith(
      expect.objectContaining({ maxTokens: 16384 }),
    )
  })

  it("falls back to 16384 when model is unknown", async () => {
    mocks.getLlmModel.mockReturnValueOnce(undefined as never)
    await generateScript("p", 3, undefined, undefined, undefined, "unknown")

    expect(mocks.llmComplete).toHaveBeenCalledWith(
      expect.objectContaining({ maxTokens: 16384 }),
    )
  })
})

// ===========================================================================
// 4) Empty response + JSON parsing
// ===========================================================================

describe("generateScript — response handling", () => {
  it("throws on empty response", async () => {
    mocks.llmComplete.mockResolvedValueOnce({ text: "" })

    await expect(generateScript("p")).rejects.toThrow(/empty response/)
  })

  it("throws on whitespace-only response", async () => {
    mocks.llmComplete.mockResolvedValueOnce({ text: "   \n\t  " })

    await expect(generateScript("p")).rejects.toThrow(/empty response/)
  })

  it("strips ```json fences before parsing", async () => {
    mocks.llmComplete.mockResolvedValueOnce({
      text: "```json\n" + JSON.stringify(VALID_SCRIPT) + "\n```",
    })

    const result = await generateScript("p")
    expect(result.title).toBe("The Awakening")
  })

  it("strips bare ``` fences (some models omit the language tag)", async () => {
    mocks.llmComplete.mockResolvedValueOnce({
      text: "```\n" + JSON.stringify(VALID_SCRIPT) + "\n```",
    })

    const result = await generateScript("p")
    expect(result.title).toBe("The Awakening")
  })

  it("throws on invalid JSON", async () => {
    mocks.llmComplete.mockResolvedValueOnce({ text: "not json at all" })

    await expect(generateScript("p")).rejects.toThrow(/Failed to parse script output/)
  })

  it("throws when title is missing", async () => {
    mocks.llmComplete.mockResolvedValueOnce({
      text: JSON.stringify({ totalDuration: 60, scenes: [{ sceneNumber: 1 }] }),
    })

    await expect(generateScript("p")).rejects.toThrow(/Invalid script structure/)
  })

  it("throws when scenes is empty array", async () => {
    mocks.llmComplete.mockResolvedValueOnce({
      text: JSON.stringify({ title: "x", totalDuration: 60, scenes: [] }),
    })

    await expect(generateScript("p")).rejects.toThrow(/Invalid script structure/)
  })

  it("throws when scenes is not an array", async () => {
    mocks.llmComplete.mockResolvedValueOnce({
      text: JSON.stringify({ title: "x", totalDuration: 60, scenes: "not-array" }),
    })

    await expect(generateScript("p")).rejects.toThrow(/Invalid script structure/)
  })
})

// ===========================================================================
// 5) Scene normalization
// ===========================================================================

describe("generateScript — scene normalization", () => {
  it("derives duration from durationHint when duration missing", async () => {
    mocks.llmComplete.mockResolvedValueOnce({
      text: JSON.stringify({
        title: "x",
        totalDuration: 8,
        scenes: [{
          sceneNumber: 1,
          visualDescription: "v",
          action: "a",
          mood: "m",
          durationHint: 12,
          imagePrompt: "i",
        }],
      }),
    })

    const result = await generateScript("p")
    expect(result.scenes[0].duration).toBe(12)
  })

  it("derives durationHint from duration when durationHint missing", async () => {
    mocks.llmComplete.mockResolvedValueOnce({
      text: JSON.stringify({
        title: "x",
        totalDuration: 8,
        scenes: [{
          sceneNumber: 1,
          visualDescription: "v",
          action: "a",
          mood: "m",
          duration: 7,
          imagePrompt: "i",
        }],
      }),
    })

    const result = await generateScript("p")
    expect(result.scenes[0].durationHint).toBe(7)
  })

  it("defaults durationHint to 5 when both are missing", async () => {
    mocks.llmComplete.mockResolvedValueOnce({
      text: JSON.stringify({
        title: "x",
        totalDuration: 5,
        scenes: [{
          sceneNumber: 1,
          visualDescription: "v",
          action: "a",
          mood: "m",
          imagePrompt: "i",
        }],
      }),
    })

    const result = await generateScript("p")
    expect(result.scenes[0].durationHint).toBe(5)
  })

  it("wraps string mood into an array", async () => {
    mocks.llmComplete.mockResolvedValueOnce({
      text: JSON.stringify({
        title: "x",
        totalDuration: 5,
        scenes: [{
          sceneNumber: 1,
          visualDescription: "v",
          action: "a",
          mood: "tense",
          durationHint: 5,
          imagePrompt: "i",
        }],
      }),
    })

    const result = await generateScript("p")
    expect(result.scenes[0].mood).toEqual(["tense"])
  })

  it("preserves array mood as-is", async () => {
    mocks.llmComplete.mockResolvedValueOnce({
      text: JSON.stringify({
        title: "x",
        totalDuration: 5,
        scenes: [{
          sceneNumber: 1,
          visualDescription: "v",
          action: "a",
          mood: ["tense", "mysterious"],
          durationHint: 5,
          imagePrompt: "i",
        }],
      }),
    })

    const result = await generateScript("p")
    expect(result.scenes[0].mood).toEqual(["tense", "mysterious"])
  })

  it("normalizes empty/missing mood to empty array", async () => {
    mocks.llmComplete.mockResolvedValueOnce({
      text: JSON.stringify({
        title: "x",
        totalDuration: 5,
        scenes: [{
          sceneNumber: 1,
          visualDescription: "v",
          action: "a",
          durationHint: 5,
          imagePrompt: "i",
        }],
      }),
    })

    const result = await generateScript("p")
    expect(result.scenes[0].mood).toEqual([])
  })

  it("preserves all other scene fields", async () => {
    const scene = {
      sceneNumber: 2,
      sceneName: "The Reveal",
      visualDescription: "CLOSE UP",
      action: "the door opens",
      mood: ["dramatic"],
      durationHint: 6,
      duration: 6,
      imagePrompt: "doorway in shadow",
      characters: [{ name: "Alice", description: "tall", mood: "wary", action: "approaching" }],
      dialogue: [{ speaker: "Alice", text: "Hello?" }],
      location: { name: "Hallway", description: "dim", timeOfDay: "night" },
      cinematography: { shotType: "close-up", cameraAngle: "eye-level" },
      musicMood: "ambient",
      soundEffects: ["creaking door"],
    }
    mocks.llmComplete.mockResolvedValueOnce({
      text: JSON.stringify({ title: "x", totalDuration: 6, scenes: [scene] }),
    })

    const result = await generateScript("p")
    expect(result.scenes[0].sceneName).toBe("The Reveal")
    expect(result.scenes[0].characters).toHaveLength(1)
    expect(result.scenes[0].dialogue?.[0].speaker).toBe("Alice")
    expect(result.scenes[0].location?.timeOfDay).toBe("night")
    expect(result.scenes[0].cinematography?.shotType).toBe("close-up")
    expect(result.scenes[0].musicMood).toBe("ambient")
    expect(result.scenes[0].soundEffects).toEqual(["creaking door"])
  })

  it("preserves top-level title + totalDuration", async () => {
    const result = await generateScript("p")
    expect(result.title).toBe("The Awakening")
    expect(result.totalDuration).toBe(60)
  })
})
