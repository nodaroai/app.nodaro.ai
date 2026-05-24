import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../call-llm.js", () => ({ callLLM: vi.fn() }))

import { callLLM } from "../call-llm.js"
import { runChatRefinePostMerge } from "../chat-refine-postmerge.js"
import type { EditorCutDecision } from "../editor.js"

const mockSupabase = {} as never

// Pass 2 fix 3: `cutDecisions` is now typed as `EditorCutDecision[]` on the
// specialist signature. The fixtures below mirror the canonical schema in
// `editor.ts` (transition_to_next + in_offset_sec + out_offset_sec +
// reasoning) so the call-site doesn't drift from the Editor LLM's output.
function makeCutDecisions(): EditorCutDecision[] {
  return [
    {
      shot_id: "s1_shot1",
      in_offset_sec: 0,
      out_offset_sec: 0,
      transition_to_next: "hard_cut",
      reasoning: "Open with a beat.",
    },
    {
      shot_id: "s1_shot2",
      in_offset_sec: 0,
      out_offset_sec: 0,
      transition_to_next: "match_cut",
      reasoning: "Match on motion.",
    },
    {
      shot_id: "s2_shot1",
      in_offset_sec: 0,
      out_offset_sec: 0,
      transition_to_next: "dissolve",
      reasoning: "Soft scene change.",
    },
  ]
}

describe("runChatRefinePostMerge", () => {
  beforeEach(() => vi.clearAllMocks())

  it("invokes callLLM with role='specialist', task='chat_refine_postmerge', maxRetries=2, sonnet, temp 0.5", async () => {
    vi.mocked(callLLM).mockResolvedValue({
      output: { reply: "Sure!", proposed_change: null },
      llmCallId: "llm-1",
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
    } as never)

    await runChatRefinePostMerge({
      supabase: mockSupabase,
      pipelineId: "p1",
      stageId: "s1",
      userId: "u1",
      finalOutputUrl: "https://example.com/final.mp4",
      cutDecisions: makeCutDecisions(),
      finalDurationSeconds: 42,
      beatGridUsed: null,
      chatHistory: [],
      userMessage: "Hello",
    })

    expect(callLLM).toHaveBeenCalledTimes(1)
    const args = vi.mocked(callLLM).mock.calls[0][0]
    expect(args.role).toBe("specialist")
    expect(args.task).toBe("chat_refine_postmerge")
    expect(args.maxRetries).toBe(2)
    expect(args.modelId).toBe("claude-sonnet-4-6")
    expect(args.temperature).toBe(0.5)
  })

  it("system prompt anchors role + constrains to suggest_branch only", async () => {
    vi.mocked(callLLM).mockResolvedValue({
      output: { reply: "ok", proposed_change: null },
      llmCallId: "x",
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
    } as never)

    await runChatRefinePostMerge({
      supabase: mockSupabase,
      pipelineId: "p1",
      stageId: "s1",
      userId: "u1",
      finalOutputUrl: "https://example.com/final.mp4",
      cutDecisions: makeCutDecisions(),
      finalDurationSeconds: 42,
      beatGridUsed: null,
      chatHistory: [],
      userMessage: "msg",
    })

    const args = vi.mocked(callLLM).mock.calls[0][0]
    expect(args.systemPrompt).toContain("Post-merge Refinement Director")
    expect(args.systemPrompt).toContain("CANNOT emit edit_artifact")
  })

  it("userPrompt embeds final_output_url + cut_decisions JSON + chat history + user message", async () => {
    vi.mocked(callLLM).mockResolvedValue({
      output: { reply: "ok", proposed_change: null },
      llmCallId: "x",
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
    } as never)

    await runChatRefinePostMerge({
      supabase: mockSupabase,
      pipelineId: "p1",
      stageId: "s1",
      userId: "u1",
      finalOutputUrl: "https://example.com/final.mp4",
      cutDecisions: makeCutDecisions(),
      finalDurationSeconds: 42,
      beatGridUsed: [0.5, 1.0, 1.5, 2.0],
      chatHistory: [
        { role: "user", content: "the climax feels rushed" },
        { role: "assistant", content: "Let's slow down scene 3." },
      ],
      userMessage: "yes, lengthen scene 3",
    })

    const args = vi.mocked(callLLM).mock.calls[0][0]
    expect(typeof args.userPrompt).toBe("string")
    expect(args.userPrompt).toContain("final_output_url:")
    expect(args.userPrompt).toContain("https://example.com/final.mp4")
    expect(args.userPrompt).not.toContain("final_video_url")
    expect(args.userPrompt).toContain("match_cut")
    expect(args.userPrompt).toContain("s1_shot1")
    expect(args.userPrompt).toContain("42")
    expect(args.userPrompt).toContain("4 beats")
    expect(args.userPrompt).toContain("the climax feels rushed")
    expect(args.userPrompt).toContain("Let's slow down scene 3.")
    expect(args.userPrompt).toContain("yes, lengthen scene 3")
  })

  it("caps cut_decisions JSON serialization to first 20 entries (60-shot pipeline scenario)", async () => {
    vi.mocked(callLLM).mockResolvedValue({
      output: { reply: "ok", proposed_change: null },
      llmCallId: "x",
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
    } as never)

    // Synthesize 60 cut_decisions — a realistic worst-case pipeline.
    const manyDecisions: EditorCutDecision[] = Array.from(
      { length: 60 },
      (_, i) => ({
        shot_id: `s${i}_shot1`,
        in_offset_sec: 0,
        out_offset_sec: 0,
        transition_to_next: "hard_cut",
        reasoning: `Cut ${i}`,
      }),
    )

    await runChatRefinePostMerge({
      supabase: mockSupabase,
      pipelineId: "p1",
      stageId: "s1",
      userId: "u1",
      finalOutputUrl: "https://example.com/final.mp4",
      cutDecisions: manyDecisions,
      finalDurationSeconds: 90,
      beatGridUsed: null,
      chatHistory: [],
      userMessage: "looks good",
    })

    const args = vi.mocked(callLLM).mock.calls[0][0]
    // The cap message should appear with the omitted count.
    expect(args.userPrompt).toContain("(40 more cuts omitted)")
    // First 20 entries are kept; the 21st (s20_shot1) should NOT appear.
    expect(args.userPrompt).toContain("s0_shot1")
    expect(args.userPrompt).toContain("s19_shot1")
    expect(args.userPrompt).not.toContain("s20_shot1")
    // The "60 cuts" header still reports the FULL count for the LLM.
    expect(args.userPrompt).toContain("cut_decisions (60 cuts)")
  })

  it("does NOT cap when cut_decisions.length <= 20 (no omission line)", async () => {
    vi.mocked(callLLM).mockResolvedValue({
      output: { reply: "ok", proposed_change: null },
      llmCallId: "x",
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
    } as never)

    await runChatRefinePostMerge({
      supabase: mockSupabase,
      pipelineId: "p1",
      stageId: "s1",
      userId: "u1",
      finalOutputUrl: "https://example.com/final.mp4",
      cutDecisions: makeCutDecisions(), // 3 entries
      finalDurationSeconds: 42,
      beatGridUsed: null,
      chatHistory: [],
      userMessage: "x",
    })

    const args = vi.mocked(callLLM).mock.calls[0][0]
    expect(args.userPrompt).not.toContain("more cuts omitted")
  })

  it("returns { output, llmCallId } shape", async () => {
    vi.mocked(callLLM).mockResolvedValue({
      output: {
        reply: "Re-run from shot_list",
        proposed_change: {
          change_type: "suggest_branch",
          from_stage: "shot_list",
          reason: "Pacing tweaks require re-cutting shot count and beat alignment",
        },
      },
      llmCallId: "llm-abc",
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
    } as never)

    const result = await runChatRefinePostMerge({
      supabase: mockSupabase,
      pipelineId: "p1",
      stageId: "s1",
      userId: "u1",
      finalOutputUrl: "https://example.com/final.mp4",
      cutDecisions: makeCutDecisions(),
      finalDurationSeconds: 42,
      beatGridUsed: null,
      chatHistory: [],
      userMessage: "Re-pace the climax",
    })

    expect(result.llmCallId).toBe("llm-abc")
    expect(result.output.reply).toBe("Re-run from shot_list")
    expect(result.output.proposed_change?.change_type).toBe("suggest_branch")
  })

  it("propagates callLLM exceptions to the caller", async () => {
    vi.mocked(callLLM).mockRejectedValue(new Error("502 service unavailable"))
    await expect(
      runChatRefinePostMerge({
        supabase: mockSupabase,
        pipelineId: "p1",
        stageId: "s1",
        userId: "u1",
        finalOutputUrl: "https://example.com/final.mp4",
        cutDecisions: makeCutDecisions(),
        finalDurationSeconds: 42,
        beatGridUsed: null,
        chatHistory: [],
        userMessage: "x",
      }),
    ).rejects.toThrow("502")
  })
})
