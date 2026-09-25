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

describe("F1 bodies — the subject becomes the material and reforms (2026-09-25 A/B, arm B won)", () => {
  // The approved drafts, tidied to read like every other row inside `term (…)`:
  // first letter lower-cased, final full stop dropped. Nothing else differs from the draft.
  const F1_BODIES: Record<string, { term: string; body: string }> = {
    "dissolve-to-mist": {
      term: "dissolve to mist",
      body:
        "the first subject loses its solid form and turns into a soft cloud of fine mist, starting at its " +
        "edges and working inward. The camera stays where it is and the framing does not change. The mist " +
        "drifts through the frame and thins until the first shot is gone, then gathers again at the same " +
        "place in the frame and condenses into the second subject as the second shot appears behind it. The " +
        "shot ends on the second subject, solid and fully resolved, with no mist left. The second subject " +
        "forms only out of the gathered mist",
    },
    "water-splash": {
      term: "water splash",
      body:
        "the first subject turns to water and collapses into a splashing cascade that spreads across the " +
        "lower part of the frame. The camera stays where it is and the framing does not change. The water " +
        "surges upward at the same place in the frame and takes the shape of the second subject, while the " +
        "second shot appears behind it as the spray falls away. The shot ends on the second subject, solid " +
        "and fully resolved, with no water left on it. The second subject forms only out of the rising water",
    },
    "pixelate-reform": {
      term: "pixelate and reform",
      body:
        "the first subject breaks into large square mosaic blocks, and the blocks scatter outward across the " +
        "frame. The camera stays where it is and the framing does not change. The blocks fly back, lock " +
        "together at the same place in the frame and sharpen into the second subject, while the second shot " +
        "appears behind them. The shot ends on the second subject, fully sharp, with no blocks left. Only the " +
        "subject turns into blocks; the surroundings change as the blocks clear",
    },
    "polygon-shatter": {
      term: "polygon shatter",
      body:
        "the first subject fractures into large opaque flat-shaded chunks, like the facets of a low-polygon " +
        "model, and the chunks burst outward in slow motion. The camera stays where it is and the framing " +
        "does not change. The chunks turn around mid-flight and fly back along clean straight paths, locking " +
        "together at the same place in the frame into the shape of the second subject, while the second shot " +
        "appears behind them. The shot ends on the second subject, solid and fully resolved, with no loose " +
        "chunks left. The chunks stay opaque and matte throughout, like painted blocks",
    },
  }

  it.each(Object.keys(F1_BODIES))("%s renders `term (body)` at the tile-default levers", (id) => {
    const { term, body } = F1_BODIES[id]!
    expect(getTransitionPromptHint(id)).toBe(body)
    expect(composeTransitionHintFromConnections(id, [], [], {}, "full", { scope: "shot" })).toBe(`${term} (${body})`)
  })

  it.each(Object.keys(F1_BODIES))("%s at middle / short / natural", (id) => {
    const { term, body } = F1_BODIES[id]!
    expect(composeTransitionHintFromConnections(id, [], [], { position: "middle", duration: "short", intensity: "natural" })).toBe(
      `${term} (${body}), the transition occurs in the middle of the clip, lasting approximately 1 second, with natural timing`,
    )
  })
})

describe("F2 + vortex bodies (2026-09-25 A/B: F2 arm B, vortex rework D2)", () => {
  // sand-storm, paint-splash and aurora-sweep: the F2 drafts, tidied (first letter lower-cased, final
  // full stop dropped). vortex-swirl: the rework's D2 body, as tested. Each rendered string below is
  // byte-identical to the clause the winning take was generated from.
  const F2_BODIES: Record<string, { term: string; body: string }> = {
    "sand-storm": {
      term: "sand storm",
      body:
        "a wall of opaque, swirling ochre sand sweeps in from one side of the frame and surges across it " +
        "until the whole picture is hidden in dust. The camera stays where it is and the framing does not " +
        "change. The dust then thins and sinks away toward the lower edge of the frame, revealing the second " +
        "shot behind it. The shot ends on the second shot, clear and fully resolved, with no dust left. The " +
        "first shot stays as it is until the sand covers it completely, and the second shot appears only as " +
        "the dust clears",
    },
    "paint-splash": {
      term: "paint splash",
      body:
        "vivid splashes of coloured paint fly across the frame in arcing streaks and pile over one another " +
        "until the whole picture is covered in wet paint. The camera stays where it is and the framing does " +
        "not change. The paint then gathers toward the centre of the frame and shrinks to nothing, uncovering" +
        " the second shot from the edges inward. The shot ends on the second shot, clean and fully resolved, " +
        "with no paint left. The paint lies on the surface of the picture itself, and the second shot appears" +
        " only where the paint has gone",
    },
    "aurora-sweep": {
      term: "aurora sweep",
      body:
        "a luminous curtain of green and violet aurora light ripples across the whole frame, and its bright " +
        "bands veil the first shot. The camera stays where it is and the framing does not change. As the " +
        "bands fade, the second shot is revealed behind them. The shot ends on the second shot, clear and " +
        "fully resolved, with no aurora light left. The aurora glows over the front of the picture, and the " +
        "second shot appears only as it fades",
    },
    "vortex-swirl": {
      term: "vortex swirl",
      body:
        "only the first subject twists, winding around its own centre like wrung cloth into a tight narrow " +
        "column at the same place in the frame, turning faster as it narrows, while the surroundings stay " +
        "upright and still. the camera is locked on a tripod head planted in one spot, holding the frame " +
        "level from start to finish. the column then unwinds in the same direction and opens into the shape " +
        "of the second subject, while the second shot appears around it. the shot ends on the second subject," +
        " solid and fully resolved, with nothing left turning. the twist stays inside the outline of the " +
        "subject, and the edges of the frame stay square and still",
    },
  }

  it.each(Object.keys(F2_BODIES))("%s renders `term (body)` at the tile-default levers", (id) => {
    const { term, body } = F2_BODIES[id]!
    expect(getTransitionPromptHint(id)).toBe(body)
    expect(composeTransitionHintFromConnections(id, [], [], {}, "full", { scope: "shot" })).toBe(`${term} (${body})`)
  })

  it.each(Object.keys(F2_BODIES))("%s at middle / short / natural", (id) => {
    const { term, body } = F2_BODIES[id]!
    expect(composeTransitionHintFromConnections(id, [], [], { position: "middle", duration: "short", intensity: "natural" })).toBe(
      `${term} (${body}), the transition occurs in the middle of the clip, lasting approximately 1 second, with natural timing`,
    )
  })
})

describe("F3 bodies (2026-09-25 A/B: F3 arm B)", () => {
  // sun-glare, lens-crack and lightning-flash: the F3 drafts, tidied (first letter lower-cased, final
  // full stop dropped). Each rendered string below is byte-identical to the clause the winning take was
  // generated from.
  const F3_BODIES: Record<string, { term: string; body: string }> = {
    "sun-glare": {
      term: "sun glare",
      body:
        "intense warm glare floods the lens from one corner of the frame, blooming and scattering flares unti" +
        "l the whole picture is washed out to a bright haze. The camera stays where it is and the framing doe" +
        "s not change. As the glare fades, the second shot emerges through the haze. The shot ends on the sec" +
        "ond shot, clear and fully resolved, with no glare left. The glare comes from the lens itself, and th" +
        "e second shot appears only as the haze clears",
    },
    "lens-crack": {
      term: "lens crack",
      body:
        "a hairline crack snaps diagonally across the lens and branches into a web of fracture lines that spr" +
        "eads over the whole picture. The camera stays where it is and the framing does not change. Seen thro" +
        "ugh the cracks, the first shot gives way to the second shot, and then the fracture lines fade away. " +
        "The shot ends on the second shot, clear and fully resolved, with no cracks left. The cracks form on " +
        "the lens itself, while everything behind them stays whole",
    },
    "lightning-flash": {
      term: "lightning strike",
      body:
        "a brilliant jagged bolt of lightning cracks across the frame and its flash turns the whole picture w" +
        "hite. The camera stays where it is and the framing does not change. As the flash dies away, the seco" +
        "nd shot is revealed in its place. The shot ends on the second shot, fully resolved, with no bolt or " +
        "flash left. The change happens inside the flash, and the second shot appears only as the white fades",
    },
  }

  it.each(Object.keys(F3_BODIES))("%s renders `term (body)` at the tile-default levers", (id) => {
    const { term, body } = F3_BODIES[id]!
    expect(getTransitionPromptHint(id)).toBe(body)
    expect(composeTransitionHintFromConnections(id, [], [], {}, "full", { scope: "shot" })).toBe(`${term} (${body})`)
  })

  it.each(Object.keys(F3_BODIES))("%s at middle / short / natural", (id) => {
    const { term, body } = F3_BODIES[id]!
    expect(composeTransitionHintFromConnections(id, [], [], { position: "middle", duration: "short", intensity: "natural" })).toBe(
      `${term} (${body}), the transition occurs in the middle of the clip, lasting approximately 1 second, with natural timing`,
    )
  })
})

describe("shockwave body (2026-09-25 rework: shockwave2 D2)", () => {
  // The D2 draft as tested: a bright opaque ring is the one hard border between the shots. The rendered
  // string at the tile default is byte-identical to the clause the winning take was generated from.
  const TERM = "shockwave"
  const BODY =
    "a sharp, bright ring bursts from the exact centre of the frame and grows fast until it passes every " +
    "edge, warping the picture along its rim. The camera stays where it is and the picture stays level. T" +
    "he second shot shows only inside the ring and the first only outside it, with the bright ring as the" +
    " one hard border and no blending anywhere"

  it("renders `term (body)` at the tile-default levers", () => {
    expect(getTransitionPromptHint("shockwave")).toBe(BODY)
    expect(composeTransitionHintFromConnections("shockwave", [], [], {}, "full", { scope: "shot" })).toBe(`${TERM} (${BODY})`)
  })

  it("at middle / short / natural", () => {
    expect(composeTransitionHintFromConnections("shockwave", [], [], { position: "middle", duration: "short", intensity: "natural" })).toBe(
      `${TERM} (${BODY}), the transition occurs in the middle of the clip, lasting approximately 1 second, with natural timing`,
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
