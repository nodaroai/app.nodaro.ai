import { describe, it, expect } from "vitest"
import {
  entityMentionSlugForRef,
  findEntityMentionTokens,
  findImageMentionTokens,
  imageMentionSlugForRef,
  type ConnectedReference,
} from "@nodaro/shared"

import {
  bindMentionTokens,
  recoverTypedMentions,
  withRecoveredMentions,
  type MentionCandidate,
} from "../prompt-mentions"

/**
 * Re-binding `@Name` text that lost its chip.
 *
 * The clips this recovers were saved with their prose intact but no references:
 * a render that finished after a reload stored none, so the prompt came back as
 * flat text and a re-generate would have sent the NAME without the face. The
 * rules pinned here are what keep the recovery from over-claiming: an explicit
 * `@`, an exact name, longest first, and never something already bound.
 */

function candidate(id: string, name: string): MentionCandidate {
  return {
    id,
    name,
    toConnectedReference: () => ({
      id,
      defaultName: name,
      source: "wired-character",
      url: `https://r2/${id}.png`,
    }),
  }
}

const ANDRE = candidate("c-andre", "Andre")
const ANDRE_2 = candidate("c-andre-2", "Andre Williams 2")
const EITAN = candidate("c-eitan", "Eitan")
const RIVER = candidate("l-river", "River")
const LIBRARY = [ANDRE, ANDRE_2, EITAN, RIVER]

const bound = (id: string, name: string): ConnectedReference => ({
  id,
  defaultName: name,
  source: "wired-character",
  url: "",
})

describe("recoverTypedMentions", () => {
  it("re-binds the typed mentions of a clip that lost its references", () => {
    const prompt =
      "@Eitan falls much faster than @Andre Williams 2, then crashes into his back."
    const out = recoverTypedMentions(prompt, [], LIBRARY)
    expect(out.map((r) => r.defaultName)).toEqual(["Eitan", "Andre Williams 2"])
    // The binding is the real one — the portrait rides along, which is the whole
    // point (a bare name sends nobody's face).
    expect(out[1].url).toBe("https://r2/c-andre-2.png")
  })

  it("matches the LONGEST name — @Andre Williams 2 is not Andre", () => {
    const out = recoverTypedMentions("@Andre Williams 2 arches", [], LIBRARY)
    expect(out.map((r) => r.id)).toEqual(["c-andre-2"])
  })

  it("ignores a name that is only PROSE — no @, no binding", () => {
    // "River" is a location in the library and the valley is described by name;
    // binding it would silently send an image the user never referenced.
    const out = recoverTypedMentions(
      "the valley of Aerial Over River Valley below",
      [],
      LIBRARY,
    )
    expect(out).toEqual([])
  })

  it("requires a whole-name match at the boundary", () => {
    expect(recoverTypedMentions("@Eitanovich waves", [], LIBRARY)).toEqual([])
    // Punctuation right after the name is still a boundary (possessives, commas).
    expect(
      recoverTypedMentions("@Eitan's grip, then @Andre.", [], LIBRARY).map(
        (r) => r.id,
      ),
    ).toEqual(["c-eitan", "c-andre"])
  })

  it("never duplicates a binding — by id or by name, however many times it appears", () => {
    const out = recoverTypedMentions(
      "@Eitan above, @Eitan below, @Andre Williams 2 falling",
      [bound("c-andre-2", "Andre Williams 2")],
      LIBRARY,
    )
    expect(out.map((r) => r.id)).toEqual(["c-eitan"])
  })

  it("does nothing for a prompt with no mentions at all", () => {
    expect(recoverTypedMentions("two men fall through cloud", [], LIBRARY)).toEqual(
      [],
    )
  })
})

describe("withRecoveredMentions", () => {
  it("returns the SAME array when there is nothing to recover", () => {
    const refs = [bound("c-eitan", "Eitan")]
    expect(withRecoveredMentions("Eitan falls", refs, LIBRARY)).toBe(refs)
    expect(withRecoveredMentions(undefined, refs, LIBRARY)).toBe(refs)
  })

  it("appends the recovered bindings after the stored ones", () => {
    const refs = [bound("c-eitan", "Eitan")]
    const out = withRecoveredMentions(
      "Eitan crashes into @Andre Williams 2",
      refs,
      LIBRARY,
    )
    expect(out?.map((r) => r.id)).toEqual(["c-eitan", "c-andre-2"])
  })

  it("recovers into an EMPTY restore — the clip that stored no references", () => {
    const out = withRecoveredMentions("@Eitan dives", undefined, LIBRARY)
    expect(out?.map((r) => r.id)).toEqual(["c-eitan"])
  })
})

/**
 * The FRAMING wire binding (spec 2026-08-30-structured-prompt-assembly, S1 +
 * S4): bound chips become platform mention tokens on the wire so the route
 * resolves them inline instead of the nameless trailing role-phrase fallback.
 * What is pinned here is the platform-mirroring: the canvas autocomplete's
 * unified counter, the grammar's slug shape, exact-case whole-word matching,
 * the character/location VIEW boundary (views ride isExtraRef), and S4's
 * per-reference image strip — a named image chip binds only when the platform
 * predicate says its WIRE shape is addressable, and only the references a token
 * was actually emitted for are stripped.
 */

function charRef(
  name: string,
  overrides: Partial<ConnectedReference> = {},
): ConnectedReference {
  return {
    id: `c-${name.toLowerCase()}`,
    defaultName: name,
    source: "wired-character",
    url: `https://r2/${name.toLowerCase()}.png`,
    characterSlug: name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, ""),
    ...overrides,
  }
}

function locationRef(
  name: string,
  overrides: Partial<ConnectedReference> = {},
): ConnectedReference {
  return {
    id: `l-${name.toLowerCase()}`,
    defaultName: name,
    source: "wired-location",
    url: `https://r2/${name.toLowerCase()}.png`,
    locationSlug: name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, ""),
    ...overrides,
  }
}

/**
 * Studio's STORED image-chip shape, verbatim from
 * `imageRefToConnectedReference` — `isExtraRef: true` + a synthetic
 * `description`, the pair S4 strips on the wire (and only there).
 */
function imageRef(
  name: string,
  overrides: Partial<ConnectedReference> = {},
): ConnectedReference {
  return {
    id: `i-${name.toLowerCase().replace(/\s+/g, "-")}`,
    defaultName: name,
    source: "wired-image",
    url: `https://r2/${name.toLowerCase().replace(/\s+/g, "-")}.png`,
    isExtraRef: true,
    description: name,
    ...overrides,
  }
}

/**
 * A creature / object chip's STORED shape, verbatim from
 * `chipAttrsToConnectedReference` — a canonical pick carries no `isExtraRef`
 * (so it IS the wire shape, and S7 needs no strip for it); a VIEW pick adds
 * `isExtraRef` + the variant `description`, exactly as a character view does.
 */
function entityRef(
  name: string,
  source: "wired-creature" | "wired-object",
  overrides: Partial<ConnectedReference> = {},
): ConnectedReference {
  const slug = name.toLowerCase().replace(/\s+/g, "-")
  return {
    id: `${source === "wired-creature" ? "cr" : "o"}-${slug}`,
    defaultName: name,
    source,
    url: `https://r2/${slug}.png`,
    ...overrides,
  }
}

describe("bindMentionTokens", () => {
  it("binds a character + location pair with one unified counter, in reading order", () => {
    const out = bindMentionTokens("Jack Mercer at Sunset Boat", [
      charRef("Jack Mercer"),
      locationRef("Sunset Boat"),
    ])
    expect(out.wirePrompt).toBe("@jack-mercer:1 at @sunset-boat:2")
  })

  it("binds every whole-word occurrence, each with the next index (the canvas per-insert rule)", () => {
    const out = bindMentionTokens("Kira waves. Kira smiles.", [charRef("Kira")])
    expect(out.wirePrompt).toBe("@kira:1 waves. @kira:2 smiles.")
  })

  it("continues the prose's own mention counter instead of restarting at 1", () => {
    const out = bindMentionTokens("@rex:3 stands beside Kira", [charRef("Kira")])
    expect(out.wirePrompt).toBe("@rex:3 stands beside @kira:4")
  })

  it("longest name wins, so a contained shorter name never claims it", () => {
    const out = bindMentionTokens("Andre Williams 2 walks past Andre", [
      charRef("Andre"),
      charRef("Andre Williams 2", { characterSlug: "andre-williams-2" }),
    ])
    expect(out.wirePrompt).toBe("@andre-williams-2:1 walks past @andre:2")
  })

  it("matches EXACT case — a chip named Iris must not bind an iris wipe", () => {
    const out = bindMentionTokens("Iris exits via iris wipe", [charRef("Iris")])
    expect(out.wirePrompt).toBe("@iris:1 exits via iris wipe")
  })

  it("never rewrites an already-typed @Name (no @@ tokens)", () => {
    const out = bindMentionTokens("@Kira waves", [charRef("Kira")])
    expect(out.wirePrompt).toBe("@Kira waves")
  })

  it("skips view chips (isExtraRef / variantSlug) — they ride the extra-ref channel", () => {
    // T8: and their references pass through BY IDENTITY with `isExtraRef`
    // intact — the S4 strip is images-only, per bound reference.
    const references = [
      charRef("Kira", { variantSlug: "back", isExtraRef: true }),
      locationRef("Old Library", {
        locationVariantSlug: "night",
        isExtraRef: true,
      }),
    ]
    const out = bindMentionTokens("Kira turns; Old Library darkens", references)
    expect(out.wirePrompt).toBe("Kira turns; Old Library darkens")
    expect(out.wireReferences).toBe(references)
    expect(out.wireReferences[0].isExtraRef).toBe(true)
    expect(out.wireReferences[1].isExtraRef).toBe(true)
  })

  it("skips refs the grammar cannot address: no url, unsluggable or digit-led names", () => {
    const out = bindMentionTokens("עיר and 3D Render and Prop and Kira", [
      charRef("עיר", { characterSlug: "" }),
      charRef("3D Render", { characterSlug: "3d-render" }),
      // An object with no url — the entity predicate refuses it for the same
      // reason it refuses a url-less character (S7).
      { id: "o-prop", defaultName: "Prop", source: "wired-object", url: "" },
      charRef("Kira", { url: "" }),
    ])
    expect(out.wirePrompt).toBe("עיר and 3D Render and Prop and Kira")
  })

  it("returns the prompt untouched when nothing is bindable", () => {
    const references: ConnectedReference[] = []
    const out = bindMentionTokens("a quiet street", references)
    expect(out.wirePrompt).toBe("a quiet street")
    expect(out.wireReferences).toBe(references)
  })

  // ── S4: named IMAGE chips ──────────────────────────────────────────────

  it("binds a named image chip and strips its wire ref's isExtraRef + description", () => {
    const references = [imageRef("Ref 1")]
    const out = bindMentionTokens("a knight standing in Ref 1", references)
    expect(out.wirePrompt).toBe("a knight standing in @ref-1:1")
    // The WIRE ref is the platform's own media shape — keys ABSENT, not false.
    expect(out.wireReferences).not.toBe(references)
    expect(out.wireReferences[0]).not.toHaveProperty("isExtraRef")
    expect(out.wireReferences[0]).not.toHaveProperty("description")
    expect(out.wireReferences[0].url).toBe(references[0].url)
    // Copy-on-write: the caller's stored reference is untouched (invariant I2).
    expect(references[0].isExtraRef).toBe(true)
    expect(references[0].description).toBe("Ref 1")
  })

  it("leaves an image chip the prose never names alone — no token, no strip", () => {
    const references = [imageRef("Ref 1")]
    const out = bindMentionTokens("a quiet street at dusk", references)
    expect(out.wirePrompt).toBe("a quiet street at dusk")
    expect(out.wireReferences).toBe(references)
    expect(out.wireReferences[0].isExtraRef).toBe(true)
  })

  it("leaves image chips the platform grammar cannot address (Hebrew, digit-led, no url)", () => {
    const references = [
      imageRef("עיר"),
      imageRef("3D Render"),
      imageRef("Ref 4", { url: "" }),
    ]
    const out = bindMentionTokens("עיר and 3D Render and Ref 4", references)
    expect(out.wirePrompt).toBe("עיר and 3D Render and Ref 4")
    expect(out.wireReferences).toBe(references)
    for (const r of out.wireReferences) expect(r.isExtraRef).toBe(true)
  })

  it("duplicate slugs: the FIRST reference binds, the rest keep their directive", () => {
    // The real collision route: the picker names by a production-wide index
    // (`stillDisplayName`) while an upload names by `Ref ${project.length + 1}`
    // — two different rows can land on the same "Ref 2".
    const references = [
      imageRef("Ref 2", { id: "i-picker", url: "https://r2/a.png" }),
      imageRef("Ref 2", { id: "i-upload", url: "https://r2/b.png" }),
    ]
    const out = bindMentionTokens("Ref 2 beside Ref 2", references)
    // Exactly ONE distinct binding for the slug: both prose occurrences address
    // the FIRST reference (the per-occurrence index is the canvas rule, and for
    // images it is correlation only). The forbidden state is a SECOND reference
    // also binding `ref-2` — that would point the model at image A twice and
    // leave B unexplained.
    expect(out.wirePrompt).toBe("@ref-2:1 beside @ref-2:2")
    const stripped = out.wireReferences.filter((r) => !("isExtraRef" in r))
    expect(stripped).toHaveLength(1)
    expect(stripped[0].id).toBe("i-picker")
    // The loser keeps `isExtraRef` — and therefore today's directive line.
    expect(out.wireReferences[1].isExtraRef).toBe(true)
    expect(out.wireReferences[1].id).toBe("i-upload")
  })

  it("a slug already claimed by a character is not re-claimed by an image chip", () => {
    const references = [
      charRef("Ref-1", { characterSlug: "ref-1" }),
      imageRef("Ref 1"),
    ]
    const out = bindMentionTokens("Ref-1 near Ref 1", references)
    expect(out.wirePrompt).toBe("@ref-1:1 near Ref 1")
    expect(out.wireReferences).toBe(references)
    expect(out.wireReferences[1].isExtraRef).toBe(true)
  })

  it("a location VIEW chip's slug blocks an image chip — the platform knows it unfiltered", () => {
    // The location pass runs BEFORE the image pass and its `bySlug` map keys
    // every ref carrying a `locationSlug` without a full bucket+variant pair —
    // an `isExtraRef` VIEW included (`viewToConnectedReference`). Binding the
    // image chip would hand the token to the board's image at the image chip's
    // own prose position and leave the named still unexplained.
    const references = [
      locationRef("Harbor", {
        url: "https://r2/harbor-night.png",
        isExtraRef: true,
        description: "night board",
      }),
      imageRef("Harbor", { id: "i-harbor", url: "https://r2/photo.png" }),
    ]
    const out = bindMentionTokens("a boat at Harbor", references)
    expect(out.wirePrompt).toBe("a boat at Harbor")
    expect(out.wireReferences).toBe(references)
    expect(out.wireReferences[1].isExtraRef).toBe(true)
  })

  it("a character VARIANT view's slug blocks an image chip too", () => {
    // DELIBERATE TRADE: the platform's character resolver may whiff on this
    // shape (its `bySlug` excludes variant refs) and let the token fall through
    // to the image pass. Studio does not bank on a resolver miss — the
    // platform's own contract is "a name shared by a character and an image
    // resolves as the character" — so the chip keeps its directive line.
    const references = [
      charRef("Kira", { variantSlug: "smile", isExtraRef: true, description: "smile" }),
      imageRef("Kira", { id: "i-kira", url: "https://r2/kira-still.png" }),
    ]
    const out = bindMentionTokens("Kira on a rooftop", references)
    expect(out.wirePrompt).toBe("Kira on a rooftop")
    expect(out.wireReferences).toBe(references)
  })

  it("refuses an image token the platform's stricter trailing boundary would reject", () => {
    // `findImageMentionTokens` alone carries `(?![:a-z0-9-])` + the `/<segment>`
    // slash guard. Emitting a token it refuses is worse than not binding: the
    // ref is already stripped, so the model gets a literal `@ref-1:1-lit` and
    // an unexplained attachment.
    for (const prose of [
      "Ref 1: a knight in armor",
      "Ref 1-lit knight",
      "Ref 1/background of a knight",
    ]) {
      const references = [imageRef("Ref 1")]
      const out = bindMentionTokens(prose, references)
      expect(out.wirePrompt).toBe(prose)
      expect(out.wireReferences).toBe(references)
      expect(findImageMentionTokens(out.wirePrompt, ["ref-1"])).toHaveLength(0)
    }
    // Control: a plain boundary still binds, and the platform still finds it.
    const ok = bindMentionTokens("a knight standing in Ref 1", [imageRef("Ref 1")])
    expect(ok.wirePrompt).toBe("a knight standing in @ref-1:1")
    expect(findImageMentionTokens(ok.wirePrompt, ["ref-1"])).toHaveLength(1)
    // …and the boundary is IMAGE-only: the character finder tolerates the same
    // suffixes, so S1's tokens are untouched by the guard.
    expect(
      bindMentionTokens("Kira-lit hallway", [charRef("Kira")]).wirePrompt,
    ).toBe("@kira:1-lit hallway")
  })

  it("rejects PER OCCURRENCE — a clean mention of the same chip still binds and strips", () => {
    const references = [imageRef("Ref 1")]
    const out = bindMentionTokens("Ref 1: a knight beside Ref 1, lit warmly", references)
    // The refused occurrence stays prose AND burns no index, so the clean one
    // is still `:1` — the counter must only count tokens the platform will see.
    expect(out.wirePrompt).toBe("Ref 1: a knight beside @ref-1:1, lit warmly")
    expect(out.wireReferences).not.toBe(references)
    expect("isExtraRef" in out.wireReferences[0]).toBe(false)
  })

  it("two different NAMES on one slug: only the first binds (slug-level dedupe)", () => {
    const out = bindMentionTokens("Kira Vance greets Kira-Vance", [
      charRef("Kira Vance", { characterSlug: "kira-vance" }),
      charRef("Kira-Vance", { id: "c-kv2", characterSlug: "kira-vance" }),
    ])
    expect(out.wirePrompt).toBe("@kira-vance:1 greets Kira-Vance")
  })

  it("runs ONE counter across characters, locations and images", () => {
    const out = bindMentionTokens("Kira at Old Library holding Ref 1", [
      charRef("Kira"),
      locationRef("Old Library"),
      imageRef("Ref 1"),
    ])
    expect(out.wirePrompt).toBe("@kira:1 at @old-library:2 holding @ref-1:3")
    const typed = bindMentionTokens("@rex:3 — Kira at Old Library holding Ref 1", [
      charRef("Kira"),
      locationRef("Old Library"),
      imageRef("Ref 1"),
    ])
    expect(typed.wirePrompt).toBe(
      "@rex:3 — @kira:4 at @old-library:5 holding @ref-1:6",
    )
  })

  it("never forks from the platform's notion of a mentionable image reference", () => {
    // The drift guard (G12): studio must not re-derive `IMAGE_SLUG_PATTERN`
    // (it is not exported). Every image ref the binder stripped is one the
    // platform predicate accepts; every image ref it left alone either fails
    // that predicate on its WIRE shape or had its slug claimed by a
    // higher-precedence kind.
    const claimant = charRef("Taken", { characterSlug: "taken" })
    // A VIEW claimant: studio never binds it, but the platform's known-slug
    // sets are UNFILTERED, so it still owns `board` ahead of any image chip.
    const viewClaimant = locationRef("Board", {
      url: "https://r2/board-night.png",
      isExtraRef: true,
      description: "night board",
    })
    const images = [
      imageRef("Ref 1"), // bindable
      imageRef("עיר"), // unsluggable
      imageRef("3D Render"), // digit-led slug
      imageRef("No Url", { url: "" }), // no url
      imageRef("Ref 1", { id: "i-dup", url: "https://r2/dup.png" }), // duplicate slug
      imageRef("Taken"), // slug claimed by the character above
      imageRef("Board"), // slug the platform reads off the location VIEW
    ]
    const references = [claimant, viewClaimant, ...images]
    const prose = "Taken and Board and Ref 1 and עיר and 3D Render and No Url"
    const out = bindMentionTokens(prose, references)
    // The platform's own derivations, verbatim: every ref's slug, no filter.
    const known = new Set(
      references.flatMap((r) =>
        [r.characterSlug, r.locationSlug].filter((s): s is string => !!s),
      ),
    )
    for (const [i, ref] of out.wireReferences.entries()) {
      const source = references[i]
      if (source.source !== "wired-image") continue
      if (ref !== source) {
        // Stripped ⇒ the platform accepts it, exactly as sent.
        expect(imageMentionSlugForRef(ref)).not.toBeNull()
        continue
      }
      // Untouched ⇒ its WIRE shape is unaddressable, another image already
      // bound that slug (a token for it is in the prompt), or a
      // higher-precedence KIND knows the slug — bindable by studio or not.
      const slug = imageMentionSlugForRef({
        ...source,
        isExtraRef: undefined,
        description: undefined,
      })
      expect(
        slug === null || known.has(slug) || out.wirePrompt.includes(`@${slug}:`),
      ).toBe(true)
    }
    // The VIEW arm is only a guard if the view chip really claimed its slug.
    expect(out.wirePrompt).toContain(" Board and ")
    // The table is only a guard if it actually exercises both arms.
    expect(
      out.wireReferences.filter(
        (r) => r.source === "wired-image" && !("isExtraRef" in r),
      ),
    ).toHaveLength(1)
    expect(out.wirePrompt).toContain("@taken:")
    expect(out.wirePrompt).toContain("@ref-1:")
  })

  // ── S7: wired CREATURES and OBJECTS ────────────────────────────────────

  it("binds a creature and an object chip, and strips nothing", () => {
    // A canonical entity chip is ALREADY the wire shape — no `isExtraRef` to
    // remove — so the reference array comes back BY IDENTITY. That is the
    // structural difference from the image pass, not an oversight.
    const references = [
      entityRef("Nessie", "wired-creature"),
      entityRef("Teapot", "wired-object"),
    ]
    const out = bindMentionTokens("Nessie rises beside the Teapot", references)
    expect(out.wirePrompt).toBe("@nessie:1 rises beside the @teapot:2")
    expect(out.wireReferences).toBe(references)
  })

  it("skips an entity VIEW chip — it rides the extra-ref channel like every other view", () => {
    const references = [
      entityRef("Nessie", "wired-creature", {
        isExtraRef: true,
        description: "coiled",
      }),
      entityRef("Teapot", "wired-object", {
        isExtraRef: true,
        description: "top view",
      }),
    ]
    const out = bindMentionTokens("Nessie beside the Teapot", references)
    expect(out.wirePrompt).toBe("Nessie beside the Teapot")
    expect(out.wireReferences).toBe(references)
  })

  it("skips an entity the platform grammar cannot address (no url, unsluggable, digit-led)", () => {
    const references = [
      entityRef("Nessie", "wired-creature", { url: "" }),
      entityRef("שרף", "wired-creature"),
      entityRef("3 Legged Stool", "wired-object"),
    ]
    const out = bindMentionTokens("Nessie and שרף and 3 Legged Stool", references)
    expect(out.wirePrompt).toBe("Nessie and שרף and 3 Legged Stool")
    expect(out.wireReferences).toBe(references)
  })

  it("images outrank entities: an image chip's slug blocks a creature on the same name", () => {
    // The platform's image pass runs first and splices its token out, so the
    // creature finder never sees it. Binding here would point the token at the
    // creature while the platform pointed it at the picture.
    const references = [imageRef("Nessie"), entityRef("Nessie", "wired-creature")]
    const out = bindMentionTokens("Nessie surfaces", references)
    expect(out.wirePrompt).toBe("@nessie:1 surfaces")
    // The IMAGE is the one that bound — its ref is the stripped wire copy.
    expect(out.wireReferences[0]).not.toHaveProperty("isExtraRef")
    expect(out.wireReferences[1]).toBe(references[1])
  })

  it("an image chip the prose never binds still blocks an entity — the platform knows its slug", () => {
    // `Nessie` is an image chip the predicate accepts as a WIRE ref only after
    // the strip, and the strip only happens for a token studio emitted. Here the
    // prose names the creature and studio's own image pass claimed the slug
    // first, so the creature stays prose rather than racing the platform.
    const references = [
      imageRef("Nessie", { isExtraRef: undefined, description: undefined }),
      entityRef("Nessie", "wired-creature"),
    ]
    const out = bindMentionTokens("a shape called Nessie", references)
    expect(out.wirePrompt).toBe("a shape called @nessie:1")
    expect(out.wireReferences[1]).toBe(references[1])
  })

  it("creature outranks object on a shared name — the resolver's map is built creature-first", () => {
    const references = [
      entityRef("Gribble", "wired-object"),
      entityRef("Gribble", "wired-creature"),
    ]
    const out = bindMentionTokens("Gribble waits", references)
    expect(out.wirePrompt).toBe("@gribble:1 waits")
    // …and the object is NOT blocked by another object's slug: creature and
    // object share ONE claim space, seeded between the two would break this.
    const two = bindMentionTokens("Teapot and Kettle", [
      entityRef("Teapot", "wired-object"),
      entityRef("Kettle", "wired-object"),
    ])
    expect(two.wirePrompt).toBe("@teapot:1 and @kettle:2")
  })

  it("runs ONE counter across all five kinds, in reading order", () => {
    const out = bindMentionTokens(
      "Kira at Old Library holding Ref 1 with Nessie and a Teapot",
      [
        charRef("Kira"),
        locationRef("Old Library"),
        imageRef("Ref 1"),
        entityRef("Nessie", "wired-creature"),
        entityRef("Teapot", "wired-object"),
      ],
    )
    expect(out.wirePrompt).toBe(
      "@kira:1 at @old-library:2 holding @ref-1:3 with @nessie:4 and a @teapot:5",
    )
  })

  it("applies the SHORT grammar's trailing reject to entities, per occurrence", () => {
    // `findEntityMentionTokens` is the same shared core as the image finder —
    // both collision guards included — so an entity token followed by `:`, `-`
    // or `/<segment>` is refused by the platform and must not be emitted.
    for (const prose of [
      "Nessie: a long neck",
      "Nessie-green coils",
      "Nessie/background of a loch",
    ]) {
      const references = [entityRef("Nessie", "wired-creature")]
      const out = bindMentionTokens(prose, references)
      expect(out.wirePrompt).toBe(prose)
      expect(
        findEntityMentionTokens(out.wirePrompt, ["nessie"]),
      ).toHaveLength(0)
    }
    // Per OCCURRENCE: the refused one burns no index, the clean one still binds.
    const mixed = bindMentionTokens("Nessie: then Nessie surfaces", [
      entityRef("Nessie", "wired-creature"),
    ])
    expect(mixed.wirePrompt).toBe("Nessie: then @nessie:1 surfaces")
    expect(findEntityMentionTokens(mixed.wirePrompt, ["nessie"])).toHaveLength(1)
  })

  it("never forks from the platform's notion of a mentionable entity reference", () => {
    // The S7 mirror of the image drift guard: every entity ref that bound is one
    // `entityMentionSlugForRef` accepts, and every one left alone either fails
    // that predicate or had its slug claimed by a higher-precedence kind.
    const references = [
      charRef("Taken", { characterSlug: "taken" }),
      imageRef("Board"),
      entityRef("Nessie", "wired-creature"),
      entityRef("Taken", "wired-creature"),
      entityRef("Board", "wired-object"),
      entityRef("Sunk", "wired-object", { url: "" }),
      entityRef("Viewed", "wired-object", { isExtraRef: true, description: "top" }),
      entityRef("שרף", "wired-creature"),
    ]
    const prose = "Taken and Board and Nessie and Sunk and Viewed and שרף"
    const out = bindMentionTokens(prose, references)
    for (const r of references) {
      if (r.source !== "wired-creature" && r.source !== "wired-object") continue
      const slug = entityMentionSlugForRef(r)
      const bound = slug !== null && out.wirePrompt.includes(`@${slug}:`)
      if (!bound) continue
      // Bound ⇒ the platform accepts it, exactly as sent (no strip on this path).
      expect(entityMentionSlugForRef(r)).toBe(slug)
    }
    // Both arms are exercised: one entity bound, the rest kept their prose.
    expect(out.wirePrompt).toBe(
      "@taken:1 and @board:2 and @nessie:3 and Sunk and Viewed and שרף",
    )
    expect(out.wireReferences[2]).toBe(references[2])
  })
})
