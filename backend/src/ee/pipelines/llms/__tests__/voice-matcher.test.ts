import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../call-llm.js", () => ({ callLLM: vi.fn() }))

import { callLLM } from "../call-llm.js"
import { runVoiceMatcher } from "../voice-matcher.js"

beforeEach(() => vi.clearAllMocks())

describe("runVoiceMatcher", () => {
  it("uses Haiku + specialist role + voice_match task", async () => {
    ;(callLLM as ReturnType<typeof vi.fn>).mockResolvedValue({
      output: { voice_source: "premade", voice_id: "ABC123", reasoning: "matches age + accent" },
      llmCallId: "x",
      costUsd: 0.005,
      inputTokens: 200,
      outputTokens: 50,
    })

    const result = await runVoiceMatcher({
      supabase: {} as never,
      pipelineId: "p1",
      stageId: "s2",
      userId: "u1",
      castKey: "hero",
      castName: "Captain Riley",
      visualDescription: "weathered male pilot, late 40s, scar above left eye",
      voiceProfile: "deep, gravelly, weary American accent",
    })

    expect(result).toEqual({
      voice_source: "premade",
      voice_id: "ABC123",
      reasoning: "matches age + accent",
    })
    const call = (callLLM as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.role).toBe("specialist")
    expect(call.task).toBe("voice_match")
    expect(call.modelId).toBe("claude-haiku-4-5")
    expect(call.userPrompt).toContain("Captain Riley")
    expect(call.userPrompt).toContain("weathered male pilot")
  })

  it("propagates custom voice variant", async () => {
    ;(callLLM as ReturnType<typeof vi.fn>).mockResolvedValue({
      output: {
        voice_source: "custom",
        voice_design_prompt: "Robotic AI assistant, monotone, slightly metallic",
        reasoning: "no premade fits the sci-fi tone",
      },
      llmCallId: "y",
      costUsd: 0.005,
      inputTokens: 200,
      outputTokens: 70,
    })

    const result = await runVoiceMatcher({
      supabase: {} as never,
      pipelineId: "p1",
      stageId: "s2",
      userId: "u1",
      castKey: "ai_unit",
      castName: "MARK-7",
      visualDescription: "humanoid robot",
      voiceProfile: "monotone synthesized voice",
    })

    if (result.voice_source === "custom") {
      expect(result.voice_design_prompt).toContain("Robotic")
    } else {
      throw new Error("expected custom voice_source")
    }
  })
})
