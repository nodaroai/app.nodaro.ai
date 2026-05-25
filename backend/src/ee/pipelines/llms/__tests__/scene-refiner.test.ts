/**
 * Phase 2 (granular-pipeline-control spec) — Scene Refiner tests.
 *
 * Covers the helper's contract: scene-index range check (no-LLM-call short
 * circuit), LLM-call dispatch, force-corrected scene_index, roster-ref
 * validation, and LLM throw propagation.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { ShowrunnerPlan } from "@nodaro/shared"

// Mock callLLM — return whatever the test sets; default is a passthrough
// of a valid SceneSpec the test crafts inline.
vi.mock("../call-llm.js", () => ({
  callLLM: vi.fn(),
}))

import { runSceneRefiner } from "../scene-refiner.js"
import { callLLM } from "../call-llm.js"

type SceneSpec = ShowrunnerPlan["scenes"][number]

// ─── Fixtures ────────────────────────────────────────────────────────────────

function basePlan(): ShowrunnerPlan {
  return {
    title: "T",
    logline: "L",
    target_duration_seconds: 30,
    format: "short_film",
    output_resolution: "1080p",
    language: "en",
    genre: "drama",
    tone: ["intimate"],
    cast: [
      {
        key: "alice",
        name: "Alice",
        role: "protagonist",
        has_dialogue: true,
        voice_profile: "v",
        angle_count_hint: 5,
        expression_set_hint: ["neutral"],
        visual_description: "",
      },
      {
        key: "bob",
        name: "Bob",
        role: "supporting",
        has_dialogue: false,
        voice_profile: "",
        angle_count_hint: 3,
        expression_set_hint: ["neutral"],
        visual_description: "",
      },
    ],
    locations: [
      { key: "kitchen", name: "Kitchen", visual_description: "k", variants_needed: [] },
    ],
    objects: [
      {
        key: "letter",
        name: "Letter",
        visual_description: "yellow envelope",
        narrative_significance: "central artifact",
      },
    ],
    scenes: [
      {
        scene_index: 1,
        description: "s1",
        duration_seconds: 10,
        cast_keys: ["alice"],
        location_key: "kitchen",
        object_keys: [],
        dialogue: [],
        narration: null,
        emotional_beat: "setup",
        shot_count_hint: 1,
        continuity_from_prev: "hard_cut",
      },
      {
        scene_index: 2,
        description: "s2 — to be regenerated",
        duration_seconds: 10,
        cast_keys: ["alice"],
        location_key: "kitchen",
        object_keys: ["letter"],
        dialogue: [],
        narration: null,
        emotional_beat: "rising",
        shot_count_hint: 1,
        continuity_from_prev: "hard_cut",
      },
      {
        scene_index: 3,
        description: "s3",
        duration_seconds: 10,
        cast_keys: ["alice", "bob"],
        location_key: "kitchen",
        object_keys: [],
        dialogue: [],
        narration: null,
        emotional_beat: "release",
        shot_count_hint: 1,
        continuity_from_prev: "hard_cut",
      },
    ],
    beats: [],
    has_narrator: false,
    narrator_profile: null,
    music_plan: { mood: "m", bpm_target: 100, genre_hints: [] },
    global_style: {
      visual_style: "v",
      color_palette: "p",
      lighting: "l",
      camera_language: "c",
    },
    total_duration_seconds: 30,
    estimated_scene_count: 3,
    warnings: [],
  } as ShowrunnerPlan
}

function validRefinedScene(overrides?: Partial<SceneSpec>): SceneSpec {
  return {
    scene_index: 2,
    description: "s2 refined — more tense, hands gripping the letter tightly",
    duration_seconds: 10,
    cast_keys: ["alice"],
    location_key: "kitchen",
    object_keys: ["letter"],
    dialogue: [],
    narration: null,
    emotional_beat: "rising",
    shot_count_hint: 2,
    continuity_from_prev: "match_last_frame",
    ...overrides,
  } as SceneSpec
}

function mockCallLLMReturning(scene: SceneSpec): void {
  ;(callLLM as ReturnType<typeof vi.fn>).mockResolvedValue({
    output: scene,
    llmCallId: "llm-call-1",
    costUsd: 0.02,
    inputTokens: 3000,
    outputTokens: 500,
  })
}

const baseArgs = (overrides?: { sceneIndex?: number; feedback?: string }) =>
  ({
    supabase: {} as never, // not consulted — callLLM is mocked
    pipelineId: "pipeline-1",
    stageId: "stage-1",
    userId: "user-1",
    plan: basePlan(),
    sceneIndex: overrides?.sceneIndex ?? 1,
    feedback: overrides?.feedback ?? "make it more tense",
  }) as Parameters<typeof runSceneRefiner>[0]

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => vi.clearAllMocks())

describe("runSceneRefiner — happy path", () => {
  it("returns the refined scene when LLM emits a valid SceneSpec", async () => {
    mockCallLLMReturning(validRefinedScene())
    const result = await runSceneRefiner(baseArgs())
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.newScene.description).toMatch(/more tense/i)
      expect(result.newScene.location_key).toBe("kitchen")
      expect(result.newScene.cast_keys).toEqual(["alice"])
    }
    expect(callLLM).toHaveBeenCalledTimes(1)
  })

  it("passes the full plan, target scene, and adjacent scenes in the user prompt", async () => {
    mockCallLLMReturning(validRefinedScene())
    await runSceneRefiner(baseArgs({ sceneIndex: 1, feedback: "shorter" }))
    const callArgs = (callLLM as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(callArgs.userPrompt).toContain("TARGET SCENE INDEX: 1")
    expect(callArgs.userPrompt).toContain("USER FEEDBACK")
    expect(callArgs.userPrompt).toContain("shorter")
    expect(callArgs.userPrompt).toContain("Previous scene")
    expect(callArgs.userPrompt).toContain("Next scene")
  })

  it("notes 'none — this is the first scene' when refining scene index 0", async () => {
    mockCallLLMReturning(validRefinedScene({ scene_index: 1 }))
    await runSceneRefiner(baseArgs({ sceneIndex: 0 }))
    const callArgs = (callLLM as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(callArgs.userPrompt).toContain("none — this is the first scene")
  })

  it("notes 'none — this is the last scene' when refining the last scene", async () => {
    mockCallLLMReturning(validRefinedScene({ scene_index: 3 }))
    await runSceneRefiner(baseArgs({ sceneIndex: 2 }))
    const callArgs = (callLLM as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(callArgs.userPrompt).toContain("none — this is the last scene")
  })
})

describe("runSceneRefiner — scene_index out of range", () => {
  it("returns scene_index_out_of_range and does NOT call the LLM (sceneIndex too high)", async () => {
    const result = await runSceneRefiner(baseArgs({ sceneIndex: 99 }))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe("scene_index_out_of_range")
      expect((result as { detail: { sceneIndex: number; sceneCount: number } }).detail).toEqual({
        sceneIndex: 99,
        sceneCount: 3,
      })
    }
    expect(callLLM).not.toHaveBeenCalled()
  })

  it("returns scene_index_out_of_range for negative sceneIndex (no LLM call)", async () => {
    const result = await runSceneRefiner(baseArgs({ sceneIndex: -1 }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("scene_index_out_of_range")
    expect(callLLM).not.toHaveBeenCalled()
  })
})

describe("runSceneRefiner — roster_ref_invalid", () => {
  it("rejects when the LLM emits a cast_key not in the roster", async () => {
    mockCallLLMReturning(validRefinedScene({ cast_keys: ["alice", "ghost"] }))
    const result = await runSceneRefiner(baseArgs())
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe("roster_ref_invalid")
      expect((result as { detail: { invalid_cast_keys?: string[] } }).detail.invalid_cast_keys).toEqual(["ghost"])
    }
  })

  it("rejects when the LLM emits a location_key not in the roster", async () => {
    mockCallLLMReturning(validRefinedScene({ location_key: "balcony" }))
    const result = await runSceneRefiner(baseArgs())
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe("roster_ref_invalid")
      expect((result as { detail: { invalid_location_key?: string } }).detail.invalid_location_key).toBe(
        "balcony",
      )
    }
  })

  it("rejects when the LLM emits an object_key not in the roster", async () => {
    mockCallLLMReturning(validRefinedScene({ object_keys: ["letter", "knife"] }))
    const result = await runSceneRefiner(baseArgs())
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe("roster_ref_invalid")
      expect((result as { detail: { invalid_object_keys?: string[] } }).detail.invalid_object_keys).toEqual([
        "knife",
      ])
    }
  })

  it("collects ALL invalid refs across cast + location + object in one verdict", async () => {
    mockCallLLMReturning(
      validRefinedScene({
        cast_keys: ["ghost"],
        location_key: "void",
        object_keys: ["nothing"],
      }),
    )
    const result = await runSceneRefiner(baseArgs())
    expect(result.ok).toBe(false)
    if (!result.ok && result.reason === "roster_ref_invalid") {
      expect(result.detail.invalid_cast_keys).toEqual(["ghost"])
      expect(result.detail.invalid_location_key).toBe("void")
      expect(result.detail.invalid_object_keys).toEqual(["nothing"])
    }
  })
})

describe("runSceneRefiner — scene_index force-correct", () => {
  it("overwrites the LLM's scene_index with (sceneIndex + 1) when it disagrees", async () => {
    // Schema is 1-based (min 1). args.sceneIndex=1 (0-based) → scene_index should be 2.
    // Mock LLM emits 99 — we expect helper to overwrite to 2.
    mockCallLLMReturning(validRefinedScene({ scene_index: 99 }))
    const result = await runSceneRefiner(baseArgs({ sceneIndex: 1 }))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.newScene.scene_index).toBe(2)
  })
})

describe("runSceneRefiner — LLM error propagation", () => {
  it("rethrows when callLLM rejects (route translates to 502 llm_unavailable)", async () => {
    ;(callLLM as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("anthropic 503"))
    await expect(runSceneRefiner(baseArgs())).rejects.toThrow("anthropic 503")
  })
})
