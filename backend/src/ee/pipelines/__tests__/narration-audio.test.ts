import { describe, it, expect, vi, beforeEach } from "vitest"
import type { ShowrunnerPlan, PipelineConfig } from "@nodaro/shared"

vi.mock("../services/pipeline-generate-narration.js", () => ({
  pipelineGenerateNarration: vi.fn(),
}))

import { pipelineGenerateNarration } from "../services/pipeline-generate-narration.js"
import { runNarrationAudio } from "../sub-steps/narration-audio.js"

beforeEach(() => vi.clearAllMocks())

function makeSupabaseStub() {
  // No DB calls in narration-audio.ts itself — it only delegates to the
  // service wrapper (which is mocked here). A bare object is enough.
  return { from: vi.fn() } as never
}

function makePlan(narrationScript?: {
  text: string
  voice_id?: string
}): ShowrunnerPlan {
  // Minimal plan shape — fields not exercised by narration-audio are left
  // with token defaults. The whole point of this sub-step is to check
  // narration_script (the new G1 field), so other fields can be terse.
  return {
    title: "T",
    logline: "L",
    target_duration_seconds: 60,
    format: "trailer",
    output_resolution: "1080p",
    language: "en",
    genre: "drama",
    tone: ["epic"],
    cast: [],
    locations: [],
    objects: [],
    scenes: [
      {
        scene_index: 1,
        description: "x",
        emotional_beat: "setup",
        duration_seconds: 60,
        cast_keys: [],
        location_key: "x",
        object_keys: [],
        dialogue: [],
        narration: null,
        continuity_from_prev: "hard_cut",
        shot_count_hint: 1,
      },
      {
        scene_index: 2,
        description: "x",
        emotional_beat: "rising",
        duration_seconds: 60,
        cast_keys: [],
        location_key: "x",
        object_keys: [],
        dialogue: [],
        narration: null,
        continuity_from_prev: "hard_cut",
        shot_count_hint: 1,
      },
      {
        scene_index: 3,
        description: "x",
        emotional_beat: "climax",
        duration_seconds: 60,
        cast_keys: [],
        location_key: "x",
        object_keys: [],
        dialogue: [],
        narration: null,
        continuity_from_prev: "hard_cut",
        shot_count_hint: 1,
      },
    ],
    beats: [],
    has_narrator: !!narrationScript,
    narrator_profile: narrationScript ? "calm baritone" : null,
    music_plan: { mood: "epic", bpm_target: 120, genre_hints: [] },
    global_style: {
      visual_style: "x",
      color_palette: "x",
      lighting: "x",
      camera_language: "x",
    },
    total_duration_seconds: 180,
    estimated_scene_count: 3,
    warnings: [],
    ...(narrationScript ? { narration_script: narrationScript } : {}),
  }
}

describe("runNarrationAudio (Phase 1C.2.1 §G3 — sub-step 7c)", () => {
  it("skips when narration_enabled=false", async () => {
    const plan = makePlan({ text: "x".repeat(50) })
    const config: Partial<PipelineConfig> = { narration_enabled: false }

    const result = await runNarrationAudio({
      supabase: makeSupabaseStub(),
      pipelineId: "p1",
      stageId: "s1",
      userId: "u1",
      plan,
      config,
    })

    expect(result.ok).toBe(true)
    expect(result.skipped).toBe(true)
    if (result.skipped) {
      expect(result.reason).toBe("narration_disabled")
    }
    expect(pipelineGenerateNarration).not.toHaveBeenCalled()
  })

  it("skips when Showrunner plan has no narration_script", async () => {
    const plan = makePlan(undefined)
    const config: Partial<PipelineConfig> = { narration_enabled: true }

    const result = await runNarrationAudio({
      supabase: makeSupabaseStub(),
      pipelineId: "p1",
      stageId: "s1",
      userId: "u1",
      plan,
      config,
    })

    expect(result.ok).toBe(true)
    expect(result.skipped).toBe(true)
    if (result.skipped) {
      expect(result.reason).toBe("no_script")
    }
    expect(pipelineGenerateNarration).not.toHaveBeenCalled()
  })

  it("happy path: calls pipelineGenerateNarration and returns the URL+duration", async () => {
    ;(pipelineGenerateNarration as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      jobId: "narr-job-1",
      assetId: "asset-narr-1",
      assetUrl: "https://r2/narration.mp3",
      audioDurationSec: 47.2,
      creditsSpent: 4,
    })

    const plan = makePlan({
      text: "In a world where the night never ends, one hero stood between us and the abyss.",
      voice_id: "ElevenLabs-Adam",
    })
    const config: Partial<PipelineConfig> = { narration_enabled: true }

    const result = await runNarrationAudio({
      supabase: makeSupabaseStub(),
      pipelineId: "p1",
      stageId: "s1",
      userId: "u1",
      plan,
      config,
    })

    expect(result.ok).toBe(true)
    expect(result.skipped).toBe(false)
    if (!result.skipped) {
      expect(result.narrationUrl).toBe("https://r2/narration.mp3")
      expect(result.narrationDurationSec).toBe(47.2)
      expect(result.narrationAssetId).toBe("asset-narr-1")
    }
    expect(pipelineGenerateNarration).toHaveBeenCalledWith(
      expect.objectContaining({
        pipelineId: "p1",
        userId: "u1",
        text: expect.stringContaining("In a world"),
        voiceId: "ElevenLabs-Adam",
      }),
    )
  })

  it("TTS failure throws — caller handles via failAndMarkTerminal", async () => {
    ;(pipelineGenerateNarration as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("elevenlabs: voice_id invalid"),
    )

    const plan = makePlan({ text: "x".repeat(50) })
    const config: Partial<PipelineConfig> = { narration_enabled: true }

    await expect(
      runNarrationAudio({
        supabase: makeSupabaseStub(),
        pipelineId: "p1",
        stageId: "s1",
        userId: "u1",
        plan,
        config,
      }),
    ).rejects.toThrow(/elevenlabs/)
  })

  it("treats empty-string narration_script.text the same as no script (defensive)", async () => {
    const plan = makePlan({ text: "   " })
    const config: Partial<PipelineConfig> = { narration_enabled: true }

    const result = await runNarrationAudio({
      supabase: makeSupabaseStub(),
      pipelineId: "p1",
      stageId: "s1",
      userId: "u1",
      plan,
      config,
    })

    expect(result.ok).toBe(true)
    expect(result.skipped).toBe(true)
    expect(pipelineGenerateNarration).not.toHaveBeenCalled()
  })
})
