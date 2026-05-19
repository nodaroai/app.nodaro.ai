import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../call-llm.js", () => ({ callLLM: vi.fn() }))

import { callLLM } from "../call-llm.js"
import {
  runImageCritic,
  buildUserPrompt,
  ImageCriticVerdictSchema,
} from "../image-critic.js"

beforeEach(() => vi.clearAllMocks())

function makeSupabaseMock(opts: { verdictRowId?: string; insertError?: Error } = {}) {
  const recorded = { insertedVerdict: undefined as Record<string, unknown> | undefined }
  const supabase = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "image_critic_verdicts") {
        return {
          insert: (payload: Record<string, unknown>) => {
            recorded.insertedVerdict = payload
            return {
              select: () => ({
                single: async () =>
                  opts.insertError
                    ? { data: null, error: { message: opts.insertError.message } }
                    : { data: { id: opts.verdictRowId ?? "verdict-1" }, error: null },
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

describe("buildUserPrompt", () => {
  it("emits text + keyframe image when no prior frame and no refs", () => {
    const blocks = buildUserPrompt({
      keyframeUrl: "https://r2/kf.png",
      sceneDescription: "Hero enters",
      emotionalBeat: "anticipation",
      shotStartState: "hero at door",
      continuityWithPrevious: null,
      visualKeyframePrompt: "Wide shot of dim hallway",
    })
    // text(context) + image(keyframe) + text(closing) = 3 blocks
    expect(blocks).toHaveLength(3)
    expect(blocks[0]).toMatchObject({ type: "text" })
    expect(blocks[1]).toMatchObject({ type: "image", source: { type: "url", url: "https://r2/kf.png" } })
    expect(blocks[2]).toMatchObject({ type: "text" })
  })

  it("appends prior_last_frame block when supplied", () => {
    const blocks = buildUserPrompt({
      keyframeUrl: "https://r2/kf.png",
      priorLastFrameUrl: "https://r2/prior.png",
      sceneDescription: "...",
      emotionalBeat: "...",
      shotStartState: "...",
      continuityWithPrevious: "hero turns into doorway",
      visualKeyframePrompt: "...",
    })
    // adds text(prior header) + image(prior) = 2 extras
    expect(blocks).toHaveLength(5)
    const imageBlocks = blocks.filter((b) => b.type === "image")
    expect(imageBlocks).toHaveLength(2)
    expect(imageBlocks[1]).toMatchObject({
      source: { type: "url", url: "https://r2/prior.png" },
    })
  })

  it("appends reference images when supplied", () => {
    const blocks = buildUserPrompt({
      keyframeUrl: "https://r2/kf.png",
      referenceUrls: ["https://r2/r1.png", "https://r2/r2.png"],
      sceneDescription: "...",
      emotionalBeat: "...",
      shotStartState: "...",
      continuityWithPrevious: null,
      visualKeyframePrompt: "...",
    })
    // text(context) + image(kf) + text(refs header) + 2 image refs + text(closing) = 6 blocks
    expect(blocks).toHaveLength(6)
    const imageBlocks = blocks.filter((b) => b.type === "image")
    expect(imageBlocks).toHaveLength(3) // keyframe + 2 refs
  })
})

describe("runImageCritic", () => {
  it("detects continuity_break when given a prior last_frame + persists with stage_7b_pre tag", async () => {
    ;(callLLM as ReturnType<typeof vi.fn>).mockResolvedValue({
      output: {
        ok: false,
        issues: [
          {
            type: "continuity_break",
            severity: "blocking",
            message: "Hero's left arm moved unrealistically between frames.",
            suggested_fix: "Regenerate with stronger pose anchor.",
          },
        ],
        notes: "Continuity broken across shot boundary.",
      },
      llmCallId: "llm-1",
      costUsd: 0.005,
      inputTokens: 800,
      outputTokens: 80,
    })

    const { supabase, recorded } = makeSupabaseMock()
    const result = await runImageCritic({
      supabase,
      pipelineId: "p1",
      pipelineEntityId: "scene-1",
      shotId: "shot_02",
      assetId: "asset-kf",
      userId: "u1",
      keyframeUrl: "https://r2/kf.png",
      priorLastFrameUrl: "https://r2/prior.png",
      sceneDescription: "Chase scene",
      emotionalBeat: "tense",
      shotStartState: "hero rounds the corner",
      continuityWithPrevious: "hero arm matches end of shot 1",
      visualKeyframePrompt: "Hero mid-stride, side-on, alley wall blurred",
      invokedVia: "stage_7b_pre",
    })

    expect(result.ok).toBe(false)
    expect(result.issues[0]?.type).toBe("continuity_break")
    expect(result.issues[0]?.severity).toBe("blocking")
    expect(recorded.insertedVerdict).toMatchObject({
      pipeline_id: "p1",
      pipeline_entity_id: "scene-1",
      asset_id: "asset-kf",
      shot_id: "shot_02",
      invoked_via: "stage_7b_pre",
      verdict_ok: false,
      llm_call_id: "llm-1",
    })

    // Sonnet, low temp, vision blocks (array), schema = ImageCriticVerdictSchema
    const call = (callLLM as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.modelId).toBe("claude-sonnet-4-6")
    expect(call.role).toBe("critic")
    expect(call.task).toBe("image_critic")
    expect(call.temperature).toBe(0.2)
    expect(Array.isArray(call.userPrompt)).toBe(true)
    // The user prompt array MUST contain the prior_last_frame image block.
    expect(call.userPrompt.some((b: { type: string; source?: { url?: string } }) =>
      b.type === "image" && b.source?.url === "https://r2/prior.png",
    )).toBe(true)
  })

  it("no-prior-frame audit (helper:audit_images): ok=true verdict persists with helper tag", async () => {
    ;(callLLM as ReturnType<typeof vi.fn>).mockResolvedValue({
      output: {
        ok: true,
        issues: [],
        notes: "Keyframe matches prompt and reference identity.",
      },
      llmCallId: "llm-2",
      costUsd: 0.004,
      inputTokens: 600,
      outputTokens: 50,
    })

    const { supabase, recorded } = makeSupabaseMock({ verdictRowId: "verdict-2" })
    const result = await runImageCritic({
      supabase,
      pipelineId: "p1",
      pipelineEntityId: "scene-1",
      userId: "u1",
      keyframeUrl: "https://r2/kf.png",
      // no priorLastFrameUrl
      referenceUrls: ["https://r2/r1.png"],
      sceneDescription: "Opening",
      emotionalBeat: "calm",
      shotStartState: "hero at desk",
      continuityWithPrevious: null,
      visualKeyframePrompt: "Hero looking at screen",
      invokedVia: "helper:audit_images",
    })

    expect(result.ok).toBe(true)
    expect(result.issues).toEqual([])
    expect(recorded.insertedVerdict).toMatchObject({
      invoked_via: "helper:audit_images",
      verdict_ok: true,
    })

    // No prior image block — user prompt has keyframe + reference but not prior.
    const call = (callLLM as ReturnType<typeof vi.fn>).mock.calls[0][0]
    const priorBlock = call.userPrompt.find(
      (b: { type: string; source?: { url?: string } }) =>
        b.type === "image" && b.source?.url?.includes("prior"),
    )
    expect(priorBlock).toBeUndefined()
  })

  it("persists distinct invoked_via tags for stage_7b_pre vs helper:* calls", async () => {
    ;(callLLM as ReturnType<typeof vi.fn>).mockResolvedValue({
      output: { ok: true, issues: [], notes: "" },
      llmCallId: "llm-3",
      costUsd: 0,
      inputTokens: 100,
      outputTokens: 10,
    })

    const m1 = makeSupabaseMock({ verdictRowId: "v-1" })
    await runImageCritic({
      supabase: m1.supabase,
      pipelineId: "p1",
      pipelineEntityId: "scene-1",
      userId: "u1",
      keyframeUrl: "https://r2/kf.png",
      sceneDescription: "x",
      emotionalBeat: "x",
      shotStartState: "x",
      continuityWithPrevious: null,
      visualKeyframePrompt: "x",
      invokedVia: "stage_7b_pre",
    })

    const m2 = makeSupabaseMock({ verdictRowId: "v-2" })
    await runImageCritic({
      supabase: m2.supabase,
      pipelineId: "p1",
      pipelineEntityId: "scene-1",
      userId: "u1",
      keyframeUrl: "https://r2/kf.png",
      sceneDescription: "x",
      emotionalBeat: "x",
      shotStartState: "x",
      continuityWithPrevious: null,
      visualKeyframePrompt: "x",
      invokedVia: "helper:validate_match_cut",
    })

    expect(m1.recorded.insertedVerdict?.invoked_via).toBe("stage_7b_pre")
    expect(m2.recorded.insertedVerdict?.invoked_via).toBe("helper:validate_match_cut")
  })

  it("verdict shape: ImageCriticVerdictSchema accepts the canonical happy shape and rejects malformed", () => {
    expect(
      ImageCriticVerdictSchema.safeParse({
        ok: true,
        issues: [],
        notes: "All good.",
      }).success,
    ).toBe(true)

    expect(
      ImageCriticVerdictSchema.safeParse({
        ok: false,
        issues: [
          {
            type: "continuity_break",
            severity: "blocking",
            message: "Hero teleports",
          },
        ],
        notes: "Issue detected.",
      }).success,
    ).toBe(true)

    // Invalid issue type
    expect(
      ImageCriticVerdictSchema.safeParse({
        ok: false,
        issues: [{ type: "made_up_issue", severity: "blocking", message: "..." }],
        notes: "",
      }).success,
    ).toBe(false)
  })
})
