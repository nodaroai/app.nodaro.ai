import { describe, it, expect } from "vitest"
import { getParameterPromptHint } from "../parameter-prompt-hint.js"
import { PARAMETER_NODE_TYPES, getParameterValue } from "@nodaro/shared/catalogs"
import { ACTION_FX } from "../action-fx.js"
import { getCharacterMotionPromptHint, getCharacterMotionTerm } from "../character-motion.js"

describe("getParameterPromptHint — action-fx", () => {
  it("returns the catalog hint for a single id", () => {
    const first = ACTION_FX[0]
    const result = getParameterPromptHint({ id: "n1", type: "action-fx", data: { actionFx: first.id } })
    expect(result).toBe(first.promptHint)
  })

  it("returns comma-joined hints for two ids", () => {
    const a = ACTION_FX[0]
    const b = ACTION_FX[1]
    const result = getParameterPromptHint({ id: "n1", type: "action-fx", data: { actionFx: [a.id, b.id] } })
    expect(result).toBe(`${a.promptHint}, ${b.promptHint}`)
  })

  it("returns empty string when no actionFx is set", () => {
    const result = getParameterPromptHint({ id: "n1", type: "action-fx", data: {} })
    expect(result).toBe("")
  })
})

describe("getParameterPromptHint — Sound parameter nodes", () => {
  it("dispatches music-genre to buildMusicGenreHints", () => {
    const node = { id: "n1", type: "music-genre", data: { genre: "electronic", subgenre: "synthwave", era: "1980s" } }
    const out = getParameterPromptHint(node)
    expect(out).toContain("1980s")
    expect(out).toContain("synthwave")
  })

  it("dispatches music-mood to buildMusicMoodHints", () => {
    const node = { id: "n1", type: "music-mood", data: { energy: "high", emotion: "triumphant", vibe: "cinematic" } }
    expect(getParameterPromptHint(node)).toContain("triumphant")
  })

  it("dispatches instrumentation to buildInstrumentationHints", () => {
    const node = { id: "n1", type: "instrumentation", data: { instruments: ["piano"], production: "polished" } }
    expect(getParameterPromptHint(node)).toContain("piano")
  })

  it("dispatches voice-character to buildVoiceCharacterHints", () => {
    const node = { id: "n1", type: "voice-character", data: { age: "middle-aged", gender: "male", timbre: "warm" } }
    expect(getParameterPromptHint(node)).toContain("warm")
  })

  it("dispatches voice-delivery to buildVoiceDeliveryHints", () => {
    const node = { id: "n1", type: "voice-delivery", data: { pace: "measured", emotion: "reassuring" } }
    expect(getParameterPromptHint(node)).toContain("reassuring")
  })

  it("returns empty string for sound nodes with empty data", () => {
    expect(getParameterPromptHint({ id: "n1", type: "music-genre", data: {} })).toBe("")
    expect(getParameterPromptHint({ id: "n1", type: "voice-character", data: {} })).toBe("")
  })
})

describe("PARAMETER_NODE_TYPES — Sound nodes", () => {
  it("includes all 5 new sound types", () => {
    for (const t of ["music-genre", "music-mood", "instrumentation", "voice-character", "voice-delivery"]) {
      expect(PARAMETER_NODE_TYPES.has(t)).toBe(true)
    }
  })
})

describe("getParameterValue — Sound nodes", () => {
  it("returns first set sub-field per node", () => {
    expect(getParameterValue({ subgenre: "synthwave", genre: "electronic" }, "music-genre")).toBe("synthwave")
    expect(getParameterValue({ genre: "rock" }, "music-genre")).toBe("rock")
    expect(getParameterValue({ emotion: "happy", energy: "high" }, "music-mood")).toBe("happy")
    expect(getParameterValue({ instruments: ["piano"] }, "instrumentation")).toBe("piano")
    expect(getParameterValue({ timbre: "warm" }, "voice-character")).toBe("warm")
    expect(getParameterValue({ archetype: "mentor" }, "voice-delivery")).toBe("mentor")
  })
})

describe("getParameterPromptHint — transition", () => {
  it("returns bare hint when no context, no timing, no connections", () => {
    const r = getParameterPromptHint({
      id: "n1",
      type: "transition",
      data: { transition: "cross-dissolve" },
    } as any)
    expect(r.length).toBeGreaterThan(0)
    expect(r).toContain("cross-dissolve")
  })

  it("returns empty for 'auto' / empty string", () => {
    expect(getParameterPromptHint({ id: "n1", type: "transition", data: { transition: "auto" } } as any)).toBe("")
    expect(getParameterPromptHint({ id: "n1", type: "transition", data: { transition: "" } } as any)).toBe("")
  })

  it("composes timing clauses from data fields", () => {
    const r = getParameterPromptHint({
      id: "n1",
      type: "transition",
      data: { transition: "cross-dissolve", position: "end", duration: "medium" },
    } as any)
    expect(r).toContain("the transition occurs at the end of the clip")
    expect(r).toContain("lasting approximately 2 seconds")
  })

  it("multi-pick array data shape works", () => {
    const r = getParameterPromptHint({
      id: "n1",
      type: "transition",
      data: { transition: ["smash-cut", "white-flash"] },
    } as any)
    expect(r).toMatch(/smash/i)
    expect(r).toMatch(/flash/i)
  })

  it("composes start/end from graph context with startState/endState edges", () => {
    const ctx = {
      nodes: [
        { id: "n1", type: "transition", data: { transition: "fast-forward-day-night" } },
        { id: "n2", type: "tone",       data: { tone: "warm golden morning light" } },
        { id: "n3", type: "tone",       data: { tone: "deep blue moonlit night" } },
      ],
      edges: [
        { source: "n2", target: "n1", targetHandle: "startState", sourceHandle: "out" },
        { source: "n3", target: "n1", targetHandle: "endState",   sourceHandle: "out" },
      ],
    }
    const r = getParameterPromptHint(ctx.nodes[0] as any, ctx as any)
    expect(r).toMatch(/starting from .+morning/i)
    expect(r).toMatch(/ending at .+night/)
  })
})

describe("getParameterPromptHint — character-fx", () => {
  it("returns bare hint with no target / no timing / no ctx", () => {
    const r = getParameterPromptHint({
      id: "n1",
      type: "character-fx",
      data: { characterFx: "werewolf" },
    } as any)
    expect(r).toContain("the subject")
    expect(r).toContain("werewolf")
  })

  it("substitutes target name from upstream character ref via 'target' handle", () => {
    const ctx = {
      nodes: [
        { id: "n1", type: "character-fx", data: { characterFx: "werewolf" } },
        { id: "n2", type: "character",   data: { characterName: "Aria Voss" } },
      ],
      edges: [
        { source: "n2", target: "n1", targetHandle: "target", sourceHandle: "characterRef" },
      ],
    }
    const r = getParameterPromptHint(ctx.nodes[0] as any, ctx as any)
    expect(r).toContain("Aria Voss")
    expect(r).not.toContain("the subject")
  })

  it("multi-pick array works with target substitution", () => {
    const ctx = {
      nodes: [
        { id: "n1", type: "character-fx", data: { characterFx: ["werewolf", "fire-breathe"] } },
        { id: "n2", type: "character",   data: { characterName: "Aria" } },
      ],
      edges: [
        { source: "n2", target: "n1", targetHandle: "target", sourceHandle: "characterRef" },
      ],
    }
    const r = getParameterPromptHint(ctx.nodes[0] as any, ctx as any)
    expect(r).toContain("Aria")
    expect(r).toContain(", and ")
    expect(r).not.toContain("the subject")
  })

  it("ignores edges not on 'target' handle", () => {
    const ctx = {
      nodes: [
        { id: "n1", type: "character-fx", data: { characterFx: "werewolf" } },
        { id: "n2", type: "character",   data: { characterName: "Ignored" } },
      ],
      edges: [
        { source: "n2", target: "n1", targetHandle: "startState", sourceHandle: "characterRef" },
      ],
    }
    const r = getParameterPromptHint(ctx.nodes[0] as any, ctx as any)
    expect(r).not.toContain("Ignored")
    expect(r).toContain("the subject")  // un-substituted
  })

  it("falls through field candidates (faceName, objectName, locationName)", () => {
    for (const [field, name] of [
      ["faceName",     "Some Face"],
      ["objectName",   "An Object"],
      ["locationName", "Some Place"],
    ] as const) {
      const ctx = {
        nodes: [
          { id: "n1", type: "character-fx", data: { characterFx: "werewolf" } },
          { id: "n2", type: "face",        data: { [field]: name } },
        ],
        edges: [{ source: "n2", target: "n1", targetHandle: "target", sourceHandle: "out" }],
      }
      const r = getParameterPromptHint(ctx.nodes[0] as any, ctx as any)
      expect(r).toContain(name)
    }
  })
})

describe("getParameterPromptHint — furniture", () => {
  it("returns a prompt fragment with the furniture label + description", () => {
    const hint = getParameterPromptHint({ id: "n1", type: "furniture", data: { furniture: "sofa" } })
    expect(hint).toMatch(/including a .*/)
    expect(hint.length).toBeGreaterThan(0)
  })

  it("returns empty string for unknown furniture id", () => {
    const hint = getParameterPromptHint({ id: "n1", type: "furniture", data: { furniture: "nonexistent-furniture" } })
    expect(hint).toBe("")
  })

  it("returns empty string when furniture field is missing", () => {
    const hint = getParameterPromptHint({ id: "n1", type: "furniture", data: {} })
    expect(hint).toBe("")
  })
})

// Regression: the graph-aware nodes (camera-motion / transition / character-fx)
// branch before the main switch and must STILL honor the user's preText/postText
// (the config-panel preview promises they're injected). They previously returned
// the bare compose* result and dropped custom text at execution.
describe("getParameterPromptHint — preText/postText for graph-aware nodes", () => {
  it("camera-motion wraps preText/postText around the motion clause", () => {
    const out = getParameterPromptHint({
      id: "n1",
      type: "camera-motion",
      data: { cameraMotion: "dolly-in", preText: "BEFORE", postText: "AFTER" },
    })
    expect(out.startsWith("BEFORE")).toBe(true)
    expect(out.endsWith("AFTER")).toBe(true)
  })

  it("camera-motion still injects custom text when no motion is set (empty base)", () => {
    const out = getParameterPromptHint({
      id: "n1",
      type: "camera-motion",
      data: { preText: "ONLY PRE" },
    })
    expect(out).toContain("ONLY PRE")
  })

  it("transition includes preText and postText", () => {
    const out = getParameterPromptHint({
      id: "n1",
      type: "transition",
      data: { transition: "crossfade", preText: "PRE_T", postText: "POST_T" },
    })
    expect(out).toContain("PRE_T")
    expect(out).toContain("POST_T")
  })

  it("character-fx includes preText and postText", () => {
    const out = getParameterPromptHint({
      id: "n1",
      type: "character-fx",
      data: { characterFx: "glow", preText: "PRE_FX", postText: "POST_FX" },
    })
    expect(out).toContain("PRE_FX")
    expect(out).toContain("POST_FX")
  })
})

describe("getParameterPromptHint — character-motion", () => {
  const ctx = {
    nodes: [
      { id: "c1", type: "character", data: { characterName: "Mira" } },
      { id: "c2", type: "character", data: { characterName: "Theo" } },
    ],
    edges: [
      { source: "c1", target: "n1", targetHandle: "target" },
      { source: "c2", target: "n1", targetHandle: "partner" },
    ],
  }

  it("composes the ordered sequence with target and partner names from the graph", () => {
    const out = getParameterPromptHint(
      { id: "n1", type: "character-motion", data: { characterMotion: ["wave-hello", "hug-partner"] } },
      ctx,
    )
    expect(out).toBe(
      `${getCharacterMotionPromptHint("wave-hello").replace(/\bthe subject\b/g, "Mira")}, then ${getCharacterMotionPromptHint("hug-partner").replace(/\bthe subject\b/g, "Mira").replace(/\bthe partner\b/g, "Theo")}`,
    )
  })

  it("reads position and pace and wraps preText / postText", () => {
    const out = getParameterPromptHint({
      id: "n1",
      type: "character-motion",
      data: { characterMotion: "wave-hello", position: "end", pace: "fast", preText: "PRE_M", postText: "POST_M" },
    })
    expect(out.startsWith("PRE_M")).toBe(true)
    expect(out.endsWith("POST_M")).toBe(true)
    expect(out).toContain("the movement happens in the closing moments of the clip")
    expect(out).toContain("performed quickly")
  })

  it("compact mode names the target by prefix and the partner in the term", () => {
    const out = getParameterPromptHint(
      { id: "n1", type: "character-motion", data: { characterMotion: "hug-partner", hintMode: "compact" } },
      ctx,
    )
    expect(out).toBe(`Mira: ${getCharacterMotionTerm("hug-partner").replace(/\bthe partner\b/g, "Theo")}`)
  })

  it("ignores edges on other handles", () => {
    const out = getParameterPromptHint(
      { id: "n1", type: "character-motion", data: { characterMotion: "wave-hello" } },
      { nodes: ctx.nodes, edges: [{ source: "c1", target: "n1", targetHandle: "in" }] },
    )
    expect(out).toBe(getCharacterMotionPromptHint("wave-hello"))
  })
})

// D9 option (b)-lite: a ref wired into `target` OR `partner` that describes a
// minor (structured `person` age, or an age in its free-text description)
// makes the composer drop every adultOnly move. wave-hello is neutral;
// kiss-partner is adultOnly.
describe("getParameterPromptHint — character-motion minor-age floor", () => {
  const MINOR = { age: "age-child" }
  const ADULT = { age: "age-30s" }
  const motion = { id: "n1", type: "character-motion", data: { characterMotion: ["wave-hello", "kiss-partner"] } }
  const wave = (target: string) => getCharacterMotionPromptHint("wave-hello").replace(/\bthe subject\b/g, target)
  // kiss-partner names the partner twice. A wired name repeats; the unwired
  // fallback is introduced once and referred back to after that.
  const kiss = (target: string, ...partner: readonly string[]) => {
    let i = 0
    return getCharacterMotionPromptHint("kiss-partner")
      .replace(/\bthe subject\b/g, target)
      .replace(/\bthe partner\b/g, () => partner[Math.min(i++, partner.length - 1)]!)
  }

  it("a minor wired to target drops the adult-only move and keeps the neutral one", () => {
    const out = getParameterPromptHint(motion, {
      nodes: [{ id: "c1", type: "character", data: { characterName: "Mira", person: MINOR } }],
      edges: [{ source: "c1", target: "n1", targetHandle: "target" }],
    })
    expect(out).toBe(wave("Mira"))
    expect(out).not.toMatch(/kiss/i)
  })

  it("an adult wired to target keeps both moves", () => {
    const out = getParameterPromptHint(motion, {
      nodes: [{ id: "c1", type: "character", data: { characterName: "Mira", person: ADULT } }],
      edges: [{ source: "c1", target: "n1", targetHandle: "target" }],
    })
    expect(out).toBe(`${wave("Mira")}, then ${kiss("Mira", "another person", "that same person")}`)
    expect(out).toMatch(/kiss/)
  })

  it("a minor wired only to partner also drops the adult-only move", () => {
    const out = getParameterPromptHint(motion, {
      nodes: [
        { id: "c1", type: "character", data: { characterName: "Mira", person: ADULT } },
        { id: "c2", type: "character", data: { characterName: "Theo", person: MINOR } },
      ],
      edges: [
        { source: "c1", target: "n1", targetHandle: "target" },
        { source: "c2", target: "n1", targetHandle: "partner" },
      ],
    })
    expect(out).toBe(wave("Mira"))
    expect(out).not.toMatch(/kiss/i)
  })

  it("a minor described only in free text drops the adult-only move", () => {
    for (const field of ["description", "seedPrompt", "canonicalDescription"] as const) {
      const out = getParameterPromptHint(motion, {
        nodes: [{ id: "c1", type: "character", data: { characterName: "Mira", [field]: "a 12-year-old girl in a red coat" } }],
        edges: [{ source: "c1", target: "n1", targetHandle: "target" }],
      })
      expect(out, field).toBe(wave("Mira"))
    }
  })

  it("an unnamed ref that describes a minor still floors", () => {
    const out = getParameterPromptHint(motion, {
      nodes: [{ id: "c1", type: "character", data: { person: MINOR } }],
      edges: [{ source: "c1", target: "n1", targetHandle: "target" }],
    })
    expect(out).toBe(getCharacterMotionPromptHint("wave-hello"))
    expect(out).not.toMatch(/kiss/i)
  })

  it("a minor on an unrelated handle does not floor", () => {
    const out = getParameterPromptHint(motion, {
      nodes: [{ id: "c1", type: "character", data: { characterName: "Mira", person: MINOR } }],
      edges: [{ source: "c1", target: "n1", targetHandle: "in" }],
    })
    expect(out).toMatch(/kiss/)
  })
})

// A Creature (data.creatureName) wired to Character Motion's target / partner is
// named like the other identity refs. The creature read is local to Character
// Motion: Character FX (and Camera Motion) keep the shared name read unchanged.
describe("getParameterPromptHint — character-motion names a creature ref", () => {
  const rex = { id: "k1", type: "creature", data: { creatureName: "  Rex  " } }

  it("a creature on partner is named in the two-person move", () => {
    const out = getParameterPromptHint(
      { id: "n1", type: "character-motion", data: { characterMotion: "hug-partner" } },
      { nodes: [rex], edges: [{ source: "k1", target: "n1", targetHandle: "partner" }] },
    )
    expect(out).toBe(getCharacterMotionPromptHint("hug-partner").replace(/\bthe partner\b/g, "Rex"))
    expect(out).not.toContain("another person")
  })

  it("a creature on target becomes the subject", () => {
    const out = getParameterPromptHint(
      { id: "n1", type: "character-motion", data: { characterMotion: "wave-hello" } },
      { nodes: [rex], edges: [{ source: "k1", target: "n1", targetHandle: "target" }] },
    )
    expect(out).toBe(getCharacterMotionPromptHint("wave-hello").replace(/\bthe subject\b/g, "Rex"))
  })

  it("Character FX with a creature on target is unchanged (still unnamed)", () => {
    const fx = { id: "n1", type: "character-fx", data: { characterFx: "werewolf" } }
    const out = getParameterPromptHint(fx, {
      nodes: [rex],
      edges: [{ source: "k1", target: "n1", targetHandle: "target" }],
    })
    expect(out).toBe(getParameterPromptHint(fx))
    expect(out).not.toContain("Rex")
  })
})
