import { describe, it, expect, vi } from "vitest"

vi.mock("../call-llm.js", () => ({
  callLLM: vi.fn(),
  CallLLMValidationError: class extends Error {},
}))

import { callLLM } from "../call-llm.js"
import { runDetection } from "../detection.js"

describe("runDetection", () => {
  it("calls callLLM with detection role + Haiku model + correct prompt", async () => {
    ;(callLLM as ReturnType<typeof vi.fn>).mockResolvedValue({
      output: {
        characters: [],
        objects: [],
        locations: [],
        audio_intent: {
          has_narrator: false,
          narrator_profile_hint: null,
          dialogue_speaker_keys: [],
          music: { mood_hint: "epic", bpm_hint: 120, genre_hints: ["cinematic"] },
          sfx_hints: [],
        },
      },
      llmCallId: "llm-1",
      costUsd: 0.01,
      inputTokens: 100,
      outputTokens: 50,
    })

    const result = await runDetection({
      supabase: {} as never,
      pipelineId: "p1",
      stageId: "s1",
      userId: "u1",
      storyPrompt: "A pilot's final mission",
      format: "short_film",
      targetDurationSeconds: 60,
      language: "en",
    })

    expect(result.audio_intent.music.mood_hint).toBe("epic")
    const call = (callLLM as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.role).toBe("detection")
    expect(call.modelId).toBe("claude-haiku-4-5")
    expect(call.userPrompt).toContain("A pilot's final mission")
    expect(call.userPrompt).toContain("FORMAT: short_film")
  })
})
