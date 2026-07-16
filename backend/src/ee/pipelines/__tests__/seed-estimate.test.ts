import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock path matches what `../credits.js` (the SUT) imports, NOT relative to
// this test file's own location — same convention as the sibling
// `services/__tests__/pipeline-generate-*.test.ts` suites.
vi.mock("../../billing/credits.js", () => ({
  getModelCreditCostFromDB: vi.fn(),
}))

import { getModelCreditCostFromDB } from "../../billing/credits.js"
import { estimateSeededPipelineCredits, estimateSceneAnimationCredits } from "../credits.js"

// Mirrors the real STATIC_CREDIT_COSTS entries (ee/billing/credits.ts) for
// the identifiers this estimator is expected to resolve. Values are copied
// as fixed test constants (not imported) so this test doesn't silently drift
// if the real pricing table changes — a real repricing SHOULD change what
// the real resolver returns, not this mock.
const MOCK_CREDIT_COSTS: Record<string, number> = {
  "nano-banana": 1, // default keyframe image model
  "kling-turbo:5s": 11, // default video model, snapped to the 5s tier
  "kling-turbo:10s": 21, // same model, snapped to the 10s tier
  "elevenlabs-turbo": 2, // fixed TTS identifier (no config override exists)
  "suno-v5_5": 3, // pipeline-level Suno identifier runMusicTimeline reserves
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getModelCreditCostFromDB).mockImplementation(async (modelIdentifier: string) => {
    const creditCost = MOCK_CREDIT_COSTS[modelIdentifier]
    if (creditCost === undefined) {
      throw new Error(`estimateSeededPipelineCredits queried an unmocked identifier: "${modelIdentifier}"`)
    }
    return { creditCost, isEnabled: true, tierRestriction: null }
  })
})

// ─── Fixture builders ───────────────────────────────────────────────────────

function makeScene(overrides: {
  sceneIndex: number
  shotCountHint?: number
  durationSeconds?: number
  dialogueLines?: number
}) {
  const { sceneIndex, shotCountHint = 1, durationSeconds = 5, dialogueLines = 0 } = overrides
  return {
    scene_index: sceneIndex,
    description: `Scene ${sceneIndex}`,
    emotional_beat: "setup" as const,
    duration_seconds: durationSeconds,
    cast_keys: [],
    location_key: "loc_main",
    object_keys: [],
    dialogue: Array.from({ length: dialogueLines }, (_, i) => ({
      cast_key: "hero",
      line: `Scene ${sceneIndex} line ${i + 1}`,
    })),
    narration: null,
    continuity_from_prev: "hard_cut" as const,
    shot_count_hint: shotCountHint,
  }
}

/** 6 scenes / 1 shot each / 4 dialogue lines (scenes 1-4), 30s total. */
function makeSixScenePlan() {
  return {
    title: "Test Film",
    logline: "A test film for the seeded-run estimator.",
    target_duration_seconds: 30,
    format: "short_film" as const,
    output_resolution: "720p" as const,
    language: "en",
    genre: "drama" as const,
    tone: ["hopeful" as const],
    cast: [],
    locations: [],
    objects: [],
    scenes: [
      makeScene({ sceneIndex: 1, dialogueLines: 1 }),
      makeScene({ sceneIndex: 2, dialogueLines: 1 }),
      makeScene({ sceneIndex: 3, dialogueLines: 1 }),
      makeScene({ sceneIndex: 4, dialogueLines: 1 }),
      makeScene({ sceneIndex: 5 }),
      makeScene({ sceneIndex: 6 }),
    ],
    beats: [],
    has_narrator: false,
    narrator_profile: null,
    music_plan: { mood: "hopeful", bpm_target: 120, genre_hints: ["orchestral"] },
    global_style: {
      visual_style: "cinematic",
      color_palette: "warm",
      lighting: "natural",
      camera_language: "handheld",
    },
    total_duration_seconds: 30,
    estimated_scene_count: 6,
    warnings: [],
  }
}

describe("estimateSeededPipelineCredits", () => {
  it("computes a full breakdown for a 6-scene / 1-shot / 4-dialogue-line / music-on plan", async () => {
    const result = await estimateSeededPipelineCredits({} as never, {
      plan: makeSixScenePlan(),
      config: { music_enabled: true, video_model: "kling-turbo" },
    })

    expect(Object.keys(result.breakdown).sort()).toEqual(
      ["animation", "keyframes", "music", "pipelineUpfront", "speech"].sort(),
    )

    // 6 shots (shot_count_hint summed) × nano-banana (1cr default image model)
    expect(result.breakdown.keyframes).toBe(6 * 1)
    // 6 shots × kling-turbo:5s (11cr) — each scene's 5s duration / 1 shot = 5s/shot
    expect(result.breakdown.animation).toBe(6 * 11)
    // 4 dialogue lines × elevenlabs-turbo (2cr)
    expect(result.breakdown.speech).toBe(4 * 2)
    // pipeline-level Suno track
    expect(result.breakdown.music).toBe(3)
    // estimateUpfrontCredits(auto, 30s, music on, first_last default):
    // 30 (baseline) + 4 (music) + 3 (editor) + 3 (final merge) + 5 (cohesion)
    //   + 2cr × max(5, ceil(30/4)=8) shots (video critic) = 61
    expect(result.breakdown.pipelineUpfront).toBe(61)

    const expectedTotal = Object.values(result.breakdown).reduce((sum, credits) => sum + credits, 0)
    expect(result.totalCredits).toBe(expectedTotal)
    expect(result.totalCredits).toBe(61 + 6 + 66 + 8 + 3)
  })

  it("zeroes the music line (and skips the Suno lookup) when config.music_enabled is false", async () => {
    const result = await estimateSeededPipelineCredits({} as never, {
      plan: makeSixScenePlan(),
      config: { music_enabled: false, video_model: "kling-turbo" },
    })

    expect(result.breakdown.music).toBe(0)
    expect(getModelCreditCostFromDB).not.toHaveBeenCalledWith("suno-v5_5")
    // Same as above minus the 4cr music allocation: 61 - 4 = 57
    expect(result.breakdown.pipelineUpfront).toBe(57)
    expect(result.totalCredits).toBe(57 + 6 + 66 + 8 + 0)
  })

  it("sums shot_count_hint (not scene count) for keyframes and animation", async () => {
    const plan = {
      ...makeSixScenePlan(),
      scenes: [
        makeScene({ sceneIndex: 1, shotCountHint: 2, durationSeconds: 10 }), // 5s/shot
        makeScene({ sceneIndex: 2, shotCountHint: 3, durationSeconds: 15 }), // 5s/shot
        makeScene({ sceneIndex: 3, shotCountHint: 1, durationSeconds: 5 }), // 5s/shot
      ],
    }

    const result = await estimateSeededPipelineCredits({} as never, {
      plan,
      config: { video_model: "kling-turbo" },
    })

    // 3 scenes but 6 total shots (2 + 3 + 1) — must NOT be read as "3 keyframes".
    expect(result.breakdown.keyframes).toBe(6 * 1)
    expect(result.breakdown.animation).toBe(6 * 11)
  })

  it("defaults image_model/video_model when config omits them entirely", async () => {
    const result = await estimateSeededPipelineCredits({} as never, {
      plan: makeSixScenePlan(),
      config: {},
    })

    expect(getModelCreditCostFromDB).toHaveBeenCalledWith("nano-banana")
    expect(getModelCreditCostFromDB).toHaveBeenCalledWith("kling-turbo:5s")
  })
})

describe("estimateSceneAnimationCredits", () => {
  // Regression for a reviewer-caught divide-by-zero: `duration_seconds /
  // shot_count_hint` is `Infinity` when shot_count_hint is 0, which would
  // otherwise be handed to `buildVideoCreditModelIdentifier` and throw.
  // `ShowrunnerPlanSchema` currently enforces shot_count_hint >= 1 (so this
  // can't happen via the validated `estimateSeededPipelineCredits(plan, ...)`
  // path today), but the guard is unconditional defense-in-depth — exercised
  // directly here, bypassing plan validation entirely, exactly because a
  // real `ShowrunnerPlanSchema.parse` call would reject a 0 before this
  // function's own code ever ran.
  it("contributes 0 credits and does not throw for a scene with shot_count_hint: 0", async () => {
    const credits = await estimateSceneAnimationCredits(
      { duration_seconds: 5, shot_count_hint: 0 },
      "kling-turbo",
    )

    expect(credits).toBe(0)
    expect(getModelCreditCostFromDB).not.toHaveBeenCalled()
  })

  it("still prices a normal scene (sanity check around the guard)", async () => {
    const credits = await estimateSceneAnimationCredits(
      { duration_seconds: 5, shot_count_hint: 1 },
      "kling-turbo",
    )

    expect(credits).toBe(11)
    expect(getModelCreditCostFromDB).toHaveBeenCalledWith("kling-turbo:5s")
  })
})
