import { describe, it, expect } from "vitest"
import { unresolvedRefTokens, classifyRefToken, REF_TOKEN_NAMESPACE_PREFIXES } from "../node-refs.js"

const S = (...v: string[]) => new Set(v)

describe("classifyRefToken", () => {
  it("skips every reference namespace, not just image:", () => {
    for (const p of REF_TOKEN_NAMESPACE_PREFIXES) {
      expect(classifyRefToken(`${p}1`, S())).toBe("skip")
    }
    // Regression: {video:1} and {audio:1} classified as "missing" before this.
    expect(classifyRefToken("video:1", S())).toBe("skip")
    expect(classifyRefToken("audio:1", S())).toBe("skip")
    expect(classifyRefToken("slot:hero", S())).toBe("skip")
    // D-13c: {ref:<id>} is a live grammar (resolveRefIdTokens) — it must skip
    // too, or the dispatch guard refuses every id-addressed reference prompt.
    expect(classifyRefToken("ref:hero", S())).toBe("skip")
  })

  it("matches the namespace case-insensitively (the resolvers' regexes are /i)", () => {
    // D-13d: REFERENCE_TOKEN_RE is /gi and REF_ID_TOKEN_RE spells [rR][eE][fF],
    // so {Image:1} / {Ref:x} resolve at the provider layer and must not classify
    // as a missing node ref.
    expect(classifyRefToken("Image:1", S())).toBe("skip")
    expect(classifyRefToken("REF:hero", S())).toBe("skip")
  })

  it("keeps reserved template vars reserved and resolves case-insensitively", () => {
    expect(classifyRefToken("userPrompt", S())).toBe("reserved")
    expect(classifyRefToken("MyNode", S("mynode"))).toBe("wired")
    expect(classifyRefToken("MyNode", S())).toBe("missing")
  })

  it("classifies unknown when the caller has no ref data at all", () => {
    expect(classifyRefToken("MyNode", null)).toBe("unknown")
  })
})

describe("unresolvedRefTokens", () => {
  it("reports a token whose label matches no node at all", () => {
    expect(unresolvedRefTokens("a {gravity flip} shot", { resolvable: S(), known: S() }))
      .toEqual(["gravity flip"])
  })

  it("passes a token whose label names a node that exists but produced nothing", () => {
    expect(unresolvedRefTokens("say {notes}", { resolvable: S(), known: S("notes") })).toEqual([])
  })

  it("passes a token that resolved", () => {
    expect(unresolvedRefTokens("say {notes}", { resolvable: S("notes"), known: S("notes") })).toEqual([])
  })

  it("passes a token with an explicit || fallback (resolveNodeRefs substitutes it)", () => {
    expect(unresolvedRefTokens("a {mood || calm} scene", { resolvable: S(), known: S() })).toEqual([])
  })

  it("never fires on the reference/recast grammars or reserved vars", () => {
    expect(unresolvedRefTokens("{image:1:face} {video:1} {slot:x} {ref:hero} {userPrompt}", { resolvable: S(), known: S() }))
      .toEqual([])
  })

  it("de-duplicates and preserves the author's casing for the message", () => {
    expect(unresolvedRefTokens("{Describe Image} then {describe image}", { resolvable: S(), known: S() }))
      .toEqual(["Describe Image"])
  })
})
