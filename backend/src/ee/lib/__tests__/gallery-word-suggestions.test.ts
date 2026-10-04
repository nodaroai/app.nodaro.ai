/**
 * Suggestions for a banned gallery word: what is kept of a model's answer,
 * and the fallback when a model refuses. Neutral stand-in words on purpose.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../../lib/llm-client.js", () => ({ llmCompleteStructured: vi.fn() }))

import { llmCompleteStructured } from "../../../lib/llm-client.js"
import { cleanSuggestions, suggestForBannedWord } from "../gallery-word-suggestions.js"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("cleanSuggestions", () => {
  it("trims, drops repeats, blanks, the word itself and anything too long", () => {
    const out = cleanSuggestions("bucket", {
      translations: [" seau ", "SEAU", "", "Bucket", "x".repeat(61), "eimer"],
      exceptions: [],
    })
    expect(out.translations).toEqual(["seau", "eimer"])
  })

  it("keeps an exception only when the word or a kept translation is in it", () => {
    const out = cleanSuggestions("bucket", {
      translations: ["seau"],
      exceptions: ["a bucket of water", "un seau d'eau", "a glass of water", "a bucket of water"],
    })
    expect(out.exceptions).toEqual(["a bucket of water", "un seau d'eau"])
  })

  it("caps the lists", () => {
    const out = cleanSuggestions("bucket", {
      translations: Array.from({ length: 80 }, (_, i) => `t${i}`),
      exceptions: Array.from({ length: 80 }, (_, i) => `bucket ${i}`),
    })
    expect(out.translations).toHaveLength(40)
    expect(out.exceptions).toHaveLength(30)
  })
})

describe("suggestForBannedWord", () => {
  it("asks the next model when one refuses", async () => {
    vi.mocked(llmCompleteStructured)
      .mockRejectedValueOnce(new Error("refused"))
      .mockResolvedValueOnce({ output: { translations: ["seau"], exceptions: [] }, inputTokens: 1, outputTokens: 1 } as never)

    expect(await suggestForBannedWord("bucket")).toEqual({ translations: ["seau"], exceptions: [] })
    expect(vi.mocked(llmCompleteStructured)).toHaveBeenCalledTimes(2)
  })

  it("is null, never an error, when no model answers", async () => {
    vi.mocked(llmCompleteStructured).mockRejectedValue(new Error("down"))
    expect(await suggestForBannedWord("bucket")).toBeNull()
  })

  it("does not ask the second model once the first used up the time", async () => {
    vi.mocked(llmCompleteStructured).mockRejectedValue(new Error("timed out"))
    const clock = [0, 45_000]
    expect(await suggestForBannedWord("bucket", { now: () => clock.shift() ?? 45_000 })).toBeNull()
    expect(vi.mocked(llmCompleteStructured)).toHaveBeenCalledTimes(1)
  })
})
