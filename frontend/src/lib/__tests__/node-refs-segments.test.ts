import { describe, it, expect } from "vitest"
import { resolveTextRefs, resolveTextRefsSegments } from "../node-refs"

describe("resolveTextRefsSegments", () => {
  const refMap = new Map([["Script", "hello world"]])

  it("splits resolved {Label} values into variable segments; join equals resolveTextRefs output", () => {
    const out = resolveTextRefsSegments("say {Script} now", refMap)
    expect(out).toEqual([
      { text: "say ", origin: "user" },
      { text: "hello world", origin: "variable" },
      { text: " now", origin: "user" },
    ])
  })

  it("unresolvable labels stay literal user text", () => {
    expect(resolveTextRefsSegments("{Nope} x", refMap)).toEqual([{ text: "{Nope} x", origin: "user" }])
  })

  // Step 2b: the join-invariant test arbitrates semantics — resolveTextRefs is
  // the source of truth. join(segments) MUST equal resolveTextRefs(text, refMap)
  // for every representative input (any divergence here is a segment-impl bug).
  it("join(segments) === resolveTextRefs for representative inputs", () => {
    const refMap2 = new Map([["Script", "hello world"], ["Empty", ""]])
    const inputs = [
      "say {Script} now",
      "{Script}",
      "{Nope} literal",
      "mix {Script} and {Nope}",
      "fallback {Nope || plan b} end",
      "dormant {Empty || plan b} end",
      "no tokens at all",
      "",
    ]
    for (const input of inputs) {
      const joined = resolveTextRefsSegments(input, refMap2).map((s) => s.text).join("")
      expect(joined, `input=${JSON.stringify(input)}`).toBe(resolveTextRefs(input, refMap2) ?? input)
    }
  })
})
