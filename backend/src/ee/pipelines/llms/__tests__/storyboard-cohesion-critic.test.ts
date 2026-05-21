import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../call-llm.js", () => ({ callLLM: vi.fn() }))

import { callLLM } from "../call-llm.js"
import { runStoryboardCohesionCritic } from "../storyboard-cohesion-critic.js"

const mockSupabase = {} as never

const stubScenes = [
  { scene_index: 1, description: "Desert wide shot at noon", keyframe_url: "https://cdn.example.com/k1.png", location_key: "desert", cast_keys: [] },
  { scene_index: 2, description: "Cockpit close-up", keyframe_url: "https://cdn.example.com/k2.png", location_key: "cockpit", cast_keys: ["pilot"] },
  { scene_index: 3, description: "Aerial banking shot", keyframe_url: "https://cdn.example.com/k3.png", location_key: "desert_sky", cast_keys: ["pilot"] },
]
const stubStyle = { visual_style: "v", color_palette: "p", lighting: "l", camera_language: "c" }

describe("runStoryboardCohesionCritic", () => {
  beforeEach(() => vi.clearAllMocks())

  it("calls callLLM with role='critic', task='storyboard_cohesion', maxRetries=1, sonnet, temp 0.2", async () => {
    vi.mocked(callLLM).mockResolvedValue({
      output: { overall_assessment: "coherent", coherence_score: 9, summary: "OK", findings: [] },
      llmCallId: "x", costUsd: 0, inputTokens: 0, outputTokens: 0,
    } as never)

    await runStoryboardCohesionCritic({
      supabase: mockSupabase, pipelineId: "p1", stageId: "s1", userId: "u1",
      scenes: stubScenes, globalStyle: stubStyle,
    })

    expect(callLLM).toHaveBeenCalledTimes(1)
    const args = vi.mocked(callLLM).mock.calls[0][0]
    expect(args.role).toBe("critic")
    expect(args.task).toBe("storyboard_cohesion")
    expect(args.maxRetries).toBe(1)
    expect(args.modelId).toBe("claude-sonnet-4-6")
    expect(args.temperature).toBe(0.2)
    expect(args.systemPrompt).toContain("Storyboard Cohesion Critic")
    expect(args.systemPrompt).toContain("coherence_score < 4")  // score-override anchor
    expect(args.systemPrompt.toLowerCase()).toContain("warn-only")
  })

  it("userPrompt is an array with 1 image content block per scene (URL-source)", async () => {
    vi.mocked(callLLM).mockResolvedValue({
      output: { overall_assessment: "coherent", coherence_score: 9, summary: "OK", findings: [] },
      llmCallId: "x", costUsd: 0, inputTokens: 0, outputTokens: 0,
    } as never)

    await runStoryboardCohesionCritic({
      supabase: mockSupabase, pipelineId: "p1", stageId: "s1", userId: "u1",
      scenes: stubScenes, globalStyle: stubStyle,
    })

    const args = vi.mocked(callLLM).mock.calls[0][0]
    expect(Array.isArray(args.userPrompt)).toBe(true)
    const blocks = args.userPrompt as Array<{ type: string; source?: { type: string; url?: string }; text?: string }>
    const imageBlocks = blocks.filter((b) => b.type === "image")
    expect(imageBlocks).toHaveLength(3)
    expect(imageBlocks[0]?.source?.type).toBe("url")
    expect(imageBlocks[0]?.source?.url).toBe("https://cdn.example.com/k1.png")
    expect(imageBlocks[2]?.source?.url).toBe("https://cdn.example.com/k3.png")
  })

  it("userPrompt intro text contains scene descriptions + global_style", async () => {
    vi.mocked(callLLM).mockResolvedValue({
      output: { overall_assessment: "coherent", coherence_score: 9, summary: "OK", findings: [] },
      llmCallId: "x", costUsd: 0, inputTokens: 0, outputTokens: 0,
    } as never)

    await runStoryboardCohesionCritic({
      supabase: mockSupabase, pipelineId: "p1", stageId: "s1", userId: "u1",
      scenes: stubScenes, globalStyle: stubStyle,
    })

    const args = vi.mocked(callLLM).mock.calls[0][0]
    const blocks = args.userPrompt as Array<{ type: string; text?: string }>
    const introBlock = blocks[0]
    expect(introBlock?.type).toBe("text")
    expect(introBlock?.text).toContain("Scene 1: Desert wide shot at noon")
    expect(introBlock?.text).toContain("Scene 2: Cockpit close-up")
    expect(introBlock?.text).toContain("GLOBAL STYLE")
  })

  it("returns parsed verdict + llmCallId", async () => {
    vi.mocked(callLLM).mockResolvedValue({
      output: {
        overall_assessment: "minor_issues",
        coherence_score: 7,
        summary: "Slight lighting drift between scenes 1 and 3.",
        findings: [{
          severity: "warning" as const,
          category: "lighting_mismatch" as const,
          affected_scenes: [1, 3],
          description: "Scene 1 is noon-bright; scene 3 shows late-afternoon golden hour without setup.",
          suggested_action: "Either add an intermediate establishing shot OR re-anchor scene 3's lighting to noon.",
        }],
      },
      llmCallId: "llm-cohesion-1",
      costUsd: 0, inputTokens: 0, outputTokens: 0,
    } as never)

    const result = await runStoryboardCohesionCritic({
      supabase: mockSupabase, pipelineId: "p1", stageId: "s1", userId: "u1",
      scenes: stubScenes, globalStyle: stubStyle,
    })

    expect(result.llmCallId).toBe("llm-cohesion-1")
    expect(result.verdict.overall_assessment).toBe("minor_issues")
    expect(result.verdict.coherence_score).toBe(7)
    expect(result.verdict.findings).toHaveLength(1)
    expect(result.verdict.findings[0]?.category).toBe("lighting_mismatch")
  })

  it("propagates callLLM exceptions to the caller", async () => {
    vi.mocked(callLLM).mockRejectedValue(new Error("502 service unavailable"))
    await expect(
      runStoryboardCohesionCritic({
        supabase: mockSupabase, pipelineId: "p1", stageId: "s1", userId: "u1",
        scenes: stubScenes, globalStyle: stubStyle,
      }),
    ).rejects.toThrow("502")
  })
})
