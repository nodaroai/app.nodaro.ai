import { describe, it, expect } from "vitest"
import {
  TERM_MAX_CHARS,
  deriveTerm,
  isSuspiciousDerivedTerm,
  resolveTerm,
  type TermCarrier,
} from "../term.js"

const carrier = (over: Partial<TermCarrier> = {}): TermCarrier => ({
  id: "x",
  label: "Whip Pan Left",
  promptHint: "the camera whips left in a single blurred sweep",
  ...over,
})

describe("TERM_MAX_CHARS", () => {
  it("is the documented cap", () => {
    expect(TERM_MAX_CHARS).toBe(60)
  })
})

describe("deriveTerm", () => {
  it("lowercases the label", () => {
    expect(deriveTerm("Medium Close-Up")).toBe("medium close-up")
  })

  it("removes parenthetical segments", () => {
    expect(deriveTerm("Ultra-wide (14mm)")).toBe("ultra-wide")
    expect(deriveTerm("ISO 1600 (visible grain)")).toBe("iso 1600")
    expect(deriveTerm("(only) parenthetical")).toBe("parenthetical")
  })

  it("collapses whitespace and trims", () => {
    expect(deriveTerm("  Hard   Cut \n")).toBe("hard cut")
  })

  it("does NOT split on '/' — ambiguity must surface, not be guessed", () => {
    expect(deriveTerm("None / Hard Cut")).toBe("none / hard cut")
    expect(deriveTerm("Fog / Mist")).toBe("fog / mist")
  })

  it("yields an empty string for an empty or purely parenthetical label", () => {
    expect(deriveTerm("")).toBe("")
    expect(deriveTerm("   ")).toBe("")
    expect(deriveTerm("(auto)")).toBe("")
  })
})

describe("isSuspiciousDerivedTerm", () => {
  it("accepts a clean multi-word label", () => {
    expect(isSuspiciousDerivedTerm("Whip Pan Left")).toBe(false)
    expect(isSuspiciousDerivedTerm("Medium Close-Up")).toBe(false)
  })

  it.each(["None / Hard Cut", "Ultra-wide (14mm)", "Key: Rembrandt", "Black & White", "Start → End", "2× Speed"])(
    "flags the UI-compound / annotated label %s",
    (label) => {
      expect(isSuspiciousDerivedTerm(label)).toBe(true)
    },
  )

  it("flags a label that derives to nothing", () => {
    expect(isSuspiciousDerivedTerm("")).toBe(true)
    expect(isSuspiciousDerivedTerm("   ")).toBe(true)
  })

  it("flags a bare word only under bareWordSuspicious", () => {
    expect(isSuspiciousDerivedTerm("Warm")).toBe(false)
    expect(isSuspiciousDerivedTerm("Warm", { bareWordSuspicious: true })).toBe(true)
    expect(isSuspiciousDerivedTerm("Short", { bareWordSuspicious: true })).toBe(true)
  })

  it("does not flag a multi-word label under bareWordSuspicious", () => {
    expect(isSuspiciousDerivedTerm("Warm Tungsten", { bareWordSuspicious: true })).toBe(false)
  })
})

describe("resolveTerm", () => {
  it("returns '' for a missing entry", () => {
    expect(resolveTerm(undefined)).toBe("")
    expect(resolveTerm(null)).toBe("")
  })

  it("returns '' for a no-op entry whose promptHint is empty (auto / none)", () => {
    expect(resolveTerm(carrier({ id: "auto", label: "Auto", promptHint: "" }))).toBe("")
    // …even when a term was authored on it: an entry that injects nothing has
    // nothing to inject in compact mode either.
    expect(resolveTerm(carrier({ id: "auto", label: "Auto", promptHint: "", term: "auto" }))).toBe("")
  })

  it("prefers an explicit authored term", () => {
    expect(resolveTerm(carrier({ label: "None / Hard Cut", term: "hard cut" }))).toBe("hard cut")
  })

  it("falls back to the derived label when no term is authored", () => {
    expect(resolveTerm(carrier({ label: "Whip Pan Left" }))).toBe("whip pan left")
    expect(resolveTerm(carrier({ label: "Ultra-wide (14mm)" }))).toBe("ultra-wide")
  })

  it("treats an empty authored term as authored (does not fall back to the label)", () => {
    expect(resolveTerm(carrier({ label: "Whip Pan Left", term: "" }))).toBe("")
  })
})
