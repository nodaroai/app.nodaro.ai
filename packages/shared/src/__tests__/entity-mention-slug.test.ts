import { describe, it, expect } from "vitest"
import {
  entityMentionSlug,
  parseEntityMentionToken,
  findEntityMentionTokens,
  knownEntitySlugsFromRefs,
  entityMentionSlugForRef,
} from "../entity-mention-slug.js"
import {
  findImageMentionTokens,
  imageMentionSlug,
  imageMentionSlugForRef,
  parseImageMentionToken,
} from "../image-mention-slug.js"
import type { ConnectedReference } from "../types.js"

/**
 * Wired-entity mentions — `@<name-slug>:<index>[:<role>]` for `wired-creature`
 * and `wired-object`.
 *
 * Mirrors `image-mention-slug.test.ts` shape-for-shape, because the two speak
 * the SAME grammar through `mention-token-grammar.ts`. The load-bearing
 * assertions are the ones that keep this parser from colliding with the other
 * grammars (a 4-part token is never claimed; a location bucket token is never
 * spliced) and the ones that pin the ref gate: only creatures/objects, never an
 * extra, and grammar-invalid slugs dropped even when non-empty.
 */

const creature = (over: Partial<ConnectedReference> = {}): ConnectedReference => ({
  id: "cr-1",
  defaultName: "Nessie",
  source: "wired-creature",
  url: "https://cdn/nessie.png",
  ...over,
})

const object_ = (over: Partial<ConnectedReference> = {}): ConnectedReference => ({
  id: "ob-1",
  defaultName: "Chair",
  source: "wired-object",
  url: "https://cdn/chair.png",
  ...over,
})

describe("entityMentionSlug", () => {
  it("lowercases and dash-joins", () => {
    expect(entityMentionSlug("Nessie")).toBe("nessie")
    expect(entityMentionSlug("Deep Lake Serpent")).toBe("deep-lake-serpent")
  })

  it("collapses punctuation runs and strips leading/trailing dashes", () => {
    expect(entityMentionSlug("  Nessie -- Beast!! ")).toBe("nessie-beast")
    expect(entityMentionSlug("--chair--")).toBe("chair")
  })

  it("keeps digits, including a leading one (emptiness is NOT the grammar gate)", () => {
    // Non-empty yet UNPARSEABLE — the leading digit fails MENTION_SLUG_PATTERN.
    // `knownEntitySlugsFromRefs` is what must drop it, not this function.
    expect(entityMentionSlug("3-Eyed Raven")).toBe("3-eyed-raven")
  })

  it("returns empty for a name with no latin alphanumerics", () => {
    expect(entityMentionSlug("דרקון")).toBe("")
    expect(entityMentionSlug("🐉🐉")).toBe("")
  })

  it("is byte-identical to the image / character slug algorithm", () => {
    for (const name of ["Nessie", "Deep Lake Serpent", "A  B", "Ünï-cödé 12"]) {
      expect(entityMentionSlug(name)).toBe(imageMentionSlug(name))
      expect(entityMentionSlug(name)).toBe(
        name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, ""),
      )
    }
  })
})

describe("parseEntityMentionToken — rejects", () => {
  it("rejects text that is not a token at all", () => {
    expect(parseEntityMentionToken("nessie:1")).toBeNull()   // no @
    expect(parseEntityMentionToken("@")).toBeNull()
    expect(parseEntityMentionToken("@nessie")).toBeNull()    // no index segment
    expect(parseEntityMentionToken("@nessie:")).toBeNull()   // empty index
  })

  it("rejects a non-positive or non-numeric index", () => {
    expect(parseEntityMentionToken("@nessie:0")).toBeNull()
    expect(parseEntityMentionToken("@nessie:x")).toBeNull()
    expect(parseEntityMentionToken("@nessie:1x")).toBeNull()
  })

  it("rejects out-of-grammar slugs", () => {
    expect(parseEntityMentionToken("@Nessie:1")).toBeNull()  // uppercase
    expect(parseEntityMentionToken("@3d:1")).toBeNull()      // leading digit
    expect(parseEntityMentionToken("@-nessie:1")).toBeNull() // leading dash
  })

  it("rejects a FOUR-part token — the collision guard against character mentions", () => {
    expect(parseEntityMentionToken("@nessie:1:a:b")).toBeNull()
    expect(parseEntityMentionToken("@kira:1:smile:face")).toBeNull()
  })

  it("rejects an empty or out-of-grammar role segment", () => {
    expect(parseEntityMentionToken("@nessie:1:")).toBeNull()
    expect(parseEntityMentionToken("@nessie:1:Bad")).toBeNull()
    expect(parseEntityMentionToken("@nessie:1:1st")).toBeNull()
  })
})

describe("parseEntityMentionToken — accepts", () => {
  it("parses a bare 2-part token and emits NO role key", () => {
    const parsed = parseEntityMentionToken("@nessie:4")
    expect(parsed).toEqual({ entitySlug: "nessie", entityIndex: 4 })
    // Shape rule: a 2-part token must stay shape-identical to a role-less parser.
    expect(parsed && "role" in parsed).toBe(false)
    expect(parsed && "lock" in parsed).toBe(false)
  })

  it("parses a curated CREATURE role in the 3rd segment", () => {
    expect(parseEntityMentionToken("@nessie:4:markings")).toEqual({
      entitySlug: "nessie",
      entityIndex: 4,
      role: "markings",
    })
  })

  it("parses a curated OBJECT role in the 3rd segment", () => {
    expect(parseEntityMentionToken("@chair:2:material")).toEqual({
      entitySlug: "chair",
      entityIndex: 2,
      role: "material",
    })
  })

  it("passes a CUSTOM role through verbatim", () => {
    expect(parseEntityMentionToken("@nessie:4:my-custom-role")).toEqual({
      entitySlug: "nessie",
      entityIndex: 4,
      role: "my-custom-role",
    })
  })

  it("parses the ~lock / ~nolock sentinels as a tri-state", () => {
    expect(parseEntityMentionToken("@nessie:4~lock")).toEqual({
      entitySlug: "nessie", entityIndex: 4, lock: true,
    })
    expect(parseEntityMentionToken("@nessie:4~nolock")).toEqual({
      entitySlug: "nessie", entityIndex: 4, lock: false,
    })
    expect(parseEntityMentionToken("@nessie:4:markings~nolock")).toEqual({
      entitySlug: "nessie", entityIndex: 4, role: "markings", lock: false,
    })
    // The role + force-ON pairing — the other half of the role×sentinel matrix.
    expect(parseEntityMentionToken("@nessie:4:markings~lock")).toEqual({
      entitySlug: "nessie", entityIndex: 4, role: "markings", lock: true,
    })
  })

  it("accepts a multi-segment slug and a large index", () => {
    expect(parseEntityMentionToken("@deep-lake-serpent:12")).toEqual({
      entitySlug: "deep-lake-serpent",
      entityIndex: 12,
    })
  })

  it("agrees segment-for-segment with the image parser (one shared grammar)", () => {
    for (const t of [
      "@nessie:4", "@nessie:4:markings", "@nessie:4~nolock", "@nessie:4:markings~lock",
      "@x:1:a:b", "@3d:1", "@nessie:0", "not-a-token",
    ]) {
      const e = parseEntityMentionToken(t)
      const i = parseImageMentionToken(t)
      expect(e === null).toBe(i === null)
      if (!e || !i) continue
      expect(e.entitySlug).toBe(i.imageSlug)
      expect(e.entityIndex).toBe(i.imageIndex)
      expect("role" in e).toBe("role" in i)
      expect(e.role).toBe(i.role)
      expect("lock" in e).toBe("lock" in i)
      expect(e.lock).toBe(i.lock)
    }
  })
})

describe("findEntityMentionTokens", () => {
  it("finds a known slug and reports its exact offset", () => {
    const prompt = "a wide shot of @nessie:4 rising from the lake"
    const [t] = findEntityMentionTokens(prompt, ["nessie"])
    expect(t.token).toBe("@nessie:4")
    expect(t.entitySlug).toBe("nessie")
    expect(t.entityIndex).toBe(4)
    expect(prompt.slice(t.offset, t.offset + t.token.length)).toBe("@nessie:4")
  })

  it("matches a token at the very start of the prompt", () => {
    const [t] = findEntityMentionTokens("@nessie:1 rises", ["nessie"])
    expect(t.offset).toBe(0)
    expect(t.token).toBe("@nessie:1")
  })

  it("filters out slugs that are not known", () => {
    expect(findEntityMentionTokens("a shot of @nessie:4", [])).toEqual([])
    expect(findEntityMentionTokens("a shot of @nessie:4", ["chair"])).toEqual([])
  })

  it("does not match an email-like `a@nessie:1` (preceding alphanumeric)", () => {
    expect(findEntityMentionTokens("mail a@nessie:1 now", ["nessie"])).toEqual([])
  })

  it("yields NO token for a 4-part CHARACTER token, even when the slug is a known entity", () => {
    // The `(?![:a-z0-9-])` lookahead: without it this would be captured as the
    // 3-part `@kira:1:smile`, leaving `:face` dangling in the prompt.
    expect(findEntityMentionTokens("@kira:1:smile:face poses", ["kira"])).toEqual([])
  })

  it("does not swallow `~locked` as a sentinel", () => {
    const [t] = findEntityMentionTokens("@nessie:1~locked", ["nessie"])
    expect(t.token).toBe("@nessie:1")
    expect("lock" in t).toBe(false)
  })

  it("does claim the sentinel when it is well-formed", () => {
    const [t] = findEntityMentionTokens("@nessie:1~lock", ["nessie"])
    expect(t.token).toBe("@nessie:1~lock")
    expect(t.lock).toBe(true)
  })

  it("claims a `~nolock` sentinel through the FINDER too (force-OFF, tri-state)", () => {
    const [t] = findEntityMentionTokens("a shot of @nessie:1~nolock at dusk", ["nessie"])
    expect(t.token).toBe("@nessie:1~nolock")
    expect(t.lock).toBe(false)
    expect(findEntityMentionTokens("@nessie:1~nolockx", ["nessie"])[0].token).toBe("@nessie:1")
  })

  it("yields NO token for a LOCATION bucket/variant token, even on a known slug", () => {
    // The slash guard. Without it the finder claims the truncated 3-part prefix
    // `@old-library:1:weather` and SPLICES it, leaving `/rain` dangling in the
    // model-facing prompt.
    expect(findEntityMentionTokens("a shot of @old-library:1:weather/rain", ["old-library"]))
      .toEqual([])
    // 4-part location token (variant + mode) — same rejection.
    expect(findEntityMentionTokens("@old-library:1:weather/rain:style", ["old-library"]))
      .toEqual([])
    // Sentinel + slash: the whole token stays literal rather than backtracking
    // to `@nessie:1` and splicing that.
    expect(findEntityMentionTokens("@nessie:1~lock/rain", ["nessie"])).toEqual([])
  })

  it("still matches two mentions separated by a slash (`/` alone is not the signal)", () => {
    const tokens = findEntityMentionTokens("@nessie:1/@chair:2", ["nessie", "chair"])
    expect(tokens.map((t) => t.token)).toEqual(["@nessie:1", "@chair:2"])
  })

  it("finds several mentions in prompt order", () => {
    const tokens = findEntityMentionTokens("@nessie:1 then @chair:2:material", ["nessie", "chair"])
    expect(tokens.map((t) => t.token)).toEqual(["@nessie:1", "@chair:2:material"])
    expect(tokens[1].role).toBe("material")
  })

  it("finds the same token SURFACE as the image finder (one shared finder)", () => {
    for (const prompt of [
      "a shot of @nessie:4 at dusk",
      "@kira:1:smile:face poses",
      "@nessie:1~locked",
      "@old-library:1:weather/rain",
      "@nessie:1/@chair:2",
    ]) {
      const known = ["nessie", "kira", "old-library", "chair"]
      expect(findEntityMentionTokens(prompt, known).map((t) => [t.token, t.offset]))
        .toEqual(findImageMentionTokens(prompt, known).map((t) => [t.token, t.offset]))
    }
  })
})

describe("knownEntitySlugsFromRefs", () => {
  it("includes wired-creature and wired-object refs", () => {
    expect(knownEntitySlugsFromRefs([creature(), object_()])).toEqual(["nessie", "chair"])
  })

  it("excludes every non-entity source", () => {
    expect(
      knownEntitySlugsFromRefs([
        creature({ source: "wired-character", defaultName: "Kira" }),
        creature({ source: "wired-location", defaultName: "Old Library" }),
        creature({ source: "wired-image", defaultName: "Town" }),
        creature({ source: "manual", defaultName: "My Upload" }),
        creature({ source: "wired-face", defaultName: "Face" }),
      ]),
    ).toEqual([])
  })

  it("excludes extra refs (they render through the extras path)", () => {
    expect(knownEntitySlugsFromRefs([creature({ isExtraRef: true })])).toEqual([])
    expect(knownEntitySlugsFromRefs([object_({ isExtraRef: true })])).toEqual([])
  })

  it("excludes url-less and name-less refs", () => {
    expect(knownEntitySlugsFromRefs([creature({ url: "" })])).toEqual([])
    expect(knownEntitySlugsFromRefs([creature({ defaultName: "" })])).toEqual([])
  })

  it("drops a grammar-invalid slug even though it is non-empty", () => {
    expect(knownEntitySlugsFromRefs([creature({ defaultName: "3-Eyed Raven" })])).toEqual([])
    expect(knownEntitySlugsFromRefs([creature({ defaultName: "🐉" })])).toEqual([])
  })

  it("dedupes refs that slug to the same name", () => {
    expect(
      knownEntitySlugsFromRefs([
        creature({ id: "a", defaultName: "Lake Beast", url: "https://cdn/a.png" }),
        object_({ id: "b", defaultName: "Lake Beast", url: "https://cdn/b.png" }),
      ]),
    ).toEqual(["lake-beast"])
  })

  it("is UNFILTERED — a slug also claimed by a character still appears here", () => {
    // Cross-kind precedence is the RESOLVER's pass order, not this set's job.
    // Subtracting the character's slug here would put the rule in two places.
    const refs: ConnectedReference[] = [
      { id: "c1", defaultName: "Nessie", source: "wired-character", url: "https://cdn/k.png", characterSlug: "nessie" },
      creature(),
    ]
    expect(knownEntitySlugsFromRefs(refs)).toEqual(["nessie"])
  })

  it("is the exact gate the finder uses (no slug in the set is unmatchable)", () => {
    const refs = [creature(), creature({ id: "b", defaultName: "3-Eyed Raven", url: "https://cdn/b.png" })]
    const slugs = knownEntitySlugsFromRefs(refs)
    for (const slug of slugs) {
      expect(findEntityMentionTokens(`@${slug}:1`, slugs)).toHaveLength(1)
    }
  })
})

describe("entityMentionSlugForRef — the single mentionability gate", () => {
  it("returns the slug for a mentionable creature / object ref", () => {
    expect(entityMentionSlugForRef(creature())).toBe("nessie")
    expect(entityMentionSlugForRef(object_({ defaultName: "Wooden Chair" }))).toBe("wooden-chair")
  })

  it("returns null for every non-mentionable ref", () => {
    expect(entityMentionSlugForRef(creature({ source: "wired-character" }))).toBeNull()
    expect(entityMentionSlugForRef(creature({ source: "wired-image" }))).toBeNull()
    expect(entityMentionSlugForRef(creature({ isExtraRef: true }))).toBeNull()
    expect(entityMentionSlugForRef(creature({ url: "" }))).toBeNull()
    expect(entityMentionSlugForRef(creature({ defaultName: "" }))).toBeNull()
    // Non-empty but grammar-invalid — emptiness is NOT the gate.
    expect(entityMentionSlugForRef(creature({ defaultName: "3-Eyed Raven" }))).toBeNull()
  })

  it("is DISJOINT from the image gate — no ref can be claimed by both kinds", () => {
    // The two gates partition by `source`, so a ref never has two mention
    // grammars competing for it and the pass order only has to settle
    // NAME collisions between distinct refs.
    const refs: ConnectedReference[] = [
      creature(),
      object_(),
      { id: "i", defaultName: "Town", source: "wired-image", url: "https://cdn/i.png" },
      { id: "m", defaultName: "My Upload", source: "manual", url: "https://cdn/m.png" },
      { id: "k", defaultName: "Kira", source: "wired-character", url: "https://cdn/k.png" },
    ]
    for (const r of refs) {
      const claims = [entityMentionSlugForRef(r), imageMentionSlugForRef(r)]
        .filter((s) => s !== null)
      expect(claims.length).toBeLessThanOrEqual(1)
    }
  })

  it("is the SAME gate `knownEntitySlugsFromRefs` applies (the two views cannot drift)", () => {
    const refs = [
      creature(),
      creature({ id: "b", defaultName: "3-Eyed Raven", url: "https://cdn/b.png" }),
      creature({ id: "c", defaultName: "Extra", isExtraRef: true, url: "https://cdn/c.png" }),
      object_({ id: "d" }),
      { id: "e", defaultName: "Town", source: "wired-image" as const, url: "https://cdn/e.png" },
    ]
    expect(knownEntitySlugsFromRefs(refs)).toEqual(
      [...new Set(refs.map(entityMentionSlugForRef).filter((s): s is string => s !== null))],
    )
  })
})
