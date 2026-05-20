import { describe, it, expect } from "vitest"
import { validateObjects } from "../pipeline-validation"
import type { ShowrunnerPlan } from "../pipeline-types"

function makePlan(overrides: Partial<ShowrunnerPlan> = {}): ShowrunnerPlan {
  return {
    title: "T", logline: "L", target_duration_seconds: 30, format: "short_film",
    output_resolution: "1080p", language: "en", genre: "drama", tone: ["intimate"],
    cast: [], locations: [], objects: [], scenes: [],
    beats: [], has_narrator: false, narrator_profile: null,
    music_plan: { mood: "m", bpm_target: 100, genre_hints: [] },
    global_style: { visual_style: "v", color_palette: "p", lighting: "l", camera_language: "c" },
    total_duration_seconds: 30, estimated_scene_count: 1, warnings: [],
    ...overrides,
  } as ShowrunnerPlan
}

function scene(scene_index: number, object_keys: string[] = []) {
  return {
    scene_index, description: "d", emotional_beat: "neutral",
    duration_seconds: 5, cast_keys: [], location_key: "loc1",
    object_keys, dialogue: [], narration: null,
    continuity_from_prev: "hard_cut", shot_count_hint: 1,
  } as const
}

describe("validateObjects", () => {
  it("returns ok=true when no objects + no scenes reference any", () => {
    const plan = makePlan()
    const r = validateObjects(plan.objects, plan)
    expect(r.ok).toBe(true)
    expect(r.verdict).toBe("pass")
    expect(r.issues).toEqual([])
  })

  it("flags duplicate_key as blocking", () => {
    const plan = makePlan({
      objects: [
        { key: "ring", name: "Ring A", visual_description: "v", narrative_significance: "s" },
        { key: "ring", name: "Ring B", visual_description: "v", narrative_significance: "s" },
      ],
      scenes: [scene(1, ["ring"]) as any],
    })
    const r = validateObjects(plan.objects, plan)
    expect(r.ok).toBe(false)
    expect(r.verdict).toBe("fail")
    const dup = r.issues.find((i) => i.type === "duplicate_key")
    expect(dup).toBeDefined()
    expect(dup!.severity).toBe("blocking")
  })

  it("flags empty_significance as blocking (whitespace counts as empty)", () => {
    const plan = makePlan({
      objects: [
        { key: "k1", name: "n", visual_description: "v", narrative_significance: "   " },
      ],
      scenes: [scene(1, ["k1"]) as any],
    })
    const r = validateObjects(plan.objects, plan)
    expect(r.ok).toBe(false)
    expect(r.issues.find((i) => i.type === "empty_significance")?.severity).toBe("blocking")
  })

  it("flags unresolved_scene_object_ref as blocking", () => {
    const plan = makePlan({
      objects: [{ key: "k1", name: "n", visual_description: "v", narrative_significance: "s" }],
      scenes: [scene(1, ["unknown_key"]) as any],
    })
    const r = validateObjects(plan.objects, plan)
    expect(r.ok).toBe(false)
    const issue = r.issues.find((i) => i.type === "unresolved_scene_object_ref")
    expect(issue?.severity).toBe("blocking")
    expect(issue?.scene_index).toBe(1)
  })

  it("flags orphan_object as warning only (not blocking)", () => {
    const plan = makePlan({
      objects: [{ key: "k1", name: "n", visual_description: "v", narrative_significance: "s" }],
      scenes: [scene(1, []) as any],
    })
    const r = validateObjects(plan.objects, plan)
    expect(r.ok).toBe(true)
    expect(r.verdict).toBe("pass")
    expect(r.issues.find((i) => i.type === "orphan_object")?.severity).toBe("warning")
  })

  it("aggregates: blocking + warning => ok=false (blocking wins)", () => {
    const plan = makePlan({
      objects: [
        { key: "k1", name: "n", visual_description: "v", narrative_significance: "" },
        { key: "k2", name: "n", visual_description: "v", narrative_significance: "s" },
      ],
      scenes: [scene(1, ["k1"]) as any],
    })
    const r = validateObjects(plan.objects, plan)
    expect(r.ok).toBe(false)
  })
})
