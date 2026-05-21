import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../call-llm.js", () => ({ callLLM: vi.fn() }))

import { callLLM } from "../call-llm.js"
import { runCharacterImageCritic } from "../character-image-critic.js"

const mockSupabase = {} as never

beforeEach(() => {
  vi.clearAllMocks()
})

describe("runCharacterImageCritic", () => {
  it("calls callLLM with role='critic', task='character_image', maxRetries=1, sonnet, temp 0.2", async () => {
    vi.mocked(callLLM).mockResolvedValue({
      output: { verdict: "pass", prompt_adherence_score: 9, identified_subject: "fighter pilot", issues: [] },
      llmCallId: "x", costUsd: 0, inputTokens: 0, outputTokens: 0,
    } as never)

    await runCharacterImageCritic({
      supabase: mockSupabase, pipelineId: "p1", stageId: "s1", userId: "u1",
      imageUrl: "https://cdn.example.com/img.png",
      visualDescription: "A weathered fighter pilot in tan flight suit",
      globalStyle: { visual_style: "v", color_palette: "p", lighting: "l", camera_language: "c" },
    })

    expect(callLLM).toHaveBeenCalledTimes(1)
    const args = vi.mocked(callLLM).mock.calls[0][0]
    expect(args.role).toBe("critic")
    expect(args.task).toBe("character_image")
    expect(args.maxRetries).toBe(1)
    expect(args.modelId).toBe("claude-sonnet-4-6")
    expect(args.temperature).toBe(0.2)
    expect(args.systemPrompt).toContain("Character Image Critic")
    expect(args.systemPrompt.toLowerCase()).toContain("minor variance")
  })

  it("userPrompt is an array containing image + text content blocks", async () => {
    vi.mocked(callLLM).mockResolvedValue({
      output: { verdict: "pass", prompt_adherence_score: 8, identified_subject: "x", issues: [] },
      llmCallId: "x", costUsd: 0, inputTokens: 0, outputTokens: 0,
    } as never)

    await runCharacterImageCritic({
      supabase: mockSupabase, pipelineId: "p1", stageId: "s1", userId: "u1",
      imageUrl: "https://cdn.example.com/img.png",
      visualDescription: "test description",
      globalStyle: { visual_style: "v", color_palette: "p", lighting: "l", camera_language: "c" },
    })

    const args = vi.mocked(callLLM).mock.calls[0][0]
    expect(Array.isArray(args.userPrompt)).toBe(true)
    const blocks = args.userPrompt as unknown as Array<Record<string, unknown>>
    expect(blocks.some((b) => b.type === "image")).toBe(true)
    expect(blocks.some((b) => b.type === "text")).toBe(true)
    const text = blocks.find((b) => b.type === "text") as { text: string }
    expect(text.text).toContain("test description")
  })

  it("image content block is a URL-source pointing at imageUrl (no base64 fetch)", async () => {
    vi.mocked(callLLM).mockResolvedValue({
      output: { verdict: "pass", prompt_adherence_score: 9, identified_subject: "x", issues: [] },
      llmCallId: "x", costUsd: 0, inputTokens: 0, outputTokens: 0,
    } as never)

    await runCharacterImageCritic({
      supabase: mockSupabase, pipelineId: "p1", stageId: "s1", userId: "u1",
      imageUrl: "https://cdn.example.com/img.png",
      visualDescription: "x",
      globalStyle: { visual_style: "v", color_palette: "p", lighting: "l", camera_language: "c" },
    })

    const args = vi.mocked(callLLM).mock.calls[0][0]
    const blocks = args.userPrompt as unknown as Array<{
      type: string
      source?: { type: string; url?: string }
    }>
    const imgBlock = blocks.find((b) => b.type === "image")!
    expect(imgBlock.source?.type).toBe("url")
    expect(imgBlock.source?.url).toBe("https://cdn.example.com/img.png")
  })

  it("returns parsed verdict + llmCallId", async () => {
    vi.mocked(callLLM).mockResolvedValue({
      output: {
        verdict: "fail",
        prompt_adherence_score: 3,
        identified_subject: "civilian person",
        issues: [{
          severity: "blocking" as const,
          category: "wrong_subject" as const,
          description: "image shows a civilian, not a fighter pilot",
          suggested_fix: "emphasize military attire",
        }],
      },
      llmCallId: "llm-abc",
      costUsd: 0, inputTokens: 0, outputTokens: 0,
    } as never)

    const result = await runCharacterImageCritic({
      supabase: mockSupabase, pipelineId: "p1", stageId: "s1", userId: "u1",
      imageUrl: "https://x.png",
      visualDescription: "x",
      globalStyle: { visual_style: "v", color_palette: "p", lighting: "l", camera_language: "c" },
    })

    expect(result.verdict.verdict).toBe("fail")
    expect(result.verdict.prompt_adherence_score).toBe(3)
    expect(result.llmCallId).toBe("llm-abc")
  })

  it("propagates callLLM exceptions", async () => {
    vi.mocked(callLLM).mockRejectedValue(new Error("502 service unavailable"))
    await expect(
      runCharacterImageCritic({
        supabase: mockSupabase, pipelineId: "p1", stageId: "s1", userId: "u1",
        imageUrl: "https://x.png",
        visualDescription: "x",
        globalStyle: { visual_style: "v", color_palette: "p", lighting: "l", camera_language: "c" },
      }),
    ).rejects.toThrow("502")
  })
})
