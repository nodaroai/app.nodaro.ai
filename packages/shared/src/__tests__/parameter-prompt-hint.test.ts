import { describe, it, expect } from "vitest"
import { getParameterPromptHint } from "../parameter-prompt-hint.js"
import { PARAMETER_NODE_TYPES, getParameterValue } from "../parameter-node-value.js"
import { ACTION_FX } from "../action-fx.js"

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
