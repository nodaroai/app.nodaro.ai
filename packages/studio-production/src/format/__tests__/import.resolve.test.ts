import { describe, it, expect } from "vitest"

import type { ReferenceSource } from "@nodaro/shared"

import type { CastKind } from "../../cast"
import example from "../fixtures/example.json"
import { EXAMPLE_LIBRARY } from "../fixtures/library"
import { resolveMentions } from "../import"
import { canonicalizeDeclaredMentions } from "../import-canonical-mentions"
import { renderStrictJsonSchema } from "../json-schema"
import { buildFormatRegistry } from "../registry"
import { productionDocumentSchema } from "../schema"
import type { MentionCandidate } from "../../prompt-mentions"

/**
 * Stage 4 of the import pipeline (spec §6.4) — RESOLVE, both spellings. Split
 * out of `import.test.ts` in the follow-ups fix wave once that file passed the
 * 800-line house cap, one file per pipeline stage.
 *
 * The local builders below are this file's OWN copies rather than an import
 * from a sibling: importing a `.test.ts` file would re-run its `describe`/`it`
 * blocks a second time — the same standalone-with-local-fixtures precedent
 * `production-bundle.recipe.test.ts` set. Every case is a PURE MOVE.
 */

/**
 * Stage 4 — RESOLVE (§6.4). Every `@Name` binds through the load path's own
 * recovery rule, and the names the DOCUMENT declares it needs (`cast`) are the
 * only ones that can come back unresolved — an `@` run naming nobody is prose.
 */
// `source` MUST be annotated: `ConnectedReference.source` is the narrow union
// `ReferenceSource`, and an unannotated default widens the parameter to `string`.
const candidate = (
  id: string,
  name: string,
  source: ReferenceSource = "wired-character",
  kind?: CastKind,
): MentionCandidate => ({
  id,
  name,
  ...(kind ? { kind } : {}),
  toConnectedReference: () => ({
    id,
    defaultName: name,
    source,
    url: `https://r2.example/${id}.png`,
  }),
})

describe("resolve", () => {
  it("binds the §3 example's frame prose against its own library", () => {
    const doc = productionDocumentSchema().parse(example)
    const out = resolveMentions(doc, EXAMPLE_LIBRARY)
    expect(out.bindings.get("0.frame")?.map((r) => r.defaultName)).toEqual(["Natalie"])
    expect(out.warnings).toEqual([])
  })

  it("keys each prose field by its OWN scene index and stage", () => {
    const doc = productionDocumentSchema().parse({
      format: "nodaro-studio-production",
      version: 1,
      scenes: [
        { frame: { prompt: "@Natalie in the doorway" } },
        {
          motion: { prompt: "@Natalie turns to the window" },
          shots: [{ seconds: 4, text: "@Natalie exhales" }],
        },
      ],
    })
    const out = resolveMentions(doc, EXAMPLE_LIBRARY)
    // The KEYS are the whole contract with `map` — a stage or an index that
    // slipped would land scene 1's chips on scene 0, or motion's on framing.
    expect([...out.bindings.keys()]).toEqual(["0.frame", "1.motion", "1.shot:0"])
    expect(out.bindings.get("1.motion")?.map((r) => r.id)).toEqual(["char-natalie"])
  })

  it("binds nothing for the scene's generic prompt — it has no chip list to land on", () => {
    // Deliberate, not an oversight: `Shot.scenePrompt` is a plain textarea with
    // no `references` beside it, so a binding here would have nowhere to go.
    // The name still reaches the recipient — export's `cast` scan reads the
    // scene prompt, which is the informational channel §6.4 gives it.
    const doc = productionDocumentSchema().parse({
      format: "nodaro-studio-production",
      version: 1,
      scenes: [
        {
          motion: { scenePrompt: "the whole clip follows @Natalie" },
          shots: [{ seconds: 4, text: "the alley is empty" }],
        },
      ],
    })
    expect([...resolveMentions(doc, EXAMPLE_LIBRARY).bindings.keys()]).toEqual([])
  })

  it("binds a shot's own prose to its own key", () => {
    const doc = productionDocumentSchema().parse({
      format: "nodaro-studio-production",
      version: 1,
      scenes: [
        {
          shots: [
            { seconds: 4, text: "the alley is empty" },
            { seconds: 4, text: "@Natalie turns the corner" },
          ],
        },
      ],
    })
    const out = resolveMentions(doc, EXAMPLE_LIBRARY)
    expect(out.bindings.get("0.shot:0")).toBeUndefined()
    expect(out.bindings.get("0.shot:1")?.map((r) => r.id)).toEqual(["char-natalie"])
  })

  it("binds the longest matching name first", () => {
    const library = [candidate("c1", "Andre"), candidate("c2", "Andre Williams 2")]
    const doc = productionDocumentSchema().parse({
      format: "nodaro-studio-production",
      version: 1,
      scenes: [{ frame: { prompt: "@Andre Williams 2 arrives" } }],
    })
    const out = resolveMentions(doc, library)
    expect(out.bindings.get("0.frame")?.map((r) => r.id)).toEqual(["c2"])
  })

  it("lists an unresolved cast member once, however often it is mentioned", () => {
    const doc = productionDocumentSchema().parse({
      format: "nodaro-studio-production",
      version: 1,
      scenes: [
        { frame: { prompt: "@Marco waits" } },
        { frame: { prompt: "@Marco runs" } },
      ],
      cast: [{ kind: "character", name: "Marco" }],
    })
    const out = resolveMentions(doc, EXAMPLE_LIBRARY)
    expect(out.warnings.map((w) => w.code)).toEqual(["unresolved-cast"])
    expect(out.warnings[0].path).toBe("cast[0]")
  })

  it("lists a cast member repeated by two rows once", () => {
    const doc = productionDocumentSchema().parse({
      format: "nodaro-studio-production",
      version: 1,
      scenes: [{ frame: { prompt: "@Marco waits" } }],
      cast: [
        { kind: "character", name: "Marco" },
        { kind: "character", name: " marco " },
      ],
    })
    const out = resolveMentions(doc, EXAMPLE_LIBRARY)
    expect(out.warnings.map((w) => w.path)).toEqual(["cast[0]"])
  })

  it("leaves an @ run that names nobody in the cast alone", () => {
    const doc = productionDocumentSchema().parse({
      format: "nodaro-studio-production",
      version: 1,
      scenes: [{ frame: { prompt: "meet me @ the fountain" } }],
    })
    expect(resolveMentions(doc, EXAMPLE_LIBRARY).warnings).toEqual([])
  })

  it("flags a name two kinds share", () => {
    // These rows declare no `kind` (the older candidate sources don't know it),
    // so both still match the row's name and the ambiguity stands — the test
    // below is the kind-BEARING half.
    const library = [
      candidate("c-river", "River"),
      candidate("l-river", "River", "wired-location"),
    ]
    const doc = productionDocumentSchema().parse({
      format: "nodaro-studio-production",
      version: 1,
      scenes: [{ frame: { prompt: "@River at dawn" } }],
      cast: [{ kind: "location", name: "River" }],
    })
    const out = resolveMentions(doc, library)
    // Ambiguous is not unresolved: one of them IS bound (§3 leaves which one
    // unspecified), and the preview asks the user to check it.
    expect(out.bindings.get("0.frame")).toHaveLength(1)
    expect(out.warnings.map((w) => w.code)).toEqual(["ambiguous-cast"])
  })

  it("binds a cast row to a library entity of its OWN kind", () => {
    // A location called River is not the character the row asks for: the name
    // alone bound them, so a production whose cast named a character landed on
    // whatever shared the name.
    const location = candidate("l-river", "River", "wired-location", "location")
    const character = candidate("c-river", "River", "wired-character", "character")
    const doc = productionDocumentSchema().parse({
      format: "nodaro-studio-production",
      version: 1,
      scenes: [{ frame: { prompt: "@River at dawn" } }],
      cast: [{ kind: "character", name: "River" }],
    })

    expect(resolveMentions(doc, [location]).warnings.map((w) => w.code)).toEqual([
      "unresolved-cast",
    ])
    // With the character present the row binds to HER — and to her ALONE, so the
    // name is not ambiguous either.
    expect(resolveMentions(doc, [location, character]).warnings).toEqual([])
  })

  it("binds the PROSE to the row's own entity, not the name-twin listed first", () => {
    // The pool arrives characters-then-locations, so a LOCATION row's twin is
    // the one the kind-blind binder reached first: the preview named the
    // location the row asked for while the chips landed on the character, and
    // a recast keyed off the bound row then matched no chip at all. The
    // declared row decides what its name means in the prose too.
    const character = candidate("c-river", "River", "wired-character", "character")
    const location = candidate("l-river", "River", "wired-location", "location")
    const doc = productionDocumentSchema().parse({
      format: "nodaro-studio-production",
      version: 1,
      scenes: [{ frame: { prompt: "@River at dusk" } }],
      cast: [{ kind: "location", name: "River" }],
    })
    const out = resolveMentions(doc, [character, location])
    expect(out.bindings.get("0.frame")?.map((r) => r.id)).toEqual(["l-river"])
    // Not ambiguous either: the row has exactly one entity of its own kind.
    expect(out.warnings).toEqual([])
  })

  it("keeps an UNRESOLVED row's name out of the prose pool too", () => {
    // The mirror of the case above. The row bound nothing, so nothing narrowed
    // the pool — and the kind-blind binder then bound the prose to the very
    // location the row had REJECTED, silently, under an `unresolved-cast`
    // warning saying the name was not in the library. A declared name means
    // what its row says it means, and a row that binds nothing says the name is
    // unbindable: the mention stays prose (D4).
    const location = candidate("l-river", "River", "wired-location", "location")
    const doc = productionDocumentSchema().parse({
      format: "nodaro-studio-production",
      version: 1,
      scenes: [{ frame: { prompt: "@River at dawn" } }],
      cast: [{ kind: "character", name: "River" }],
    })
    const out = resolveMentions(doc, [location])
    expect(out.bindings.get("0.frame")).toBeUndefined()
    expect(out.warnings.map((w) => w.code)).toEqual(["unresolved-cast"])
  })

  it("can't place a cast entry whose kind this studio doesn't know, even one the library names", () => {
    const doc = productionDocumentSchema().parse({
      format: "nodaro-studio-production",
      version: 1,
      scenes: [{ frame: { prompt: "@Natalie waits" } }],
      cast: [{ kind: "vehicle", name: "Natalie" }],
    })
    const out = resolveMentions(doc, EXAMPLE_LIBRARY)
    // The PROSE still binds — only the cast row is beyond this studio (D13).
    expect(out.bindings.get("0.frame")?.map((r) => r.id)).toEqual(["char-natalie"])
    expect(out.warnings.map((w) => w.code)).toEqual(["unresolved-cast"])
    expect(out.warnings[0].message).toContain("vehicle")
  })

  it("resolves a cast row of EVERY kind the published contract allows", () => {
    // The kind vocabulary lives in four places. A fifth kind added to the format
    // but not to this stage would warn `unresolved-cast` on every row of it with
    // the suite green, so the kinds are read back out of the PUBLISHED schema
    // and one row of each is resolved for real.
    const published = renderStrictJsonSchema(buildFormatRegistry()) as unknown as {
      properties: { cast: { items: { properties: { kind: { enum: string[] } } } } }
    }
    const kinds = published.properties.cast.items.properties.kind.enum
    expect(kinds.length).toBeGreaterThan(0)
    const doc = productionDocumentSchema().parse({
      format: "nodaro-studio-production",
      version: 1,
      scenes: [{ frame: { prompt: "a wide alley at dusk" } }],
      cast: kinds.map((kind, i) => ({ kind, name: `Extra ${i}` })),
    })
    const library = kinds.map((_, i) => candidate(`e${i}`, `Extra ${i}`))
    expect(resolveMentions(doc, library).warnings).toEqual([])
  })

  it("judges a library name exactly as the binder does, a cast name leniently", () => {
    const doc = productionDocumentSchema().parse({
      format: "nodaro-studio-production",
      version: 1,
      scenes: [{ frame: { prompt: "@Natalie waits" } }],
      cast: [{ kind: "character", name: " Natalie " }],
    })
    // The DOCUMENT's own name is trimmed — stray whitespace is authoring noise…
    expect(resolveMentions(doc, EXAMPLE_LIBRARY).warnings).toEqual([])
    // …but a LIBRARY row carrying whitespace can never bind `@Natalie`, so the
    // cast row that needs it is unresolved rather than reported as bound.
    const out = resolveMentions(doc, [candidate("c-space", " Natalie")])
    expect(out.bindings.get("0.frame")).toBeUndefined()
    expect(out.warnings.map((w) => w.code)).toEqual(["unresolved-cast"])
  })
})

/**
 * BOTH PROSE SPELLINGS ON THE IMPORT PATH (C6).
 *
 * An imported document is the prose that arrives token-bearing most often: a
 * cast chip serializes as its `@<role-slug>` token, so an EXPORTED production
 * says `@panda-2`, never `@Panda 2`. `resolveMentions` reads both because it
 * DELEGATES to the load path's own `recoverTypedMentions` rather than carrying a
 * rule of its own — and that delegation is exactly what these pin, since it is
 * the kind of property a well-meaning "just match the name here" refactor
 * silently removes.
 */
describe("resolve — the C6 token spelling", () => {
  const bindingOf = (
    prompt: string,
    library: ReadonlyArray<MentionCandidate>,
  ): string[] | undefined =>
    resolveMentions(
      productionDocumentSchema().parse({
        format: "nodaro-studio-production",
        version: 1,
        scenes: [{ frame: { prompt } }],
      }),
      library,
    )
      .bindings.get("0.frame")
      ?.map((r) => r.id)

  const PANDA = candidate("c-panda-2", "Panda 2")
  const VALLEY = candidate("l-valley", "Sunspire Valley", "wired-location")

  it("binds a role TOKEN, as the editor's own restore does", () => {
    expect(bindingOf("@panda-2 walking in @sunspire-valley", [PANDA, VALLEY])).toEqual([
      "c-panda-2",
      "l-valley",
    ])
  })

  it("still binds the bare NAME form — a pre-C6 document imports unchanged", () => {
    expect(bindingOf("@Panda 2 walking in @Sunspire Valley", [PANDA, VALLEY])).toEqual([
      "c-panda-2",
      "l-valley",
    ])
  })

  it("mixes the two spellings in one prose field", () => {
    // A production mid-migration: one chip enrolled in the cast, one not.
    const natalie = candidate("c-natalie", "Natalie")
    expect(bindingOf("@Natalie beside @panda-2", [natalie, PANDA])).toEqual([
      "c-natalie",
      "c-panda-2",
    ])
  })

  it("claims a token WHOLE — `@panda` never binds inside `@panda-2`", () => {
    // The `-2` key is minted precisely when a "Panda" already exists, so this
    // collision is the norm wherever a suffixed role is. Binding the short one
    // would import the WRONG actor, silently.
    expect(bindingOf("@panda-2 walks", [candidate("c-panda", "Panda")])).toBeUndefined()
    expect(
      bindingOf("@panda-2 walks", [candidate("c-panda", "Panda"), PANDA]),
    ).toEqual(["c-panda-2"])
  })

  it("runs ONE longest-first order across both spellings", () => {
    // `@andre` (a token) must not claim the head of `@Andre Williams 2` (a name)
    // merely because tokens are the newer form.
    expect(
      bindingOf("@Andre Williams 2 arrives", [
        candidate("c-andre", "Andre"),
        candidate("c-andre-2", "Andre Williams 2"),
      ]),
    ).toEqual(["c-andre-2"])
  })
})

/**
 * STAGE 4'S OWN ORDER (D41): canonicalize, then resolve. The two halves are
 * pinned together here because the defect they close lives in the SEAM — a
 * library "young" ending inside `@Young Man in Red Jacket` — and each half on
 * its own looks correct (the canonicalizer's own cases are in
 * `import-canonical-mentions.test.ts`).
 */
describe("resolve — after a declared name canonicalizes", () => {
  const stage4 = (
    prompt: string,
    cast: ReadonlyArray<{ kind: string; name: string }>,
    library: ReadonlyArray<MentionCandidate>,
  ) =>
    resolveMentions(
      canonicalizeDeclaredMentions(
        productionDocumentSchema().parse({
          format: "nodaro-studio-production",
          version: 2,
          scenes: [{ frame: { prompt } }],
          cast,
        }),
      ),
      library,
    )

  const YOUNG_MAN = [{ kind: "character", name: "Young Man in Red Jacket" }]

  it("binds NOTHING where a shorter library name used to claim the first word", () => {
    const out = stage4("@Young Man in Red Jacket stands", YOUNG_MAN, [
      candidate("c-young", "young"),
    ])
    // `@young-man-in-red-jacket` is one token: "young" can't end inside it (a
    // `-` continues the run) and the token isn't claimed whole either.
    expect(out.bindings.get("0.frame")).toBeUndefined()
    expect(out.warnings.map((w) => w.code)).toEqual(["unresolved-cast"])
    expect(out.warnings[0].message).toContain("Young Man in Red Jacket")
  })

  it("still binds a declared name the library HAS — through the token", () => {
    const out = stage4(
      "@Zoo Elephants trumpet",
      [{ kind: "creature", name: "Zoo Elephants" }],
      [candidate("c-zoo", "Zoo Elephants")],
    )
    expect(out.bindings.get("0.frame")?.map((r) => r.id)).toEqual(["c-zoo"])
    expect(out.warnings).toEqual([])
  })

  it("leaves the prefix ladder for an UNDECLARED run alone", () => {
    // Nothing declares "Old Library Annex", so the run keeps the reading it has
    // always had: the longest library name that ends at a name boundary.
    const out = stage4("@Old Library Annex is quiet", YOUNG_MAN, [
      candidate("l-old", "Old Library", "wired-location"),
    ])
    expect(out.bindings.get("0.frame")?.map((r) => r.id)).toEqual(["l-old"])
  })
})
