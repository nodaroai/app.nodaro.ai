import { describe, it, expect } from "vitest"
import {
  INSTRUMENTS,
  PRODUCTION_STYLES,
  VOCAL_PRESENCE,
  getInstrument,
  getProductionStyle,
  getVocalPresence,
  buildInstrumentationHints,
  INSTRUMENTATION_DEFAULT_DATA,
} from "../instrumentation.js"

describe("instrumentation catalogs", () => {
  it("INSTRUMENTS, PRODUCTION_STYLES, VOCAL_PRESENCE are non-empty with unique ids", () => {
    for (const list of [INSTRUMENTS, PRODUCTION_STYLES, VOCAL_PRESENCE]) {
      expect(list.length).toBeGreaterThan(0)
      const ids = new Set(list.map((x) => x.id))
      expect(ids.size).toBe(list.length)
    }
  })

  it("VOCAL_PRESENCE includes 'instrumental' so it can flip the boolean for MiniMax", () => {
    expect(VOCAL_PRESENCE.find((x) => x.id === "instrumental")).toBeDefined()
  })

  it("INSTRUMENTS includes darbuka in percussion", () => {
    const entry = INSTRUMENTS.find((x) => x.id === "darbuka")
    expect(entry).toBeDefined()
    expect(entry?.category).toBe("percussion")
    expect(entry?.promptHint).toBe("darbuka")
  })
})

describe("buildInstrumentationHints", () => {
  it("returns empty for empty data", () => {
    expect(buildInstrumentationHints({ instruments: [] })).toBe("")
    expect(buildInstrumentationHints({})).toBe("")
  })

  it("composes single instrument", () => {
    const i = INSTRUMENTS[0]
    expect(buildInstrumentationHints({ instruments: [i.id] })).toBe(i.promptHint)
  })

  it("joins multiple instruments with commas", () => {
    const a = INSTRUMENTS[0], b = INSTRUMENTS[1]
    const out = buildInstrumentationHints({ instruments: [a.id, b.id] })
    expect(out).toContain(a.promptHint)
    expect(out).toContain(b.promptHint)
    expect(out).toContain(",")
  })

  it("composes [production] [instruments] with [vocalPresence]", () => {
    const p = PRODUCTION_STYLES[0]
    const i = INSTRUMENTS[0]
    const v = VOCAL_PRESENCE.find((x) => x.id === "female-lead")!
    const out = buildInstrumentationHints({
      production: p.id, instruments: [i.id], vocalPresence: v.id,
    })
    expect(out.indexOf(p.promptHint)).toBeLessThan(out.indexOf(i.promptHint))
    expect(out).toContain(v.promptHint)
  })

  it("filters unknown instrument ids silently", () => {
    const i = INSTRUMENTS[0]
    expect(buildInstrumentationHints({ instruments: [i.id, "not-real"] })).toBe(i.promptHint)
  })
})
