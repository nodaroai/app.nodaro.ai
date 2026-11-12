import { describe, it, expect } from "vitest"
import {
  CHARACTER_NODE_DEFAULT_LABEL,
  CHARACTER_NODE_RETIRED_DEFAULT_LABELS,
  characterOwnName,
  wiredCharacterNames,
  wiredCharacterNamesOf,
  wiredCharacterBySlug,
  wiredCharacterKey,
  aliasRetiredCharacterMentions,
  entityImageUrl,
  type WiredCharacterSource,
} from "../entries/entities.js"

const unnamed = (key: string, extra: Record<string, unknown> = {}): WiredCharacterSource => ({
  key,
  type: "character",
  sourceHandle: "characterRef",
  data: { label: CHARACTER_NODE_DEFAULT_LABEL, characterName: "", ...extra },
})
const named = (key: string, characterName: string): WiredCharacterSource => ({
  key,
  type: "character",
  sourceHandle: "characterRef",
  data: { label: CHARACTER_NODE_DEFAULT_LABEL, characterName },
})
const names = (sources: WiredCharacterSource[]) =>
  [...wiredCharacterNames(sources)].map(([key, n]) => [key, n.name, n.slug])

describe("characterOwnName — the name a Character node was given", () => {
  it("is its characterName, trimmed", () => {
    expect(characterOwnName({ characterName: "  Maya Lee ", label: CHARACTER_NODE_DEFAULT_LABEL })).toBe("Maya Lee")
  })

  it("is a label someone typed when it has no characterName", () => {
    expect(characterOwnName({ characterName: "", label: "Hero" })).toBe("Hero")
  })

  it("is empty for the default label, a retired default, a label or name of only spaces, or no data", () => {
    for (const data of [
      { characterName: "", label: CHARACTER_NODE_DEFAULT_LABEL },
      { characterName: "   ", label: ` ${CHARACTER_NODE_DEFAULT_LABEL} ` },
      { characterName: "", label: "Character" },
      { characterName: "", label: "   " },
      { characterName: 42, label: undefined },
      {},
      null,
      undefined,
    ]) {
      expect(characterOwnName(data)).toBe("")
    }
  })

  it("the retired default is exactly the February–June 2026 one", () => {
    // "Character" was the node's default label from 2026-02-03 until
    // 2026-06-21; graphs saved then still carry it on unnamed nodes.
    expect(CHARACTER_NODE_RETIRED_DEFAULT_LABELS).toEqual(["Character"])
  })
})

describe("wiredCharacterNames — what each wired Character node is called by the node it feeds", () => {
  it("one unnamed node is Character 1, never the node's type name", () => {
    expect(names([unnamed("a")])).toEqual([["a", "Character 1", "character-1"]])
  })

  it("two unnamed nodes are two characters, numbered in wire order", () => {
    expect(names([unnamed("a"), unnamed("b")])).toEqual([
      ["a", "Character 1", "character-1"],
      ["b", "Character 2", "character-2"],
    ])
  })

  it("a typed label is the name", () => {
    expect(names([unnamed("a", { label: "Hero" })])).toEqual([["a", "Hero", "hero"]])
  })

  it("an unnamed node beside a node NAMED Character 1 becomes Character 2, in either order", () => {
    expect(names([named("n", "Character 1"), unnamed("a")])).toEqual([
      ["n", "Character 1", "character-1"],
      ["a", "Character 2", "character-2"],
    ])
    expect(names([unnamed("a"), named("n", "character 1")])).toEqual([
      ["a", "Character 2", "character-2"],
      ["n", "character 1", "character-1"],
    ])
  })

  it("the same typed name on two nodes is one character, as before", () => {
    expect(names([named("a", "Maya"), named("b", "Maya")])).toEqual([
      ["a", "Maya", "maya"],
      ["b", "Maya", "maya"],
    ])
  })

  it("a mixed list (named, unnamed, named, unnamed)", () => {
    expect(names([named("a", "Maya"), unnamed("b"), named("c", "Leo"), unnamed("d")])).toEqual([
      ["a", "Maya", "maya"],
      ["b", "Character 1", "character-1"],
      ["c", "Leo", "leo"],
      ["d", "Character 2", "character-2"],
    ])
  })

  it("only a wire that delivers a character counts, and a node wired twice counts once", () => {
    const viaImage: WiredCharacterSource = { ...unnamed("img"), sourceHandle: "image" }
    const notCharacter: WiredCharacterSource = { key: "up", type: "upload-image", sourceHandle: "image", data: { label: "Character Asset" } }
    expect(names([viaImage, notCharacter, unnamed("a"), unnamed("a")])).toEqual([["a", "Character 1", "character-1"]])
  })

  it("a typed name the slug cannot spell is a real name, keyed by the next number of the unnamed sequence", () => {
    for (const [locale, typed] of [["he", "מאיה"], ["ja", "マヤ"], ["ko", "마야"]] as const) {
      expect(names([unnamed("a"), named("b", typed), named("c", "Leo"), unnamed("d")]), locale).toEqual([
        ["a", "Character 1", "character-1"],
        ["b", typed, "character-2"],
        ["c", "Leo", "leo"],
        ["d", "Character 3", "character-3"],
      ])
    }
    expect(names([named("a", "!!!"), unnamed("b")])).toEqual([
      ["a", "!!!", "character-1"],
      ["b", "Character 2", "character-2"],
    ])
  })

  it("a numbered key skips a number a Latin name already has", () => {
    expect(names([named("n", "Character 1"), named("m", "マヤ")])).toEqual([
      ["n", "Character 1", "character-1"],
      ["m", "マヤ", "character-2"],
    ])
  })

  it("unnamed flags the nodes with no name of their own (a slug-less typed name is not one)", () => {
    const m = wiredCharacterNames([named("a", "Maya"), unnamed("b"), named("c", "マヤ")])
    expect(m.get("a")?.unnamed).toBe(false)
    expect(m.get("b")?.unnamed).toBe(true)
    expect(m.get("c")?.unnamed).toBe(false)
  })
})

describe("wiredCharacterNamesOf — the same rule over a graph", () => {
  it("reads the consumer's incoming wires in edge order, keyed by node id", () => {
    const nodes = [
      { id: "u1", type: "character", data: { label: CHARACTER_NODE_DEFAULT_LABEL, characterName: "" } },
      { id: "u2", type: "character", data: { label: CHARACTER_NODE_DEFAULT_LABEL, characterName: "" } },
      { id: "gi", type: "generate-image", data: {} },
      { id: "other", type: "generate-image", data: {} },
    ]
    const edges = [
      { source: "u2", target: "gi", sourceHandle: "characterRef" },
      { source: "u1", target: "other", sourceHandle: "characterRef" },
      { source: "u1", target: "gi", sourceHandle: "characterRef" },
    ]
    const m = wiredCharacterNamesOf("gi", nodes, edges)
    expect([...m].map(([k, n]) => [k, n.name])).toEqual([["u2", "Character 1"], ["u1", "Character 2"]])
    expect(wiredCharacterBySlug(m, "character-2")?.key).toBe("u1")
    expect(wiredCharacterBySlug(m, "")).toBeUndefined()
  })
})

describe("wiredCharacterKey — where a Character node's own elements are filed", () => {
  const m = wiredCharacterNames([named("a", "Maya"), unnamed("b")])
  it("a wired character: its slug", () => {
    expect(wiredCharacterKey(m, "a", { characterName: "Maya" })).toBe("maya")
    expect(wiredCharacterKey(m, "b", { characterName: "" })).toBe("character-1")
  })
  it("a node wired only as a plain image: its own name's slug, else a key of its own", () => {
    expect(wiredCharacterKey(m, "c", { characterName: "Maya" })).toBe("maya")
    expect(wiredCharacterKey(m, "d", { label: CHARACTER_NODE_DEFAULT_LABEL })).toBe("node:d")
  })
})

describe("aliasRetiredCharacterMentions — a mention saved before unnamed characters were numbered", () => {
  const prompt = "@character-asset:1 waves at @character:1:smile~lock while @character-asset:2:face watches"
  it("with exactly one unnamed character wired, @character-asset and @character (any suffix) read as its slug", () => {
    const m = wiredCharacterNames([unnamed("a"), named("b", "Leo")])
    expect(aliasRetiredCharacterMentions(prompt, m)).toBe(
      "@character-1:1 waves at @character-1:1:smile~lock while @character-1:2:face watches",
    )
  })

  it("it follows the one unnamed node's number", () => {
    const m = wiredCharacterNames([named("n", "Character 1"), unnamed("a")])
    expect(aliasRetiredCharacterMentions("@character-asset:1", m)).toBe("@character-2:1")
  })

  it("with two unnamed characters, or none, the text is left as it is", () => {
    expect(aliasRetiredCharacterMentions(prompt, wiredCharacterNames([unnamed("a"), unnamed("b")]))).toBe(prompt)
    expect(aliasRetiredCharacterMentions(prompt, wiredCharacterNames([named("b", "Leo")]))).toBe(prompt)
    expect(aliasRetiredCharacterMentions(prompt, wiredCharacterNames([named("b", "マヤ")]))).toBe(prompt)
  })

  it("a node labelled 'Character' (the retired default) is the one unnamed character too", () => {
    const m = wiredCharacterNames([{ ...unnamed("a"), data: { label: "Character", characterName: "" } }])
    expect(aliasRetiredCharacterMentions("@character:1 and @character-asset:1", m)).toBe("@character-1:1 and @character-1:1")
  })

  it("a retired slug a wired character really goes by is never rewritten", () => {
    const m = wiredCharacterNames([named("c", "Character"), unnamed("a")])
    expect(aliasRetiredCharacterMentions("@character:1 and @character-asset:1", m)).toBe("@character:1 and @character-1:1")
  })

  it("only whole mentions: not a numbered slug, a longer slug, an email-like token or one without an index", () => {
    const m = wiredCharacterNames([unnamed("a")])
    const text = "@character-1:1 @characters:1 x@character:1 @character-asset @character"
    expect(aliasRetiredCharacterMentions(text, m)).toBe(text)
    expect(aliasRetiredCharacterMentions(undefined, m)).toBeUndefined()
  })
})

describe("entityImageUrl — the image an entity node gives out, and a Character's portrait", () => {
  it("the starred default asset, else the active generated result, else the source image", () => {
    const results = [{ url: "r0" }, { url: "r1" }]
    expect(entityImageUrl({ defaultAssetUrl: "d", generatedResults: results, activeResultIndex: 1, sourceImageUrl: "s" })).toBe("d")
    expect(entityImageUrl({ defaultAssetUrl: "", generatedResults: results, activeResultIndex: 1, sourceImageUrl: "s" })).toBe("r1")
    expect(entityImageUrl({ generatedResults: results, sourceImageUrl: "s" })).toBe("r0")
    expect(entityImageUrl({ generatedResults: [], sourceImageUrl: "s" })).toBe("s")
    expect(entityImageUrl({})).toBeUndefined()
    expect(entityImageUrl(null)).toBeUndefined()
  })
})
