import { describe, expect, it } from "vitest"
import {
  INSTANT_CUT_CLAUSE,
  TRANSITIONS,
  TRANSITION_POSITIONS,
  composeTransitionHintFromConnections,
  getTransitionPromptHint,
} from "../transitions.js"
import { CHARACTER_FX_INTENSITIES } from "../character-fx.js"

/**
 * Transition wording round 2 (2026-09-24, from the transition description A/B):
 *   - `aging` and `zoom-into-mouth` carry new bodies;
 *   - L1: a cut with position `full` renders no position clause;
 *   - L5: a hint folded into one shot's time window says "of this shot"
 *     (and a non-cut's `full` "spans this entire shot").
 */

const INSTANT_IDS = TRANSITIONS.filter((t) => t.instant).map((t) => t.id)
const NON_INSTANT_IDS = TRANSITIONS.filter((t) => !t.instant && t.id !== "auto").map((t) => t.id)
const FULL_CLAUSE = "the transition spans the entire clip"
const FULL_SHOT_CLAUSE = "the transition spans this entire shot"
const MATCH_CUT_BASE =
  "match cut (the final composition of the first shot matches the opening composition of the second shot " +
  "in shape, color, and motion, so the cut feels like a visual rhyme; " + INSTANT_CUT_CLAUSE + ")"

describe("approved row bodies", () => {
  it("aging", () => {
    expect(getTransitionPromptHint("aging")).toBe(
      "accelerated aging transition: the subject visibly ages forward - fine lines deepen into wrinkles, " +
        "hair greys to silver, posture settles - while the framing stays unchanged",
    )
    expect(composeTransitionHintFromConnections("aging", [], [], { position: "middle", duration: "short", intensity: "natural" })).toBe(
      "accelerated aging (the subject visibly ages forward - fine lines deepen into wrinkles, hair greys to silver, " +
        "posture settles - while the framing stays unchanged), the transition occurs in the middle of the clip, " +
        "lasting approximately 1 second, with natural timing",
    )
  })

  it("freeze-frame-jump (stays a timed transition, not a cut)", () => {
    expect(getTransitionPromptHint("freeze-frame-jump")).toBe(
      "freeze-frame transition: all motion stops mid-action and the picture holds still for a beat; only then does it " +
        "jump to the same view hours or days later, everything in new positions, and motion resumes",
    )
    expect(composeTransitionHintFromConnections("freeze-frame-jump", [], [], { position: "middle", duration: "short", intensity: "natural" })).toBe(
      "freeze-frame time jump (all motion stops mid-action and the picture holds still for a beat; only then does it " +
        "jump to the same view hours or days later, everything in new positions, and motion resumes), " +
        "the transition occurs in the middle of the clip, lasting approximately 1 second, with natural timing",
    )
  })

  it("rewind (the prompted in-shot rewind; timed, not a cut)", () => {
    expect(composeTransitionHintFromConnections("rewind", [], [], { position: "middle", duration: "short", intensity: "natural" })).toBe(
      "reverse-motion rewind (reverse motion: the actions just seen are undone exactly as they happened, in reverse " +
        "order and at the same pace, the subject retracing each step to where it began, ending on the end frame), " +
        "the transition occurs in the middle of the clip, lasting approximately 1 second, with natural timing",
    )
  })

  it("zoom-into-mouth drops only 'the throat'", () => {
    expect(getTransitionPromptHint("zoom-into-mouth")).toBe(
      "the camera pushes into the subject's open mouth, the dark interior fills the frame, and the camera passes " +
        "through into the new scene which materialises as if emerging from inside the body",
    )
  })
})

describe("L1 — a cut spans nothing, so `full` adds no clause", () => {
  it.each(INSTANT_IDS)("%s + full renders no position clause", (id) => {
    const out = composeTransitionHintFromConnections(id, [], [], { position: "full", duration: "short", intensity: "natural" })
    expect(out).not.toContain("spans")
    expect(out).toBe(composeTransitionHintFromConnections(id, [], []))
  })

  it("match cut + full is the fragment alone", () => {
    expect(composeTransitionHintFromConnections("match-cut", [], [], { position: "full" })).toBe(MATCH_CUT_BASE)
  })

  it.each(["start", "middle", "end"] as const)("a cut keeps its %s clause", (position) => {
    const clause = TRANSITION_POSITIONS.find((p) => p.id === position)!.promptHint
    expect(composeTransitionHintFromConnections("match-cut", [], [], { position })).toBe(`${MATCH_CUT_BASE}, ${clause}`)
  })

  it.each(NON_INSTANT_IDS)("non-cut %s keeps the full clause", (id) => {
    expect(composeTransitionHintFromConnections(id, [], [], { position: "full" })).toContain(`, ${FULL_CLAUSE}`)
  })

  it("a mixed pick (cut + non-cut) keeps the full clause", () => {
    expect(
      composeTransitionHintFromConnections(["match-cut", "cross-dissolve"], [], [], { position: "full" }),
    ).toMatch(new RegExp(`, ${FULL_CLAUSE}$`))
  })

  it("two cuts together still drop it", () => {
    expect(
      composeTransitionHintFromConnections(["match-cut", "smash-cut"], [], [], { position: "full" }),
    ).not.toContain("spans")
  })
})

describe("L5 — scope: shot says 'of this shot'", () => {
  const window = { scope: "shot" } as const

  it.each([
    ["start", "the transition occurs at the opening of this shot"],
    ["middle", "the transition occurs in the middle of this shot"],
    ["end", "the transition occurs at the end of this shot"],
  ] as const)("%s in a shot window", (position, clause) => {
    const out = composeTransitionHintFromConnections("whip-pan", [], [], { position }, "full", window)
    expect(out).toMatch(new RegExp(`, ${clause}$`))
    expect(out).not.toContain("of the clip")
  })

  it("every non-auto position clause actually changes in a shot window (guard against a reword)", () => {
    for (const p of TRANSITION_POSITIONS.filter((p) => ["start", "middle", "end"].includes(p.id))) {
      expect(p.promptHint).toContain(" of the clip")
    }
    expect(FULL_CLAUSE).toContain(" the entire clip")
    for (const p of TRANSITION_POSITIONS.filter((p) => p.id !== "auto")) {
      const out = composeTransitionHintFromConnections("whip-pan", [], [], { position: p.id }, "full", window)
      expect(out).not.toContain("clip")
    }
  })

  it("full in a shot window spans this entire shot (non-cut) and is dropped (cut)", () => {
    expect(composeTransitionHintFromConnections("whip-pan", [], [], { position: "full" }, "full", window)).toMatch(
      new RegExp(`, ${FULL_SHOT_CLAUSE}$`),
    )
    expect(composeTransitionHintFromConnections("match-cut", [], [], { position: "full" }, "full", window)).toBe(MATCH_CUT_BASE)
  })

  it.each(NON_INSTANT_IDS)("non-cut %s + full: shot scope spans this entire shot, default scope the entire clip", (id) => {
    const shot = composeTransitionHintFromConnections(id, [], [], { position: "full" }, "full", window)
    const clip = composeTransitionHintFromConnections(id, [], [], { position: "full" })
    expect(shot).toBe(clip.replace(FULL_CLAUSE, FULL_SHOT_CLAUSE))
    expect(clip).toContain(`, ${FULL_CLAUSE}`)
  })

  it("a cut in a shot window", () => {
    expect(composeTransitionHintFromConnections("match-cut", [], [], { position: "middle" }, "full", window)).toBe(
      `${MATCH_CUT_BASE}, the transition occurs in the middle of this shot`,
    )
  })

  it.each(TRANSITIONS.map((t) => t.id))("%s: no scope and scope clip read 'of the clip', unchanged", (id) => {
    const timing = { position: "middle", duration: "short", intensity: "natural" } as const
    const plain = composeTransitionHintFromConnections(id, [], [], timing)
    expect(composeTransitionHintFromConnections(id, [], [], timing, "full", { scope: "clip" })).toBe(plain)
    if (plain) expect(plain).toContain("in the middle of the clip")
  })
})

describe("intensity natural reads 'with natural timing' (transitions only)", () => {
  it("renders on a non-cut, never 'unhurried'", () => {
    expect(composeTransitionHintFromConnections("whip-pan", [], [], { intensity: "natural" })).toMatch(/, with natural timing$/)
    for (const id of NON_INSTANT_IDS) {
      expect(composeTransitionHintFromConnections(id, [], [], { intensity: "natural" })).not.toContain("unhurried")
    }
  })

  it("is still dropped on a cut", () => {
    expect(composeTransitionHintFromConnections("match-cut", [], [], { intensity: "natural" })).toBe(MATCH_CUT_BASE)
  })

  it("character-fx keeps its own 'with natural unhurried timing'", () => {
    expect(CHARACTER_FX_INTENSITIES.find((o) => o.id === "natural")!.promptHint).toBe("with natural unhurried timing")
  })
})
