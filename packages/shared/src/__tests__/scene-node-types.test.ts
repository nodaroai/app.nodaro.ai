import { describe, it, expect } from "vitest"
import { ShotSpecSchema, MatchCutVerdictSchema } from "../scene-node-types.js"

// ─── minimal valid ShotSpec fixture ─────────────────────────────────────────
const baseShotSpec = {
  shot_id: "shot_01",
  camera: {
    shot_type: "wide" as const,
    angle: "eye_level" as const,
    motion: "static" as const,
  },
  shot_intensity_kind: "establishing_shot" as const,
  action: "Character walks through door",
  dialogue_line: null,
  duration_seconds: 3,
  motion_prompt: "Slow push forward",
  start_state: "Character at door",
  end_state: "Character inside room",
  continuity_with_previous: null,
  shot_intent: {
    needs_multishot_reference: false,
    is_loopable: false,
    needs_music_suppression: true,
    is_match_cut: true,
  },
  visual_keyframe_prompt: "Wide shot of character walking through a doorway",
}

// ─── A1: ShotSpec.accepted_match_cut_break ───────────────────────────────────

describe("ShotSpec.accepted_match_cut_break (Phase 1D.1 Method 7)", () => {
  it("accepts accepted_match_cut_break=true", () => {
    const result = ShotSpecSchema.safeParse({
      ...baseShotSpec,
      accepted_match_cut_break: true,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.accepted_match_cut_break).toBe(true)
    }
  })

  it("defaults to undefined when omitted", () => {
    const result = ShotSpecSchema.safeParse(baseShotSpec)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.accepted_match_cut_break).toBeUndefined()
    }
  })
})

// ─── A2: MatchCutVerdictSchema ────────────────────────────────────────────────

describe("MatchCutVerdictSchema (Phase 1D.1 Method 7)", () => {
  it("parses a valid match-cut verdict", () => {
    const verdict = {
      shot_pair: ["shot_01", "shot_02"] as [string, string],
      match_strength: "strong" as const,
      suggested_adjustments: "Align the door frame position in both shots.",
      checked_at: new Date().toISOString(),
    }
    const result = MatchCutVerdictSchema.safeParse(verdict)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.shot_pair).toEqual(["shot_01", "shot_02"])
      expect(result.data.match_strength).toBe("strong")
    }
  })

  it("rejects an invalid match_strength value", () => {
    const verdict = {
      shot_pair: ["shot_01", "shot_02"],
      match_strength: "excellent", // not in the enum
      suggested_adjustments: "Some suggestion",
      checked_at: new Date().toISOString(),
    }
    const result = MatchCutVerdictSchema.safeParse(verdict)
    expect(result.success).toBe(false)
  })
})
