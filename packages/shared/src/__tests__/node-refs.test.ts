import { NODE_REF_PATTERN, resolveNodeRefs } from "../node-refs.js"

// ---------------------------------------------------------------------------
// NODE_REF_PATTERN
// ---------------------------------------------------------------------------
describe("NODE_REF_PATTERN", () => {
  it("matches {text} references", () => {
    const matches = Array.from("hello {World} foo".matchAll(NODE_REF_PATTERN))
    expect(matches).toHaveLength(1)
    expect(matches[0][1]).toBe("World")
  })

  it("matches multiple refs in one string", () => {
    const matches = Array.from("{A} and {B}".matchAll(NODE_REF_PATTERN))
    expect(matches).toHaveLength(2)
    expect(matches[0][1]).toBe("A")
    expect(matches[1][1]).toBe("B")
  })

  it("does not match empty braces {}", () => {
    const matches = Array.from("{}".matchAll(NODE_REF_PATTERN))
    expect(matches).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// resolveNodeRefs
// ---------------------------------------------------------------------------
describe("resolveNodeRefs", () => {
  it("resolves a simple ref", () => {
    const map = new Map([["My Node", "hello"]])
    expect(resolveNodeRefs("{My Node}", map)).toBe("hello")
  })

  it("resolves multiple refs", () => {
    const map = new Map([
      ["A", "alpha"],
      ["B", "beta"],
    ])
    expect(resolveNodeRefs("{A} and {B}", map)).toBe("alpha and beta")
  })

  it("does not replace reserved variables", () => {
    const reserved = ["name", "description", "userPrompt", "assetDescriptions", "outputCount"]
    const map = new Map(reserved.map((v) => [v, "REPLACED"]))
    for (const v of reserved) {
      expect(resolveNodeRefs(`{${v}}`, map)).toBe(`{${v}}`)
    }
  })

  it("leaves missing refs unchanged", () => {
    const map = new Map([["Known", "yes"]])
    expect(resolveNodeRefs("{Unknown}", map)).toBe("{Unknown}")
  })

  it("resolves nested refs across passes", () => {
    const map = new Map([
      ["A", "{B}"],
      ["B", "final"],
    ])
    expect(resolveNodeRefs("{A}", map)).toBe("final")
  })

  it("stops after max 10 passes on circular refs", () => {
    const map = new Map([
      ["A", "{B}"],
      ["B", "{A}"],
    ])
    // Circular: A -> B -> A -> B -> ... stops after 10 iterations
    const result = resolveNodeRefs("{A}", map)
    // After 10 passes the result will alternate between {A} and {B}.
    // The important thing is it terminates and returns one of those.
    expect(["{A}", "{B}"]).toContain(result)
  })

  it("trims whitespace in labels", () => {
    const map = new Map([["My Node", "trimmed"]])
    expect(resolveNodeRefs("{ My Node }", map)).toBe("trimmed")
  })

  it("returns text unchanged with an empty map", () => {
    const map = new Map<string, string>()
    expect(resolveNodeRefs("{Anything}", map)).toBe("{Anything}")
  })

  it("returns text unchanged when there are no refs", () => {
    const map = new Map([["A", "alpha"]])
    expect(resolveNodeRefs("no refs here", map)).toBe("no refs here")
  })
})
