import { describe, it, expect } from "vitest"
import {
  CHARACTER_NODE_DEFAULT_LABEL,
  CHARACTER_NODE_RETIRED_DEFAULT_LABELS,
  characterOwnName,
  wiredCharacterNames,
  wiredCharacterNamesOf,
  wiredCharacterBySlug,
  wiredCharacterKey,
  wiredCharacterSlug,
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

  // Decided 2026-11-12: the same-name rule holds in every script, as for Latin.
  describe("the same typed name in any script is one character", () => {
    for (const [locale, typed] of [["en", "Maya"], ["ja", "マヤ"], ["he", "מאיה"], ["ko", "마야"]] as const) {
      it(`${locale}: two "${typed}" nodes share one key; the next unnamed node takes the next number`, () => {
        const m = wiredCharacterNames([named("a", typed), unnamed("u"), named("b", typed)])
        expect(m.get("a")?.slug).toBe(m.get("b")?.slug)
        expect([m.get("a")?.name, m.get("b")?.name]).toEqual([typed, typed])
        expect(new Set([...m.values()].map((n) => n.slug)).size).toBe(2)
        expect(m.get("u")?.name).toBe(locale === "en" ? "Character 1" : "Character 2")
      })
    }

    it("non-Latin: the duplicate takes no number of its own", () => {
      expect(names([named("a", "マヤ"), unnamed("u"), named("b", "マヤ")])).toEqual([
        ["a", "マヤ", "character-1"],
        ["u", "Character 2", "character-2"],
        ["b", "マヤ", "character-1"],
      ])
    })

    it("Latin is unchanged: Maya / maya / MAYA and 'Maya Lee' / 'maya-lee' are one by their slug", () => {
      expect(names([named("a", "Maya"), named("b", "maya"), named("c", "MAYA")])).toEqual([
        ["a", "Maya", "maya"],
        ["b", "maya", "maya"],
        ["c", "MAYA", "maya"],
      ])
      expect(names([named("a", "Maya Lee"), named("b", "maya-lee")])).toEqual([
        ["a", "Maya Lee", "maya-lee"],
        ["b", "maya-lee", "maya-lee"],
      ])
    })

    it("two different non-Latin names stay two (he / ja / ko)", () => {
      for (const [x, y] of [["מאיה", "נועה"], ["マヤ", "レオ"], ["마야", "레오"]] as const) {
        expect(names([named("a", x), named("b", y)])).toEqual([
          ["a", x, "character-1"],
          ["b", y, "character-2"],
        ])
      }
    })

    it("the same name as Unicode reads it: half-width katakana, decomposed Hangul, letter case, spacing", () => {
      const same = (x: string, y: string) => {
        const m = wiredCharacterNames([named("a", x), named("b", y)])
        return m.get("a")?.slug === m.get("b")?.slug
      }
      expect(same("マヤ", "ﾏﾔ")).toBe(true)
      expect(same("마야", "마야".normalize("NFD"))).toBe(true)
      expect(same("Мая", "мая")).toBe(true)
      expect(same("マヤ・リー", "マヤ リー")).toBe(true)
      // A combining mark is part of the name: ガ (ga) is not カ (ka).
      expect(same("ガク", "カク")).toBe(false)
    })

    // Decided 2026-11-13: a name with a letter of another script is the WHOLE
    // name, never its Latin remainder.
    it("mixed-script names that share a Latin remainder are different characters, on their own keys", () => {
      expect(names([named("a", "マヤ1"), named("b", "レオ1")])).toEqual([
        ["a", "マヤ1", "character-1"],
        ["b", "レオ1", "character-2"],
      ])
      expect(names([named("a", "マヤ A"), named("b", "A")])).toEqual([
        ["a", "マヤ A", "character-1"],
        ["b", "A", "a"],
      ])
      expect(names([named("b", "A"), unnamed("u"), named("a", "マヤ A")])).toEqual([
        ["b", "A", "a"],
        ["u", "Character 1", "character-1"],
        ["a", "マヤ A", "character-2"],
      ])
    })

    it("the same mixed-script name twice is one character", () => {
      expect(names([named("a", "マヤ1"), named("b", "マヤ1")])).toEqual([
        ["a", "マヤ1", "1"],
        ["b", "マヤ1", "1"],
      ])
      const m = wiredCharacterNames([named("a", "マヤ A"), named("b", "ﾏﾔ a"), named("c", "レオ1"), named("d", "レオ1"), named("e", "ハナ1")])
      expect(m.get("a")?.slug).toBe(m.get("b")?.slug)
      expect(m.get("c")?.slug).toBe(m.get("d")?.slug)
      expect(new Set([...m.values()].map((n) => n.slug)).size).toBe(3)
    })

    it("a mixed-script name no other character claims keeps its old mention key", () => {
      expect(names([named("a", "マヤ A"), named("b", "Leo"), unnamed("u")])).toEqual([
        ["a", "マヤ A", "a"],
        ["b", "Leo", "leo"],
        ["u", "Character 1", "character-1"],
      ])
    })

    it("a name whose letters are all Latin, accents included, keeps its slug as before", () => {
      expect(names([named("a", "José"), named("b", "Ana-María")])).toEqual([
        ["a", "José", "jos"],
        ["b", "Ana-María", "ana-mar-a"],
      ])
    })

    // An all-Latin name the slug cannot spell follows the same-name rule (decided 2026-11-13).
    it("all-Latin names the slug cannot spell: the same one twice is one character, two different ones stay two", () => {
      expect(names([named("a", "Ñ"), named("b", "Ñ")])).toEqual([
        ["a", "Ñ", "character-1"],
        ["b", "Ñ", "character-1"],
      ])
      expect(names([named("a", "Ñ"), named("b", "Ö")])).toEqual([
        ["a", "Ñ", "character-1"],
        ["b", "Ö", "character-2"],
      ])
      expect(names([named("a", "Ö"), named("b", "ö")]).map(([, , slug]) => slug)).toEqual(["character-1", "character-1"])
    })

    it("a name with no letter or digit never matches another", () => {
      expect(names([named("a", "!!!"), named("b", "!!!")])).toEqual([
        ["a", "!!!", "character-1"],
        ["b", "!!!", "character-2"],
      ])
    })
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
  it("a non-Latin name wired only as a plain image: the key of the wired character with the same name", () => {
    const withMaya = wiredCharacterNames([unnamed("b"), named("a", "マヤ")])
    expect(wiredCharacterKey(withMaya, "c", { characterName: "ﾏﾔ" })).toBe("character-2")
    expect(wiredCharacterSlug(withMaya, "c", { characterName: "マヤ" })).toBe("character-2")
    // No wired character has it: a key of its own, never an unnamed node's.
    expect(wiredCharacterKey(withMaya, "d", { characterName: "レオ" })).toBe("node:d")
    expect(wiredCharacterSlug(withMaya, "d", { characterName: "レオ" })).toBe("")
  })
  it("a mixed-script name wired only as a plain image is never filed under a Latin character sharing its remainder", () => {
    const withA = wiredCharacterNames([named("b", "A"), named("m", "マヤ A")])
    expect(wiredCharacterKey(withA, "c", { characterName: "マヤ A" })).toBe(withA.get("m")!.slug)
    expect(wiredCharacterKey(withA, "c", { characterName: "レオ A" })).toBe("node:c")
    expect(wiredCharacterKey(withA, "d", { characterName: "A" })).toBe("a")
  })
  it("a Latin name wired only as a plain image is never filed under a mixed-script character that goes by its slug", () => {
    const onlyMaya = wiredCharacterNames([named("m", "マヤ A")])
    expect(onlyMaya.get("m")?.slug).toBe("a")
    expect(wiredCharacterKey(onlyMaya, "c", { characterName: "A" })).toBe("node:c")
    expect(wiredCharacterSlug(onlyMaya, "c", { characterName: "A" })).toBe("")
    // With no wired character on its slug, a Latin name keeps its own, as before.
    expect(wiredCharacterKey(onlyMaya, "d", { characterName: "Leo" })).toBe("leo")
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
