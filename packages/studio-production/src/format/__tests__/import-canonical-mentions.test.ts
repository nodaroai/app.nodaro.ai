import { describe, it, expect } from "vitest"

import type { ReferenceSource } from "@nodaro/shared"

import { castKeyForName, castSlug } from "../../cast"
import { videoDurationOptions } from "../../model-menu"
import {
  importProduction,
  type ImportOptions,
  type ImportResult,
} from "../import"
import { canonicalizeDeclaredMentions } from "../import-canonical-mentions"
import {
  bindablePassages,
  mapBindablePassages,
} from "../import-passages"
import {
  productionDocumentSchema,
  type ProductionDocument,
} from "../schema"
import type { MentionCandidate } from "../../prompt-mentions"

/**
 * Stage 4's CANONICALIZE half (D41) — a declared cast name arrives as its own
 * role token, so a shorter library name can no longer bind inside a longer
 * declared one (`@Young Man in Red Jacket` with a library "young").
 *
 * The local builders below are this file's OWN copies rather than an import
 * from a sibling: importing a `.test.ts` file would re-run its `describe`/`it`
 * blocks a second time — the same standalone-with-local-fixtures precedent the
 * rest of this suite keeps.
 */

// `source` MUST be annotated: `ConnectedReference.source` is the narrow union
// `ReferenceSource`, and an unannotated default widens the parameter to `string`.
const candidate = (
  id: string,
  name: string,
  source: ReferenceSource = "wired-character",
): MentionCandidate => ({
  id,
  name,
  toConnectedReference: () => ({
    id,
    defaultName: name,
    source,
    url: `https://r2.example/${id}.png`,
  }),
})

/** The staging repro's own cast (2026-09-04): three declared names, none of
 *  them in the library, one of them starting with a word the library HAS. */
const ZOO_CAST = [
  { kind: "character", name: "Young Man in Red Jacket" },
  { kind: "creature", name: "Zoo Elephants" },
  { kind: "location", name: "Zoo Elephant Exhibit" },
]

const docWith = (
  cast: ReadonlyArray<{ kind: string; name: string }>,
  ...prompts: string[]
): ProductionDocument =>
  productionDocumentSchema().parse({
    format: "nodaro-studio-production",
    version: 2,
    scenes: prompts.map((prompt) => ({ frame: { prompt } })),
    cast,
  })

const frameProse = (doc: ProductionDocument, i = 0): string | undefined =>
  doc.scenes[i]?.frame?.prompt

const canonical = (
  cast: ReadonlyArray<{ kind: string; name: string }>,
  prompt: string,
): string | undefined => frameProse(canonicalizeDeclaredMentions(docWith(cast, prompt)))

describe("canonicalizeDeclaredMentions", () => {
  it("rewrites every declared name to its role token — the staging repro", () => {
    expect(
      canonical(
        ZOO_CAST,
        "@Young Man in Red Jacket stands in front of @Zoo Elephant Exhibit with @Zoo Elephants",
      ),
    ).toBe(
      "@young-man-in-red-jacket stands in front of @zoo-elephant-exhibit with @zoo-elephants",
    )
  })

  it("reads a declared name case-insensitively", () => {
    expect(canonical(ZOO_CAST, "@young man in red jacket waits")).toBe(
      "@young-man-in-red-jacket waits",
    )
  })

  it("reads a name an author spaced twice", () => {
    // The dangerous spelling: `castMentionRuns` STOPS at a double space, so the
    // run the editor's ladder sees is the bare "Young" — exactly the first-word
    // capture this canonicalization exists to remove. The walk reads the run
    // itself and compares on `castKeyForName`, which collapses the gap.
    expect(canonical(ZOO_CAST, "@Young  Man in Red Jacket waits")).toBe(
      "@young-man-in-red-jacket waits",
    )
  })

  it("lets the LONGER declared name win", () => {
    const cast = [
      { kind: "location", name: "Zoo" },
      { kind: "creature", name: "Zoo Elephants" },
    ]
    expect(canonical(cast, "@Zoo Elephants eat")).toBe("@zoo-elephants eat")
  })

  it("leaves an @ run no cast row declares alone", () => {
    // The prefix ladder for UNDECLARED runs is untouched: `@Old Library Annex`
    // against a library "Old Library" still binds "Old Library" downstream.
    expect(canonical(ZOO_CAST, "@Old Library Annex is quiet")).toBe(
      "@Old Library Annex is quiet",
    )
  })

  it("leaves a declared name that can't address a role alone", () => {
    // `roleTokenForName("3D Render")` is null — a slug must start with a letter.
    expect(canonical([{ kind: "object", name: "3D Render" }], "@3D Render sits")).toBe(
      "@3D Render sits",
    )
  })

  it("is idempotent — prose that already carries the token is untouched", () => {
    expect(canonical(ZOO_CAST, "@young-man-in-red-jacket stands")).toBe(
      "@young-man-in-red-jacket stands",
    )
  })

  it("keeps punctuation the name doesn't own", () => {
    // A name ends on an alphanumeric, so a possessive is prose, not part of the
    // name — and `@zoo-elephants'` is still a WHOLE token.
    expect(canonical(ZOO_CAST, "inside @Zoo Elephants' enclosure")).toBe(
      "inside @zoo-elephants' enclosure",
    )
  })

  it("ends a name before a POSSESSIVE on its own last word", () => {
    // The end the BINDER would have used: `endsTypedName` says a name ends at
    // an apostrophe, and an author writes a character's possessive constantly —
    // a name that only ended on a word BOUNDARY missed this one and handed the
    // library "young" the head of the run all over again.
    expect(canonical(ZOO_CAST, "@Young Man in Red Jacket's hand reaches")).toBe(
      "@young-man-in-red-jacket's hand reaches",
    )
    expect(canonical(ZOO_CAST, "@Young Man in Red Jacket’s hand reaches")).toBe(
      "@young-man-in-red-jacket’s hand reaches",
    )
  })

  it("reads a run exactly as far as the run scanner does", () => {
    // The drift pin between this walk and `castMentionRuns`: a declared
    // name spanning what reads as trailing prose claims the WHOLE run, which is
    // the run the editor's ladder would have walked.
    expect(canonical([{ kind: "creature", name: "Zoo Elephants eat" }], "@Zoo Elephants eat")).toBe(
      "@zoo-elephants-eat",
    )
  })

  it("leaves an email address alone", () => {
    expect(canonical(ZOO_CAST, "mail me at me@zoo.example")).toBe(
      "mail me at me@zoo.example",
    )
  })

  it("rewrites EVERY bindable passage, not only the frame", () => {
    const doc = productionDocumentSchema().parse({
      format: "nodaro-studio-production",
      version: 2,
      scenes: [
        {
          frame: { prompt: "@Zoo Elephants at dawn" },
          motion: { prompt: "@Zoo Elephants turn" },
          shots: [{ seconds: 4, text: "@Zoo Elephants trumpet" }],
        },
      ],
      cast: ZOO_CAST,
    })
    expect(bindablePassages(canonicalizeDeclaredMentions(doc)).map((p) => p.text)).toEqual([
      "@zoo-elephants at dawn",
      "@zoo-elephants turn",
      "@zoo-elephants trumpet",
    ])
  })

  it("returns the SAME document when nothing moves", () => {
    const doc = docWith(ZOO_CAST, "a wide alley at dusk")
    expect(canonicalizeDeclaredMentions(doc)).toBe(doc)
    const castless = docWith([], "@Young Man in Red Jacket waits")
    expect(canonicalizeDeclaredMentions(castless)).toBe(castless)
  })

  it("never mutates the document it was given", () => {
    const doc = docWith(ZOO_CAST, "@Zoo Elephants at dawn")
    canonicalizeDeclaredMentions(doc)
    expect(frameProse(doc)).toBe("@Zoo Elephants at dawn")
  })

  it("hands the editor's ladder ONE hyphenated word", () => {
    // Why the token is the safe spelling: the restore sweep walks a run's
    // prefixes, and a token is a single word to `AT_TOKEN_RE` — so "young" can
    // never be re-enrolled out of prose that names the young man.
    expect(castKeyForName("young-man-in-red-jacket")).toBe(
      castSlug("character", "Young Man in Red Jacket"),
    )
    expect(castKeyForName("young-man-in-red-jacket")).not.toBe(castKeyForName("young"))
  })
})

/**
 * The WRITE side of {@link bindablePassages} — the pair that keeps ONE list of
 * prose fields. A passage the reader enumerates and the writer skips would let
 * a mention land un-canonicalized in exactly the field the resolver binds.
 */
describe("mapBindablePassages", () => {
  const doc = productionDocumentSchema().parse({
    format: "nodaro-studio-production",
    version: 2,
    scenes: [
      { frame: { prompt: "one" }, motion: { prompt: "two" } },
      { shots: [{ seconds: 4, text: "three" }, { seconds: 4, text: "four" }] },
    ],
  })

  it("rewrites exactly the passages the reader enumerates", () => {
    const out = mapBindablePassages(doc, () => "X")
    expect(bindablePassages(doc)).toHaveLength(4)
    expect(bindablePassages(out).map((p) => p.text)).toEqual(["X", "X", "X", "X"])
    expect(bindablePassages(out).map((p) => p.key)).toEqual(
      bindablePassages(doc).map((p) => p.key),
    )
  })

  it("returns the SAME document when the rewriter changes nothing", () => {
    expect(mapBindablePassages(doc, (text) => text)).toBe(doc)
  })
})

/**
 * The wiring (§6.4): the canonical prose is what RESOLVE reads, what MAP lands
 * on the shots and what the preview counts.
 */
describe("import — the canonical spelling through the pipeline", () => {
  const opts = (candidates: ReadonlyArray<MentionCandidate>): ImportOptions => ({
    candidates,
    durationsFor: (model) => videoDurationOptions(model).map((d) => d.value),
  })

  const run = (
    cast: ReadonlyArray<{ kind: string; name: string }>,
    prompt: string,
    candidates: ReadonlyArray<MentionCandidate>,
  ): ImportResult =>
    importProduction(
      {
        format: "nodaro-studio-production",
        version: 2,
        scenes: [{ frame: { prompt } }],
        cast,
      },
      opts(candidates),
    )

  it("lands the token, binds nothing, and lists the row once", () => {
    const out = run(
      ZOO_CAST,
      "@Young Man in Red Jacket stands",
      [candidate("c-young", "young")],
    )
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.shots[0]?.plan?.frame?.prompt).toBe("@young-man-in-red-jacket stands")
    // The library "young" can no longer end inside the token (`-` continues the
    // run), so RESOLVE binds nothing at all…
    expect(out.shots[0]?.plan?.frame?.references).toBeUndefined()
    // …and the row is still reported, exactly once.
    expect(
      out.warnings.filter(
        (w) => w.code === "unresolved-cast" && w.message.includes("Young Man in Red Jacket"),
      ),
    ).toHaveLength(1)
    expect(out.summary.unresolvedCast.map((c) => c.name)).toContain("Young Man in Red Jacket")
  })

  it("still binds a declared name the library HAS, through the token", () => {
    const zoo = candidate("c-zoo", "Zoo Elephants", "wired-character")
    const out = run(ZOO_CAST, "@Zoo Elephants trumpet", [zoo])
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.shots[0]?.plan?.frame?.prompt).toBe("@zoo-elephants trumpet")
    expect(out.shots[0]?.plan?.frame?.references).toEqual([zoo.toConnectedReference()])
  })

  it("counts the same mentions before and after — a token is still one run", () => {
    const prompt = "@Young Man in Red Jacket meets @Zoo Elephants"
    const withCast = run(ZOO_CAST, prompt, [])
    const withoutCast = run([], prompt, [])
    expect(withCast.ok && withCast.summary.mentions).toBe(2)
    expect(withoutCast.ok && withoutCast.summary.mentions).toBe(2)
  })
})
