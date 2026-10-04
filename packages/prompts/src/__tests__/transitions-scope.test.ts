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
const MATCH_CUT_BODY =
  "the last picture of the first shot and the first picture of the second share one shape, at the same " +
  "place and the same size in the frame. The camera holds that shape in place across the cut. On the ne" +
  "xt frame everything around the shape has changed while the shape itself stays put. The shot ends on " +
  "the second shot, fully resolved, with no flash frame or zoom between the two"
const MATCH_CUT_BASE = `match cut (${MATCH_CUT_BODY}; ${INSTANT_CUT_CLAUSE})`

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

  it("zoom-into-mouth never mentions 'the throat' (its body is pinned in the F5 block below)", () => {
    expect(getTransitionPromptHint("zoom-into-mouth")).not.toContain("throat")
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

describe("F4 bodies (2026-09-25 A/B: F4 arm B)", () => {
  // building-explosion and vehicle-explosion: the F4 drafts, tidied (first letter lower-cased, final
  // full stop dropped). Each rendered string below is byte-identical to the clause the winning take was
  // generated from.
  const F4_BODIES: Record<string, { term: string; body: string }> = {
    "building-explosion": {
      term: "building explosion",
      body:
        "the largest structure in the frame detonates in a massive fireball, and debris and dust plume outwar" +
        "d until they fill the whole picture. The camera stays where it is and the framing does not change. A" +
        "s the dust cloud clears, the second shot is revealed in its place. The shot ends on the second shot," +
        " clear and fully resolved, with no dust or debris left. The blast comes from that structure itself, " +
        "and the second shot appears only as the dust clears",
    },
    "vehicle-explosion": {
      term: "vehicle explosion",
      body:
        "a vehicle in the frame bursts into a violent explosion of fire and twisted metal, and the fireball b" +
        "illows toward the lens until orange flame fills the whole picture. The camera stays where it is and " +
        "the framing does not change. The flame gives way to thick smoke, and as the smoke parts the second s" +
        "hot is revealed. The shot ends on the second shot, clear and fully resolved, with no fire or smoke l" +
        "eft. The explosion comes from that vehicle itself, and the second shot appears only as the smoke par" +
        "ts",
    },
  }

  it.each(Object.keys(F4_BODIES))("%s renders `term (body)` at the tile-default levers", (id) => {
    const { term, body } = F4_BODIES[id]!
    expect(getTransitionPromptHint(id)).toBe(body)
    expect(composeTransitionHintFromConnections(id, [], [], {}, "full", { scope: "shot" })).toBe(`${term} (${body})`)
  })

  it.each(Object.keys(F4_BODIES))("%s at middle / short / natural", (id) => {
    const { term, body } = F4_BODIES[id]!
    expect(composeTransitionHintFromConnections(id, [], [], { position: "middle", duration: "short", intensity: "natural" })).toBe(
      `${term} (${body}), the transition occurs in the middle of the clip, lasting approximately 1 second, with natural timing`,
    )
  })
})

describe("F5 bodies (2026-09-25 A/B: F5 arm B)", () => {
  // zoom-into-book, pull-out-reveal, zoom-into-mouth, walk-through-door and mask-transition: the F5
  // drafts, tidied (first letter lower-cased, final full stop dropped). Each rendered string below is
  // byte-identical to the clause the winning take was generated from.
  const F5_BODIES: Record<string, { term: string; body: string }> = {
    "zoom-into-book": {
      term: "zoom into book",
      body:
        "the camera pushes down toward the illustrated page of an open book in the frame until the illustrati" +
        "on fills the whole picture. The camera travels in one smooth line, without turning or rolling. The d" +
        "rawn picture comes alive, gaining depth, light and movement, and becomes the second shot. The shot e" +
        "nds inside the second shot, real and fully resolved, with no paper, ink lines or page edges left. Th" +
        "e camera heads for the page from the start and goes into its illustration",
    },
    "pull-out-reveal": {
      term: "pull-back reveal",
      body:
        "the camera pulls straight back fast, and the whole first shot shrinks until its edges show as the bo" +
        "rder of a framed picture inside a larger space. The camera travels back in one smooth line, without " +
        "turning, tilting or rolling. The larger space around the picture is the second shot, and the first s" +
        "hot stays inside the picture. The shot ends on the second shot, with the first shot visible as a pic" +
        "ture within it. The first shot's image stays exactly the same as it shrinks, so it reads as the same" +
        " picture all along",
    },
    "zoom-into-mouth": {
      term: "zoom into mouth",
      body:
        "the camera pushes straight into the first subject's open mouth until the dark interior fills the who" +
        "le picture. The camera travels forward in one smooth line, without turning, tilting or rolling. It p" +
        "asses through the darkness, and the second shot emerges out of it. The shot ends inside the second s" +
        "hot, still and fully resolved, with no mouth left in view. The dark interior stays a plain darkness " +
        "the camera passes through",
    },
    "walk-through-door": {
      term: "walk through doorway",
      body:
        "the camera follows the first subject through a doorway in the frame, moving forward at the subject's" +
        " pace. The camera travels straight forward, without turning, tilting or rolling. On the far side of " +
        "the doorway the space is the second shot, a different place in different light. The shot ends in the" +
        " second shot, fully resolved, with the doorway behind the camera. The change of place happens at the" +
        " doorway itself, the moment the camera passes through it",
    },
    "mask-transition": {
      term: "mask transition",
      body:
        "a dark foreground shape sweeps across the lens and fills the frame with black. The camera keeps trav" +
        "elling forward through the black in one smooth line. It emerges from the darkness into the second sh" +
        "ot. The shot ends in the second shot, fully resolved, with no dark shape left. The dark shape passes" +
        " close to the lens and is gone once the second shot appears",
    },
  }

  it.each(Object.keys(F5_BODIES))("%s renders `term (body)` at the tile-default levers", (id) => {
    const { term, body } = F5_BODIES[id]!
    expect(getTransitionPromptHint(id)).toBe(body)
    expect(composeTransitionHintFromConnections(id, [], [], {}, "full", { scope: "shot" })).toBe(`${term} (${body})`)
  })

  it.each(Object.keys(F5_BODIES))("%s at middle / short / natural", (id) => {
    const { term, body } = F5_BODIES[id]!
    expect(composeTransitionHintFromConnections(id, [], [], { position: "middle", duration: "short", intensity: "natural" })).toBe(
      `${term} (${body}), the transition occurs in the middle of the clip, lasting approximately 1 second, with natural timing`,
    )
  })
})

describe("shockwave body (2026-09-25 rework: shockwave3 E1)", () => {
  // The E1 draft as tested: a flash bursts into a bright opaque ring that races past every edge, the ring
  // the one hard border between the shots. The rendered string at the tile default is byte-identical to
  // the clause the winning take was generated from.
  const TERM = "shockwave"
  const BODY =
    "a flash at the exact centre of the frame bursts into a sharp, bright ring that races past every edge" +
    " in a moment, trailing a smear of motion blur behind its rim and warping the picture as it goes. The" +
    " camera stays where it is and the picture stays level. The second shot shows only inside the ring an" +
    "d the first only outside it, with the bright ring as the one hard border and no blending anywhere"

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

describe("roll-transition body (2026-09-25 A/B: F6 arm B)", () => {
  // The F6 roll draft, tidied (first letter lower-cased, final full stop dropped): one full turn one way
  // that stops level, with no swing back. The rendered string at the tile default is byte-identical to
  // the clause the winning take was generated from. The other F6 rows keep today's text.
  const TERM = "camera roll transition"
  const BODY =
    "the picture rolls around its centre in one smooth, fast turn, blurred by the speed of the turn. The " +
    "camera stays in the same spot, turning only around its lens axis. During the turn the second shot ta" +
    "kes over, and the roll slows and stops with it level and upright. The shot ends on the second shot, " +
    "level, upright and still. The roll turns one way only and stops once, with no swing back"

  it("renders `term (body)` at the tile-default levers", () => {
    expect(getTransitionPromptHint("roll-transition")).toBe(BODY)
    expect(composeTransitionHintFromConnections("roll-transition", [], [], {}, "full", { scope: "shot" })).toBe(`${TERM} (${BODY})`)
  })

  it("at middle / short / natural", () => {
    expect(composeTransitionHintFromConnections("roll-transition", [], [], { position: "middle", duration: "short", intensity: "natural" })).toBe(
      `${TERM} (${BODY}), the transition occurs in the middle of the clip, lasting approximately 1 second, with natural timing`,
    )
  })
})

describe("time-lapse bodies (2026-09-24 A/B at full / long: descab3 row 26)", () => {
  // Day → night ships arm B, the audit body (B 5 > A 4). Night → day was a tie (A 4 · B 4), so the shorter
  // body stays: today's (179 characters against B's 220). Both rows keep their "fast-forward time-lapse
  // transition:" heading, which the renderer strips. Day → night's body has a colon of its own after a
  // 61-character lead-in; it is a description lead-in, not a heading, and the heading guard in
  // transitions-instant.test.ts still passes for it. The term + body is byte-identical to the clause the
  // winning take (d4546594) was generated from.
  const DN_TERM = "day-to-night time-lapse"
  const DN_BODY =
    "the same view with framing locked while hours pass in seconds: light and shadows sweep across the sc" +
    "ene, daylight warms to dusk and fades to night, lights come on, until the picture matches the end frame"
  const ND_TERM = "night-to-day time-lapse"
  const ND_BODY =
    "stars fade, the sky shifts from deep night through pre-dawn blue to golden sunrise, shadows sweep in r" +
    "everse, all while framing and camera position remain locked on the same scene"
  const HEADING = "fast-forward time-lapse transition: "

  it("day → night: the catalog hint keeps its heading and carries the B body", () => {
    expect(getTransitionPromptHint("fast-forward-day-night")).toBe(HEADING + DN_BODY)
  })

  it("day → night renders `term (body)` at the tile-default levers", () => {
    expect(composeTransitionHintFromConnections("fast-forward-day-night", [], [], {}, "full", { scope: "shot" })).toBe(
      `${DN_TERM} (${DN_BODY})`,
    )
  })

  it("day → night at full / long / natural (the levers the take was rendered at)", () => {
    expect(composeTransitionHintFromConnections("fast-forward-day-night", [], [], { position: "full", duration: "long", intensity: "natural" })).toBe(
      `${DN_TERM} (${DN_BODY}), ${FULL_CLAUSE}, lasting approximately 3 seconds, with natural timing`,
    )
  })

  it("day → night at middle / short / natural", () => {
    expect(composeTransitionHintFromConnections("fast-forward-day-night", [], [], { position: "middle", duration: "short", intensity: "natural" })).toBe(
      `${DN_TERM} (${DN_BODY}), the transition occurs in the middle of the clip, lasting approximately 1 second, with natural timing`,
    )
  })

  it("night → day keeps today's body", () => {
    expect(getTransitionPromptHint("fast-forward-night-day")).toBe(HEADING + ND_BODY)
    expect(composeTransitionHintFromConnections("fast-forward-night-day", [], [], {}, "full", { scope: "shot" })).toBe(
      `${ND_TERM} (${ND_BODY})`,
    )
  })
})

describe("zoom-into-mirror body (2026-10-03 redraft: mirror3 D2, liquid ripple)", () => {
  // The mirror3 D2 draft ("liquid ripple"), rated 4/5 against D1 3/5 and D3 2/5. It was tested already
  // tidied (lower-case start, no final full stop), so it ships exactly as the take was generated (job
  // 5821fa22): the rendered string at the tile default is byte-identical to the clause in that prompt.
  const TERM = "zoom into mirror"
  const BODY =
    "the camera pushes straight at a mirror in the frame. As the lens meets the glass, the mirror's " +
    "surface turns liquid and rings ripple out across the whole picture, and the camera keeps moving " +
    "forward through the rippling surface, out the far side into the second shot. Until the lens touches " +
    "the glass, the mirror keeps its own reflection. The shot ends in the second shot, still and fully " +
    "resolved, with no ripples left"

  it("renders `term (body)` at the tile-default levers", () => {
    expect(getTransitionPromptHint("zoom-into-mirror")).toBe(BODY)
    expect(composeTransitionHintFromConnections("zoom-into-mirror", [], [], {}, "full", { scope: "shot" })).toBe(`${TERM} (${BODY})`)
  })

  it("at middle / short / natural", () => {
    expect(composeTransitionHintFromConnections("zoom-into-mirror", [], [], { position: "middle", duration: "short", intensity: "natural" })).toBe(
      `${TERM} (${BODY}), the transition occurs in the middle of the clip, lasting approximately 1 second, with natural timing`,
    )
  })
})

describe("F8 cut bodies (2026-10-03 A/B: F8 arm B on snap-to-black, jump-match and match-cut)", () => {
  // Arm B, the F8 draft with the ship tidy (first letter lower-cased; the drafts carry no final full stop, so
  // the anti-blend sentence reads on after the body). Each is byte-identical to the body inside the prompt of
  // the take it was rated on: snap-to-black 03-B-t2 (2bcc8b81), jump-match 04-B-t1 (b9027a0a), match-cut
  // 07-B (4c6e3ecd). snap-to-black and match-cut keep their "<label>:" heading, which the renderer strips;
  // jump-match never had one. None of the three bodies contains a colon, so the heading guard in
  // transitions-instant.test.ts cannot match them, and no comma item equals its row's term. All three are
  // cuts: the cut sentence rides inside the parentheses, and duration and intensity are dropped.
  const ROWS = [
    {
      id: "snap-to-black",
      term: "snap to black",
      heading: "snap to black: ",
      body:
        "the first shot cuts straight to full black on a single frame. The camera holds its framing right up " +
        "to the cut. The frame stays pure black for a single beat, then the second shot cuts in at full brigh" +
        "tness on a single frame. The shot ends on the second shot, fully resolved",
    },
    {
      id: "jump-match",
      term: "match cut on a jump",
      heading: "",
      body:
        "the subject launches into a jump, and at the height of the leap the picture cuts to a new place. The" +
        " camera follows the arc of the jump at the same speed on both sides of the cut, and the subject stay" +
        "s at the same place in the frame. In the second shot the same jump carries on without a break, and t" +
        "he subject comes down and lands in the new place. The shot ends on the subject landed in the second " +
        "shot, fully resolved",
    },
    {
      id: "match-cut",
      term: "match cut",
      heading: "match cut: ",
      body:
        "the last picture of the first shot and the first picture of the second share one shape, at the same " +
        "place and the same size in the frame. The camera holds that shape in place across the cut. On the ne" +
        "xt frame everything around the shape has changed while the shape itself stays put. The shot ends on " +
        "the second shot, fully resolved, with no flash frame or zoom between the two",
    },
  ] as const

  it.each(ROWS)("$id: the catalog hint carries the new body (heading kept where the row had one)", ({ id, heading, body }) => {
    expect(getTransitionPromptHint(id)).toBe(heading + body)
  })

  it.each(ROWS)("$id renders `term (body; cut sentence)` at the tile-default levers", ({ id, term, body }) => {
    const clause = `${term} (${body}; ${INSTANT_CUT_CLAUSE})`
    expect(composeTransitionHintFromConnections(id, [], [], {}, "full", { scope: "shot" })).toBe(clause)
    expect(composeTransitionHintFromConnections(id, [], [], {}, "compact", { scope: "shot" })).toBe(clause)
    expect(composeTransitionHintFromConnections(id, [], [])).toBe(clause)
  })

  it.each(ROWS)("$id at middle / short / natural keeps only the position", ({ id, term, body }) => {
    const levers = { position: "middle", duration: "short", intensity: "natural" } as const
    expect(composeTransitionHintFromConnections(id, [], [], levers)).toBe(
      `${term} (${body}; ${INSTANT_CUT_CLAUSE}), the transition occurs in the middle of the clip`,
    )
    expect(composeTransitionHintFromConnections(id, [], [], levers, "full", { scope: "shot" })).toBe(
      `${term} (${body}; ${INSTANT_CUT_CLAUSE}), the transition occurs in the middle of this shot`,
    )
  })

  // The other F8 rows keep today's text (jump-cut's body changes in the 2026-10-04 block below).
  const KEPT: Record<string, string> = {
    "none":
      "no transition, hard cut, instantaneous switch from first shot to second shot",
    "smash-cut":
      "smash cut: an abrupt jarring transition between two visually or tonally contrasting shots with no fa" +
      "de, on a beat",
    "seamless-match":
      "hidden seamless transition: the camera motion, color palette, and on-screen motion at the end of the" +
      " first shot continue exactly across the cut into the second shot, so the boundary is invisible and t" +
      "he two shots feel like one unbroken take",
    "action-relay":
      "match cut on action: the subject exits the frame on a committed action — a stride, a throw, a turn —" +
      " and enters the new scene on the same beat continuing that movement at matched speed and direction, " +
      "so the action carries unbroken across the cut",
  }

  it.each(Object.entries(KEPT))("%s keeps today's text", (id, hint) => {
    expect(getTransitionPromptHint(id)).toBe(hint)
  })
})

describe("F9 time bodies (2026-10-03 A/B at full / long: F9 arm B on seasonal-shift and flashback)", () => {
  // Arm B, the F9 draft with the ship tidy (first letter lower-cased, no final full stop). Each is byte-identical to
  // the body inside the prompt of the take it was rated on: seasonal-shift 01-B (428e79c6) and flashback 02-B
  // (bc236b0c), both rendered at position full / duration long (the time-row rule), no intensity, scope shot. Both
  // rows keep their heading, which the renderer strips. Neither body contains a colon, so the heading guard in
  // transitions-instant.test.ts has nothing to match, and no comma item equals its row's term. weather-shift was a
  // tie (A 4 · B 4), so the shorter body stays: today's.
  const ROWS = [
    {
      id: "seasonal-shift",
      term: "seasonal time-lapse",
      heading: "accelerated seasonal time-lapse: ",
      body:
        "the same view races through the seasons in fast motion, from the season of the first shot to the sea" +
        "son of the second, as growing things bud, turn and fall and snow comes or goes. The camera stays whe" +
        "re it is and the framing does not change. The change flows continuously across the whole picture, ev" +
        "ery part moving on together, until the view matches the second shot. The shot ends on the second sho" +
        "t's season, still and fully resolved. Only the season changes, and the layout of the view stays exac" +
        "tly the same",
    },
    {
      id: "flashback",
      term: "flashback",
      heading: "brief flashback transition: ",
      body:
        "a soft warm wash spreads over the whole picture and a faint ripple drifts across it as the present m" +
        "oment fades. The camera stays where it is and the framing does not change. Through the ripple an ear" +
        "lier moment of the same subject comes into focus, like a memory. The shot ends on the remembered mom" +
        "ent, steady and fully resolved, with the ripple gone. The subject stays at the same place in the fra" +
        "me while the moment around it changes",
    },
  ] as const

  it.each(ROWS)("$id: the catalog hint keeps its heading and carries the B body", ({ id, heading, body }) => {
    expect(getTransitionPromptHint(id)).toBe(heading + body)
  })

  it.each(ROWS)("$id renders `term (body)` at the tile-default levers", ({ id, term, body }) => {
    expect(composeTransitionHintFromConnections(id, [], [], {}, "full", { scope: "shot" })).toBe(`${term} (${body})`)
  })

  it.each(ROWS)("$id at full / long in a shot window (the levers the take was rendered at)", ({ id, term, body }) => {
    expect(composeTransitionHintFromConnections(id, [], [], { position: "full", duration: "long" }, "full", { scope: "shot" })).toBe(
      `${term} (${body}), ${FULL_SHOT_CLAUSE}, lasting approximately 3 seconds`,
    )
  })

  it.each(ROWS)("$id at middle / short / natural", ({ id, term, body }) => {
    expect(composeTransitionHintFromConnections(id, [], [], { position: "middle", duration: "short", intensity: "natural" })).toBe(
      `${term} (${body}), the transition occurs in the middle of the clip, lasting approximately 1 second, with natural timing`,
    )
  })

  it("weather-shift keeps today's body", () => {
    const body =
      "same scene, framing locked — clear sky darkens to storm clouds, rain begins and intensifies then cle" +
      "ars, sun returns through breaking clouds"
    expect(getTransitionPromptHint("weather-shift")).toBe(`accelerated weather transition: ${body}`)
    expect(composeTransitionHintFromConnections("weather-shift", [], [], {}, "full", { scope: "shot" })).toBe(`weather time-lapse (${body})`)
  })
})

describe("F7 glitch and light bodies (2026-10-03 A/B: F7 arm B on channel-flip, display-wipe and color-invert)", () => {
  // Arm B, the F7 draft with the ship tidy (first letter lower-cased, final full stop dropped). Each is
  // byte-identical to the body inside the prompt of the take it was rated on: channel-flip 01-B (7f7829ec),
  // display-wipe 03-B (c66d59bc) and color-invert 04-B (18d66f83), all at the tile-default levers. None of the
  // three rows has a heading, none of the bodies contains a colon (so the heading guard in
  // transitions-instant.test.ts has nothing to match), and no comma item equals its row's term. The other F7
  // rows keep today's text.
  const ROWS = [
    {
      id: "channel-flip",
      term: "tv channel flip with static",
      body:
        "the whole picture breaks into a brief burst of black-and-white static, the image jumping and tearing" +
        " as if the channel were being changed. The camera stays where it is and the framing does not change." +
        " The static clears as quickly as it came, and the second shot snaps in, steady, like the next channe" +
        "l. The shot ends on the second shot, clean and fully resolved, with no static left. The static cover" +
        "s the whole frame, so the picture itself is what changes channel",
    },
    {
      id: "display-wipe",
      term: "compress into a screen and expand out",
      body:
        "the whole first shot shrinks toward the centre of the frame into a small glowing rectangle, then col" +
        "lapses to a bright line and a dot as if its power were cut. The camera stays where it is and the fra" +
        "ming does not change. From the dot a line snaps open and widens into a rectangle showing the second " +
        "shot, which grows until it fills the frame. The shot ends on the second shot, full frame and fully r" +
        "esolved, with no border or scanlines left. The picture itself shrinks and grows on a black field, wi" +
        "th the camera holding still throughout",
    },
    {
      id: "color-invert",
      term: "color invert flash",
      body:
        "the colours of the whole picture turn to their photographic negative in an instant. The camera stays" +
        " where it is and the framing does not change. The negative holds for a single beat, and when the col" +
        "ours snap back to normal the second shot is in place. The shot ends on the second shot in natural co" +
        "lour, fully resolved. The change of shot happens while the picture is in negative, and the picture s" +
        "tays upright and in place throughout",
    },
  ] as const

  it.each(ROWS)("$id: the catalog hint is the B body", ({ id, body }) => {
    expect(getTransitionPromptHint(id)).toBe(body)
  })

  it.each(ROWS)("$id renders `term (body)` at the tile-default levers", ({ id, term, body }) => {
    expect(composeTransitionHintFromConnections(id, [], [], {}, "full", { scope: "shot" })).toBe(`${term} (${body})`)
    expect(composeTransitionHintFromConnections(id, [], [], {}, "compact", { scope: "shot" })).toBe(`${term} (${body})`)
    expect(composeTransitionHintFromConnections(id, [], [])).toBe(`${term} (${body})`)
  })

  it.each(ROWS)("$id at middle / short / natural", ({ id, term, body }) => {
    expect(composeTransitionHintFromConnections(id, [], [], { position: "middle", duration: "short", intensity: "natural" })).toBe(
      `${term} (${body}), the transition occurs in the middle of the clip, lasting approximately 1 second, with natural timing`,
    )
  })
})

describe("Redrafted glitch bodies and the jump-cut negative sentence (2026-10-04: hologram-flicker D2, datamosh D1, jump-cut C)", () => {
  // Each body is byte-identical to the body inside the prompt of the take its tile shows, at the tile-default
  // levers: hologram-flicker from the F7 redraft's D2, a scan-line rebuild (17245f6b); datamosh from its D1,
  // blocks that tear loose and pile up into the second shot (a16f906b); jump-cut from the jump-cut retest's arm
  // C, today's body plus one negative sentence (2bfc4380). datamosh and jump-cut keep their "<label>:" heading,
  // which the renderer strips; hologram-flicker never had one. No body contains a colon, so the heading guard in
  // transitions-instant.test.ts cannot match them, and no comma item equals its row's term.
  const ROWS = [
    {
      id: "hologram-flicker",
      term: "hologram flicker",
      heading: "",
      body:
        "the first shot breaks into thin lines of cyan light that flicker out from the top down, leaving the " +
        "frame black. The camera stays where it is and the framing does not change. A bright scan line sweeps" +
        " down and draws the second shot behind it in flickering cyan lines that steady into natural colour. " +
        "The shot ends on the second shot, solid and fully resolved, with no scan lines left. The second shot" +
        " is drawn only on black, never over the first shot",
    },
    {
      id: "datamosh",
      term: "datamosh",
      heading: "datamosh transition: ",
      body:
        "the first shot's pixels tear loose in square compression blocks and slide sideways across the frame " +
        "in long smeared streaks. The camera stays where it is and the framing does not change. The blocks pi" +
        "le up into the shapes of the second shot, still in the first shot's colours, until the true colours " +
        "snap in block by block. The shot ends on the second shot, sharp and fully resolved, with no smears o" +
        "r blocks left. The smear covers the whole frame",
    },
  ] as const

  it.each(ROWS)("$id: the catalog hint carries the new body (heading kept where the row had one)", ({ id, heading, body }) => {
    expect(getTransitionPromptHint(id)).toBe(heading + body)
  })

  it.each(ROWS)("$id renders `term (body)` at the tile-default levers", ({ id, term, body }) => {
    expect(composeTransitionHintFromConnections(id, [], [], {}, "full", { scope: "shot" })).toBe(`${term} (${body})`)
    expect(composeTransitionHintFromConnections(id, [], [], {}, "compact", { scope: "shot" })).toBe(`${term} (${body})`)
    expect(composeTransitionHintFromConnections(id, [], [])).toBe(`${term} (${body})`)
  })

  it.each(ROWS)("$id at middle / short / natural", ({ id, term, body }) => {
    expect(composeTransitionHintFromConnections(id, [], [], { position: "middle", duration: "short", intensity: "natural" })).toBe(
      `${term} (${body}), the transition occurs in the middle of the clip, lasting approximately 1 second, with natural timing`,
    )
  })

  // jump-cut is a cut: the anti-blend sentence rides inside the parentheses after the body, and duration and
  // intensity are dropped. The new body has a semicolon of its own; the restatement dedupe splits on commas
  // only, so it is untouched, and the cut sentence still appears exactly once.
  const JUMP_CUT_BODY =
    "the framing, lens, and camera position stay identical across the cut while time skips abruptly forwa" +
    "rd, so the subject snaps to a new position inside what still reads as one continuous shot. No leap, " +
    "no run, no lunge and no motion blur between the two positions; the subject is in the old place on on" +
    "e frame and already in the new place on the next"
  const JUMP_CUT_CLAUSE = `jump cut (${JUMP_CUT_BODY}; ${INSTANT_CUT_CLAUSE})`

  it("jump-cut: the catalog hint carries the new body after its heading", () => {
    expect(getTransitionPromptHint("jump-cut")).toBe(`jump cut: ${JUMP_CUT_BODY}`)
  })

  it("jump-cut renders `term (body; cut sentence)` at the tile-default levers, the cut sentence once", () => {
    expect(composeTransitionHintFromConnections("jump-cut", [], [], {}, "full", { scope: "shot" })).toBe(JUMP_CUT_CLAUSE)
    expect(composeTransitionHintFromConnections("jump-cut", [], [], {}, "compact", { scope: "shot" })).toBe(JUMP_CUT_CLAUSE)
    expect(composeTransitionHintFromConnections("jump-cut", [], [])).toBe(JUMP_CUT_CLAUSE)
    expect(JUMP_CUT_CLAUSE.split(INSTANT_CUT_CLAUSE).length).toBe(2)
  })

  it("jump-cut at middle / short / natural keeps only the position", () => {
    const levers = { position: "middle", duration: "short", intensity: "natural" } as const
    expect(composeTransitionHintFromConnections("jump-cut", [], [], levers)).toBe(
      `${JUMP_CUT_CLAUSE}, the transition occurs in the middle of the clip`,
    )
    expect(composeTransitionHintFromConnections("jump-cut", [], [], levers, "full", { scope: "shot" })).toBe(
      `${JUMP_CUT_CLAUSE}, the transition occurs in the middle of this shot`,
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
