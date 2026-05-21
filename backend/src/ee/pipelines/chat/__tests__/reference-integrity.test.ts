import { describe, it, expect } from "vitest"
import type { ShowrunnerPlan } from "@nodaro/shared"
import { checkReferenceIntegrity } from "../reference-integrity.js"

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
        role: "antagonist",
        has_dialogue: false,
        voice_profile: "",
        angle_count_hint: 3,
        expression_set_hint: ["neutral"],
        visual_description: "",
      },
    ],
    locations: [
      {
        key: "kitchen",
        name: "Kitchen",
        visual_description: "k",
        variants_needed: [],
      },
      {
        key: "garage",
        name: "Garage",
        visual_description: "g",
        variants_needed: [],
      },
    ],
    objects: [
      {
        key: "knife",
        name: "Knife",
        visual_description: "k",
        narrative_significance: "ns",
      },
    ],
    scenes: [
      {
        scene_index: 1,
        description: "s1",
        duration_seconds: 5,
        cast_keys: ["alice"],
        location_key: "kitchen",
        object_keys: ["knife"],
        dialogue: [],
        narration: null,
        emotional_beat: "setup",
        shot_count_hint: 1,
        continuity_from_prev: "hard_cut",
      },
      {
        scene_index: 2,
        description: "s2",
        duration_seconds: 10,
        cast_keys: ["alice", "bob"],
        location_key: "garage",
        object_keys: [],
        dialogue: [{ line: "Hi.", cast_key: "alice" }],
        narration: null,
        emotional_beat: "rising",
        shot_count_hint: 2,
        continuity_from_prev: "match_last_frame",
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
    total_duration_seconds: 15,
    estimated_scene_count: 2,
    warnings: [],
  } as ShowrunnerPlan
}

describe("checkReferenceIntegrity", () => {
  it("ok=true when no entries removed", () => {
    const r = checkReferenceIntegrity(basePlan(), basePlan())
    expect(r.ok).toBe(true)
  })

  it("ok=true when removed entry has NO remaining refs", () => {
    const before = basePlan()
    const after = basePlan()
    // bob is in scene 2's cast_keys — remove that reference too so the removal is clean.
    after.cast = after.cast.filter((c) => c.key !== "bob")
    after.scenes[1]!.cast_keys = after.scenes[1]!.cast_keys.filter((k) => k !== "bob")
    const r = checkReferenceIntegrity(before, after)
    expect(r.ok).toBe(true)
  })

  it("ok=false when removed cast still in scenes[*].cast_keys", () => {
    const before = basePlan()
    const after = basePlan()
    after.cast = after.cast.filter((c) => c.key !== "alice")
    const r = checkReferenceIntegrity(before, after)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.manifest).toBe("cast")
      expect(r.removed_key).toBe("alice")
      // alice referenced in scene 1 cast_keys[0] and scene 2 cast_keys[0] + dialogue[0].cast_key
      expect(r.hint).toContain("alice")
      expect(r.hint).toContain("scene")
    }
  })

  it("ok=false when removed cast still in scenes[*].dialogue[*].cast_key (but not in cast_keys)", () => {
    const before = basePlan()
    const after = basePlan()
    after.cast = after.cast.filter((c) => c.key !== "alice")
    // Remove alice from cast_keys but leave the dialogue.cast_key reference
    after.scenes[0]!.cast_keys = []
    after.scenes[1]!.cast_keys = after.scenes[1]!.cast_keys.filter((k) => k !== "alice")
    const r = checkReferenceIntegrity(before, after)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.manifest).toBe("cast")
      expect(r.remaining_refs[2]).toContain("dialogue[0].cast_key")
    }
  })

  it("ok=false when removed location still in scenes[*].location_key", () => {
    const before = basePlan()
    const after = basePlan()
    after.locations = after.locations.filter((l) => l.key !== "kitchen")
    const r = checkReferenceIntegrity(before, after)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.manifest).toBe("locations")
      expect(r.removed_key).toBe("kitchen")
      expect(r.remaining_refs[1]).toContain("location_key")
    }
  })

  it("ok=false when removed object still in scenes[*].object_keys", () => {
    const before = basePlan()
    const after = basePlan()
    after.objects = after.objects.filter((o) => o.key !== "knife")
    const r = checkReferenceIntegrity(before, after)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.manifest).toBe("objects")
      expect(r.removed_key).toBe("knife")
      expect(r.remaining_refs[1]).toContain("object_keys[0]")
    }
  })

  it("returns the FIRST conflict in cast→locations→objects order", () => {
    const before = basePlan()
    const after = basePlan()
    after.cast = after.cast.filter((c) => c.key !== "alice") // conflict
    after.locations = after.locations.filter((l) => l.key !== "kitchen") // also conflict
    const r = checkReferenceIntegrity(before, after)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.manifest).toBe("cast")
  })
})
