import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// SPEECH_LENGTH_PRICING_ENABLED, read at call time by the estimator: off (today's
// arithmetic) for every test but the flag-on describe at the end.
const flag = vi.hoisted(() => ({ on: false }))
vi.mock("@/lib/config.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/config.js")>()
  return { ...orig, speechLengthPricingEnabled: () => flag.on }
})
// The REAL price table (getChargedPriceTable / chargedCredits) over no
// model_pricing rows and no markup, so every price is STATIC_CREDIT_COSTS.
vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: () => ({ select: () => ({ order: () => ({ range: async () => ({ data: [], error: null }) }) }) }) },
}))
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: vi.fn().mockResolvedValue({ cost_markup_percent: 0 }) }))
// Mock path matches what `../credits.js` (the SUT) imports, NOT relative to
// this test file's own location — same convention as the sibling
// `services/__tests__/pipeline-generate-*.test.ts` suites. Only the single
// lookup is stubbed; the table is the real one.
vi.mock("../../billing/credits.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../billing/credits.js")>()
  return { ...orig, getModelCreditCostFromDB: vi.fn() }
})

import { getModelCreditCostFromDB, STATIC_CREDIT_COSTS } from "../../billing/credits.js"
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
  "suno-v6": 3, // pipeline-level Suno identifier runMusicTimeline reserves (DEFAULT_SUNO_MODEL)
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
  /** Characters per dialogue line (default: a short label). */
  lineLength?: number
}) {
  const { sceneIndex, shotCountHint = 1, durationSeconds = 5, dialogueLines = 0, lineLength } = overrides
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
      line: lineLength === undefined ? `Scene ${sceneIndex} line ${i + 1}` : "a".repeat(lineLength),
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
    // 300 (baseline) + 40 (music) + 30 (editor) + 30 (final merge) + 50 (cohesion)
    //   + 20cr × max(5, ceil(30/4)=8) shots (video critic) = 610
    expect(result.breakdown.pipelineUpfront).toBe(610)

    const expectedTotal = Object.values(result.breakdown).reduce((sum, credits) => sum + credits, 0)
    expect(result.totalCredits).toBe(expectedTotal)
    // The other lines come from MOCK_CREDIT_COSTS, which is deliberately frozen
    // at its own fixed values — only the pipelineUpfront line tracks real code.
    expect(result.totalCredits).toBe(610 + 6 + 66 + 8 + 3)
  })

  it("zeroes the music line (and skips the Suno lookup) when config.music_enabled is false", async () => {
    const result = await estimateSeededPipelineCredits({} as never, {
      plan: makeSixScenePlan(),
      config: { music_enabled: false, video_model: "kling-turbo" },
    })

    expect(result.breakdown.music).toBe(0)
    expect(getModelCreditCostFromDB).not.toHaveBeenCalledWith("suno-v6")
    // Same as above minus the 40cr music allocation: 610 - 40 = 570
    expect(result.breakdown.pipelineUpfront).toBe(570)
    expect(result.totalCredits).toBe(570 + 6 + 66 + 8 + 0)
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

// Seam 3 (decided 2026-10-06): scene-internal-pipeline runs ONE text-to-speech
// job per dialogue line (ShowrunnerPlanSchema caps a line at 200 characters), so
// every line is its own job at the floor. The estimate is therefore the SUM of
// per-line prices through the one estimator — never the price of the joined text.
describe("estimateSeededPipelineCredits — speech by length while the flag is on", () => {
  beforeEach(() => {
    flag.on = true
  })
  afterEach(() => {
    flag.on = false
  })

  it("sums one floor-priced job per line on turbo's unit row — not the joined text's started hundreds", async () => {
    // Three scenes (the schema's minimum), 10 lines of 150 characters in all.
    const plan = {
      ...makeSixScenePlan(),
      scenes: [
        makeScene({ sceneIndex: 1, dialogueLines: 4, lineLength: 150 }),
        makeScene({ sceneIndex: 2, dialogueLines: 3, lineLength: 150 }),
        makeScene({ sceneIndex: 3, dialogueLines: 3, lineLength: 150 }),
      ],
    }
    const result = await estimateSeededPipelineCredits({} as never, { plan, config: { music_enabled: false, video_model: "kling-turbo" } })
    const unit = STATIC_CREDIT_COSTS["elevenlabs-turbo:per-100-chars"]!
    // 10 lines × 8 units × 2 = 160; the joined 1,500 characters would be 15 × 2 = 30.
    expect(result.breakdown.speech).toBe(10 * 8 * unit)
    expect(result.breakdown.speech).toBe(160)
    // The flat row is not consulted on this branch.
    expect(getModelCreditCostFromDB).not.toHaveBeenCalledWith("elevenlabs-turbo")
    // The other lines are untouched by the flag.
    expect(result.breakdown.keyframes).toBe(3)
    expect(result.breakdown.animation).toBe(3 * 11)
  })

  it("a plan with no dialogue has a zero speech line and reads no speech price", async () => {
    const plan = { ...makeSixScenePlan(), scenes: [makeScene({ sceneIndex: 1 }), makeScene({ sceneIndex: 2 }), makeScene({ sceneIndex: 3 })] }
    const result = await estimateSeededPipelineCredits({} as never, { plan, config: { music_enabled: false, video_model: "kling-turbo" } })
    expect(result.breakdown.speech).toBe(0)
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
