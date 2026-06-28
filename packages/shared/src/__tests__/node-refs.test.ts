import {
  NODE_REF_PATTERN,
  resolveNodeRefs,
  parseNodeRef,
  REFERENCE_HANDLE_MAP,
  referenceModalityForHandle,
} from "../node-refs.js"

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

// ---------------------------------------------------------------------------
// parseNodeRef
// ---------------------------------------------------------------------------
describe("parseNodeRef", () => {
  it("splits on the first || and trims both sides", () => {
    expect(parseNodeRef("person || man")).toEqual({ name: "person", fallback: "man" })
    expect(parseNodeRef("person||man")).toEqual({ name: "person", fallback: "man" })
    expect(parseNodeRef("person     || ")).toEqual({ name: "person", fallback: "" })
    expect(parseNodeRef("p || a || b")).toEqual({ name: "p", fallback: "a || b" })
  })
  it("returns null fallback when there is no ||", () => {
    expect(parseNodeRef("person")).toEqual({ name: "person", fallback: null })
    expect(parseNodeRef("p|man")).toEqual({ name: "p|man", fallback: null }) // single pipe is literal
  })
  it("handles a degenerate empty name", () => {
    expect(parseNodeRef("|| man")).toEqual({ name: "", fallback: "man" })
  })
})

// ---------------------------------------------------------------------------
// resolveNodeRefs — {name || default} fallback
// ---------------------------------------------------------------------------
describe("resolveNodeRefs with fallback", () => {
  it("uses the connected node output over the fallback", () => {
    expect(resolveNodeRefs("a {person || man} b", new Map([["person", "dog"]]))).toBe("a dog b")
  })
  it("uses the fallback when the node is absent", () => {
    expect(resolveNodeRefs("a {person || man} b", new Map())).toBe("a man b")
  })
  it("falls back to empty for {person || } when absent (fallback !== null, not truthiness)", () => {
    expect(resolveNodeRefs("a {person || } b", new Map())).toBe("a  b")
  })
  it("falls back when the connected node output is empty (maps drop empty → absent)", () => {
    // Empty outputs are never inserted into the label→output map, so an empty-but-connected
    // node is indistinguishable from absent and the fallback fires.
    expect(resolveNodeRefs("a {person || man} b", new Map())).toBe("a man b")
  })
  it("leaves {name} literal when absent and there is no ||", () => {
    expect(resolveNodeRefs("a {person} b", new Map())).toBe("a {person} b")
  })
  it("leaves a reserved var with a fallback untouched", () => {
    expect(resolveNodeRefs("{name || x}", new Map())).toBe("{name || x}")
  })
})

// ---------------------------------------------------------------------------
// REFERENCE_HANDLE_MAP / referenceModalityForHandle
//
// SINGLE SOURCE OF TRUTH for reference-handle aliases. Both the legacy single-
// name ids and the canonical Generate Video ids must resolve to the same
// modality so positional `{image:N}` / `{video:N}` / `{audio:N}` token counts
// cover every handle the editor can produce.
// ---------------------------------------------------------------------------
describe("REFERENCE_HANDLE_MAP", () => {
  it("maps both legacy and canonical handle families to the same resolved-input keys", () => {
    expect(REFERENCE_HANDLE_MAP).toEqual({
      references: "referenceImageUrls",
      "reference-videos": "referenceVideoUrls",
      "reference-audio": "referenceAudioUrls",
      imageReferences: "referenceImageUrls",
      videoReferences: "referenceVideoUrls",
      audioReferences: "referenceAudioUrls",
    })
  })
})

describe("referenceModalityForHandle", () => {
  it("resolves all 6 reference handles to their modality (legacy + canonical aliases)", () => {
    // Legacy / i2v single-name ids
    expect(referenceModalityForHandle("references")).toBe("image")
    expect(referenceModalityForHandle("reference-videos")).toBe("video")
    expect(referenceModalityForHandle("reference-audio")).toBe("audio")
    // Canonical Generate Video ids — the alias that was silently uncounted
    expect(referenceModalityForHandle("imageReferences")).toBe("image")
    expect(referenceModalityForHandle("videoReferences")).toBe("video")
    expect(referenceModalityForHandle("audioReferences")).toBe("audio")
  })

  it("returns null for a non-reference handle", () => {
    expect(referenceModalityForHandle("prompt")).toBeNull()
    expect(referenceModalityForHandle("startFrame")).toBeNull()
    expect(referenceModalityForHandle("audio")).toBeNull() // single-image-frame audio handle, NOT a ref array
    expect(referenceModalityForHandle("")).toBeNull()
  })

  it("returns null for null / undefined", () => {
    expect(referenceModalityForHandle(null)).toBeNull()
    expect(referenceModalityForHandle(undefined)).toBeNull()
  })
})
