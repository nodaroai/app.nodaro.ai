import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../call-llm.js", () => ({ callLLM: vi.fn() }))

import { callLLM } from "../call-llm.js"
import { runVideoCritic } from "../video-critic.js"

const mockSupabase = {} as never

const stubFrameUrls = [
  "https://cdn.example.com/shot2-first.png",
  "https://cdn.example.com/shot2-mid.png",
  "https://cdn.example.com/shot2-last.png",
]

const passVerdict = {
  verdict: "pass" as const,
  prompt_adherence_score: 9,
  continuity_score: 8,
  identified_action: "Pilot banks the plane sharply right.",
  issues: [],
}

describe("runVideoCritic", () => {
  beforeEach(() => vi.clearAllMocks())

  it("calls callLLM with role='critic', task='video_critic', maxRetries=1, sonnet, temp 0.2", async () => {
    vi.mocked(callLLM).mockResolvedValue({
      output: passVerdict,
      llmCallId: "x",
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
    } as never)

    await runVideoCritic({
      supabase: mockSupabase,
      pipelineId: "p1",
      stageId: "s1",
      userId: "u1",
      shotPrompt: "Pilot banks sharply right",
      shotIndex: 2,
      sceneIndex: 1,
      priorLastFrameUrl: "https://cdn.example.com/shot1-last.png",
      continuityFromPrev: "match_last_frame",
      frameUrls: stubFrameUrls,
    })

    expect(callLLM).toHaveBeenCalledTimes(1)
    const args = vi.mocked(callLLM).mock.calls[0][0]
    expect(args.role).toBe("critic")
    expect(args.task).toBe("video_critic")
    expect(args.maxRetries).toBe(1)
    expect(args.modelId).toBe("claude-sonnet-4-6")
    expect(args.temperature).toBe(0.2)
    expect(args.systemPrompt).toContain("Video Critic")
    // score-override anchor: prompt_adherence_score < MIN triggers auto-fail
    expect(args.systemPrompt).toContain("trigger auto-fail")
  })

  it("userPrompt is an array with prior-last-frame + N this-shot frames as image blocks (URL-source)", async () => {
    vi.mocked(callLLM).mockResolvedValue({
      output: passVerdict,
      llmCallId: "x",
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
    } as never)

    await runVideoCritic({
      supabase: mockSupabase,
      pipelineId: "p1",
      stageId: "s1",
      userId: "u1",
      shotPrompt: "Pilot banks sharply right",
      shotIndex: 2,
      sceneIndex: 1,
      priorLastFrameUrl: "https://cdn.example.com/shot1-last.png",
      continuityFromPrev: "match_last_frame",
      frameUrls: stubFrameUrls,
    })

    const args = vi.mocked(callLLM).mock.calls[0][0]
    expect(Array.isArray(args.userPrompt)).toBe(true)
    const blocks = args.userPrompt as Array<{
      type: string
      source?: { type: string; url?: string }
      text?: string
    }>
    const imageBlocks = blocks.filter((b) => b.type === "image")
    // 1 prior-last-frame + 3 this-shot frames = 4
    expect(imageBlocks).toHaveLength(4)
    expect(imageBlocks[0]?.source?.type).toBe("url")
    expect(imageBlocks[0]?.source?.url).toBe("https://cdn.example.com/shot1-last.png")
    expect(imageBlocks[1]?.source?.url).toBe("https://cdn.example.com/shot2-first.png")
    expect(imageBlocks[3]?.source?.url).toBe("https://cdn.example.com/shot2-last.png")
  })

  it("userPrompt has only this-shot frames when priorLastFrameUrl=null", async () => {
    vi.mocked(callLLM).mockResolvedValue({
      output: { ...passVerdict, continuity_score: null },
      llmCallId: "x",
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
    } as never)

    await runVideoCritic({
      supabase: mockSupabase,
      pipelineId: "p1",
      stageId: "s1",
      userId: "u1",
      shotPrompt: "Pilot banks sharply right",
      shotIndex: 1,
      sceneIndex: 1,
      priorLastFrameUrl: null,
      continuityFromPrev: null,
      frameUrls: stubFrameUrls,
    })

    const args = vi.mocked(callLLM).mock.calls[0][0]
    const blocks = args.userPrompt as Array<{
      type: string
      source?: { type: string; url?: string }
      text?: string
    }>
    const imageBlocks = blocks.filter((b) => b.type === "image")
    expect(imageBlocks).toHaveLength(3)
    expect(imageBlocks[0]?.source?.url).toBe("https://cdn.example.com/shot2-first.png")
    // intro text should NOT reference prior last frame
    const introBlock = blocks[0]
    expect(introBlock?.type).toBe("text")
    expect(introBlock?.text).toContain("first shot")
  })

  it("returns parsed verdict + llmCallId", async () => {
    const failVerdict = {
      verdict: "fail" as const,
      prompt_adherence_score: 3,
      continuity_score: 4,
      identified_action: "Pilot walks away from plane.",
      issues: [
        {
          severity: "blocking" as const,
          category: "wrong_action" as const,
          description: "Subject walks instead of banking.",
          suggested_fix: "Keep the subject inside the cockpit, banking.",
        },
      ],
    }
    vi.mocked(callLLM).mockResolvedValue({
      output: failVerdict,
      llmCallId: "llm-vc-1",
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
    } as never)

    const result = await runVideoCritic({
      supabase: mockSupabase,
      pipelineId: "p1",
      stageId: "s1",
      userId: "u1",
      shotPrompt: "Pilot banks sharply right",
      shotIndex: 2,
      sceneIndex: 1,
      priorLastFrameUrl: "https://cdn.example.com/shot1-last.png",
      continuityFromPrev: "match_last_frame",
      frameUrls: stubFrameUrls,
    })

    expect(result.llmCallId).toBe("llm-vc-1")
    expect(result.verdict.verdict).toBe("fail")
    expect(result.verdict.prompt_adherence_score).toBe(3)
    expect(result.verdict.continuity_score).toBe(4)
    expect(result.verdict.issues).toHaveLength(1)
    expect(result.verdict.issues[0]?.category).toBe("wrong_action")
  })

  it("propagates callLLM exceptions to the caller", async () => {
    vi.mocked(callLLM).mockRejectedValue(new Error("502 service unavailable"))
    await expect(
      runVideoCritic({
        supabase: mockSupabase,
        pipelineId: "p1",
        stageId: "s1",
        userId: "u1",
        shotPrompt: "Pilot banks sharply right",
        shotIndex: 2,
        sceneIndex: 1,
        priorLastFrameUrl: "https://cdn.example.com/shot1-last.png",
        continuityFromPrev: "match_last_frame",
        frameUrls: stubFrameUrls,
      }),
    ).rejects.toThrow("502")
  })
})
