import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../call-llm.js", () => ({ callLLM: vi.fn() }))

import { callLLM } from "../../call-llm.js"
import {
  buildUserPrompt,
  NotAMatchCutError,
  runValidateMatchCut,
} from "../validate-match-cut.js"

beforeEach(() => vi.clearAllMocks())

const fakePlan = {
  global_style: { visual_style: "x", color_palette: "x", lighting: "x", camera_language: "x" },
} as never

function makeSupabaseMock() {
  const recorded = { insertedVerdict: undefined as Record<string, unknown> | undefined }
  const supabase = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "image_critic_verdicts") {
        return {
          insert: (payload: Record<string, unknown>) => {
            recorded.insertedVerdict = payload
            return {
              select: () => ({
                single: async () => ({ data: { id: "verdict-mc-1" }, error: null }),
              }),
            }
          },
        }
      }
      throw new Error(`Unmocked table: ${table}`)
    }),
  }
  return { supabase: supabase as never, recorded }
}

function shot(opts: {
  id: string
  isMatchCut: boolean
  keyframeUrl?: string
  keyframeAssetId?: string
}) {
  return {
    shot_id: opts.id,
    shot_intent: { is_match_cut: opts.isMatchCut },
    keyframe_url: opts.keyframeUrl,
    keyframe_asset_id: opts.keyframeAssetId,
    start_state: `start of ${opts.id}`,
    end_state: `end of ${opts.id}`,
  }
}

describe("runValidateMatchCut", () => {
  it("happy path — Sonnet vision with both keyframes, persists verdict with helper tag", async () => {
    ;(callLLM as ReturnType<typeof vi.fn>).mockResolvedValue({
      output: {
        match_strength: "strong",
        verdict: {
          ok: true,
          issues: [],
          notes: "Strong silhouette match across the cut.",
        },
        suggested_adjustments: "No changes needed — the rhyme is clear.",
      },
      llmCallId: "llm-1",
      costUsd: 0.01,
      inputTokens: 700,
      outputTokens: 100,
    })

    const { supabase, recorded } = makeSupabaseMock()
    const result = await runValidateMatchCut({
      supabase,
      pipelineId: "p1",
      stageId: "s7",
      sceneId: "scene-1",
      userId: "u1",
      plan: fakePlan,
      scene: {
        description: "Door slams in shot A, cuts to a window closing in shot B",
        emotional_beat: "tense",
        shots: [
          shot({
            id: "shot_01",
            isMatchCut: true,
            keyframeUrl: "https://r2/a.png",
            keyframeAssetId: "asset-a",
          }),
          shot({
            id: "shot_02",
            isMatchCut: false,
            keyframeUrl: "https://r2/b.png",
          }),
        ],
      } as never,
      targetShotId: "shot_01",
    })

    expect(result.match_strength).toBe("strong")
    expect(result.shot_pair).toEqual(["shot_01", "shot_02"])
    expect(result.scene_id).toBe("scene-1")
    expect(result.critic_verdict.ok).toBe(true)

    // Verdict row persisted with helper tag
    expect(recorded.insertedVerdict).toMatchObject({
      pipeline_id: "p1",
      pipeline_entity_id: "scene-1",
      asset_id: "asset-a",
      shot_id: "shot_01",
      invoked_via: "helper:validate_match_cut",
      verdict_ok: true,
      llm_call_id: "llm-1",
    })

    // Vision call shape: Sonnet, role=helper, content blocks include both keyframes
    const call = (callLLM as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.role).toBe("helper")
    expect(call.task).toBe("validate_match_cut")
    expect(call.modelId).toBe("claude-sonnet-4-6")
    expect(Array.isArray(call.userPrompt)).toBe(true)
    const imageUrls = call.userPrompt
      .filter((b: { type: string }) => b.type === "image")
      .map((b: { source: { url: string } }) => b.source.url)
    expect(imageUrls).toEqual(["https://r2/a.png", "https://r2/b.png"])
  })

  it("errors with NotAMatchCutError when target shot has is_match_cut=false", async () => {
    await expect(
      runValidateMatchCut({
        supabase: {} as never,
        pipelineId: "p1",
        stageId: "s7",
        sceneId: "scene-1",
        userId: "u1",
        plan: fakePlan,
        scene: {
          shots: [
            shot({ id: "shot_01", isMatchCut: false, keyframeUrl: "https://r2/a.png" }),
            shot({ id: "shot_02", isMatchCut: false, keyframeUrl: "https://r2/b.png" }),
          ],
        } as never,
        targetShotId: "shot_01",
      }),
    ).rejects.toBeInstanceOf(NotAMatchCutError)

    expect(callLLM).not.toHaveBeenCalled()
  })

  it("errors when target shot is the last shot (no next to match)", async () => {
    await expect(
      runValidateMatchCut({
        supabase: {} as never,
        pipelineId: "p1",
        stageId: "s7",
        sceneId: "scene-1",
        userId: "u1",
        plan: fakePlan,
        scene: {
          shots: [
            shot({ id: "shot_01", isMatchCut: false, keyframeUrl: "https://r2/a.png" }),
            shot({ id: "shot_02", isMatchCut: true, keyframeUrl: "https://r2/b.png" }),
          ],
        } as never,
        targetShotId: "shot_02",
      }),
    ).rejects.toThrow(/last shot/)

    expect(callLLM).not.toHaveBeenCalled()
  })
})

describe("buildUserPrompt (validate_match_cut)", () => {
  it("assembles text + image blocks in order A → B + closing instruction", () => {
    const blocks = buildUserPrompt({
      sceneDescription: "Door slams, cuts to window",
      emotionalBeat: "tense",
      shotAId: "shot_01",
      shotAKeyframeUrl: "https://r2/a.png",
      shotAEndState: "door closed",
      shotBId: "shot_02",
      shotBKeyframeUrl: "https://r2/b.png",
      shotBStartState: "window closing",
    })
    // 5 blocks: ctx text → image A → header B text → image B → closing text
    expect(blocks).toHaveLength(5)
    expect(blocks[1]).toMatchObject({
      type: "image",
      source: { type: "url", url: "https://r2/a.png" },
    })
    expect(blocks[3]).toMatchObject({
      type: "image",
      source: { type: "url", url: "https://r2/b.png" },
    })
  })
})
