import { describe, it, expect } from "vitest"

import type { CastKind } from "../../cast"
import { videoDurationOptions } from "../../model-menu"
import example from "../fixtures/example.json"
import { EXAMPLE_LIBRARY } from "../fixtures/library"
import { importProduction, type ImportOptions } from "../import"
import { buildFormatRegistry } from "../registry"
import { castMentionRuns } from "../../cast-mention-runs"
import { recoverTypedMentions, type MentionCandidate } from "../../prompt-mentions"

/**
 * The PREVIEW SUMMARY `importProduction` hands the dialog (§6.6) — what the
 * receipt claims will land, and the `mentions` gate signal underneath it
 * (A5/B12). Split out of `import.test.ts` in the follow-ups fix wave once that
 * file passed the 800-line house cap: the summary is the one area of the
 * end-to-end suite with a contract of its own — `coverage-guard.test.ts`
 * partitions every field into "has a receipt" and "does not" — so it reads as
 * its own suite rather than a third of another one.
 *
 * The local builders below are this file's OWN copies rather than an import
 * from a sibling: importing a `.test.ts` file would re-run its `describe`/`it`
 * blocks a second time — the same standalone-with-local-fixtures precedent
 * `production-bundle.recipe.test.ts` set. Every case is a PURE MOVE.
 */

/** A library row, this file's own copy of `import.test.ts`'s builder (the
 *  local-fixtures rule above). */
const candidate = (id: string, name: string, kind?: CastKind): MentionCandidate => ({
  id,
  name,
  ...(kind ? { kind } : {}),
  toConnectedReference: () => ({
    id,
    defaultName: name,
    source: "wired-character",
    url: `https://r2.example/${id}.png`,
  }),
})

const REGISTRY = buildFormatRegistry()

const options = (
  candidates = EXAMPLE_LIBRARY,
): ImportOptions => ({
  candidates,
  durationsFor: (model) => videoDurationOptions(model).map((d) => d.value),
  registry: REGISTRY,
})

describe("importProduction — the preview summary", () => {
  it("summarises what would land", () => {
    const out = importProduction(example, options())
    expect(out.ok && out.summary).toEqual({
      scenes: 1,
      shots: 2,
      seconds: 10,
      imageModels: ["gpt-image-2"],
      videoModels: ["seedance-2"],
      lookPicks: 6,
      // The two shots' own ways IN, plus the scene's one way OUT
      // (`motion.endTransition`) — one receipt for one catalog in two seats.
      transitions: 3,
      cast: 1,
      castBound: 1,
      unresolvedCast: [],
      // WHO the one declared name bound to — the row the preview lists so a
      // library entity that answered for a name can be seen (and recast)
      // before anything lands.
      boundCast: [
        {
          entry: {
            kind: "character",
            name: "Natalie",
            description: "late 20s, red raincoat",
            imageUrl: "https://cdn.nodaro.ai/images/example-natalie.png",
          },
          candidateId: "char-natalie",
          candidateName: "Natalie",
        },
      ],
      // D7's worked example carries shots[0].audio: a speech cue and an sfx
      // cue (D3).
      audioCues: 2,
      // The fixture carries a root `brief`, a root `music` that survives
      // repair, and one scene's `voice` (A5, R60).
      brief: true,
      music: true,
      voices: 1,
      // One `@Natalie` in the frame prompt — DISTINCT `@` RUNS, counted off
      // the document rather than off what bound (B12).
      mentions: 1,
    })
  })

  /**
   * B12 — the count the dialog's readiness gate keys on. It is a property of
   * the DOCUMENT: the state it exists for is the one where no library is in
   * hand, so a count that needed candidates (what the BINDER reads) would be
   * zero exactly when it matters.
   */
  it("counts DISTINCT @ runs across every prose field the binder reads, library or not", () => {
    const doc = {
      format: "nodaro-studio-production",
      version: 2,
      scenes: [
        {
          frame: { prompt: "@Natalie, alone in the @Alley." },
          shots: [
            { seconds: 4, text: "@natalie, then she turns" },
            { seconds: 4, text: "rain falls" },
          ],
        },
        // A scene with no shots, so its `motion.prompt` survives repair — the
        // third field the binder reads.
        { frame: { prompt: "the alley again" }, motion: { prompt: "@NATALIE." } },
      ],
    }
    // Natalie (three spellings, case-folded to one) + Alley — and no `cast[]`
    // row in sight, which is the whole prose-only case the gate was missing.
    const out = importProduction(doc, options())
    expect(out.ok && out.summary.mentions).toBe(2)
    expect(out.ok && out.summary.cast).toBe(0)
  })

  /**
   * Fix round 1 (A5): deduped on the WHOLE `@` run, not on its first word.
   * Counting by first word made every `@Old …` one mention, so a plan naming
   * two different two-word roles read as one.
   */
  it("keeps two different multi-word mentions apart", () => {
    const doc = {
      format: "nodaro-studio-production",
      version: 2,
      scenes: [{ frame: { prompt: "@Old Library, then @Old Tavern" } }],
    }
    const out = importProduction(doc, options())
    expect(out.ok && out.summary.mentions).toBe(2)
  })

  it("…and a document that names nobody counts none", () => {
    const doc = {
      format: "nodaro-studio-production",
      version: 2,
      scenes: [{ frame: { prompt: "an empty alley at dawn" } }],
    }
    const out = importProduction(doc, options())
    expect(out.ok && out.summary.mentions).toBe(0)
  })

  it("brief/music/voices are false/false/0 when the document carries none of them (A5)", () => {
    const out = importProduction(
      {
        format: "nodaro-studio-production",
        version: 1,
        scenes: [{ frame: { prompt: "a plain scene" } }],
      },
      options([]),
    )
    expect(out.ok && out.summary).toMatchObject({
      brief: false,
      music: false,
      voices: 0,
    })
  })

  it("voices counts every scene whose voice survived repair, not just the first", () => {
    const out = importProduction(
      {
        format: "nodaro-studio-production",
        version: 1,
        scenes: [
          { frame: { prompt: "scene one" }, voice: { text: "Go now" } },
          { frame: { prompt: "scene two" }, voice: { text: "Wait" } },
          { frame: { prompt: "scene three" } },
          // A voiceover with no words is dropped by `repairVoice` before this
          // scene's `voice` ever reaches `summarize` — it must not inflate
          // the count the way a naive "the document names one" read would.
          { frame: { prompt: "scene four" }, voice: { text: "   " } },
        ],
      },
      options([]),
    )
    expect(out.ok && out.summary.voices).toBe(2)
  })

  it("brief only counts once trimmed non-blank, and music only once it survives repair", () => {
    const blank = importProduction(
      {
        format: "nodaro-studio-production",
        version: 1,
        brief: "   ",
        scenes: [{ frame: { prompt: "a plain scene" } }],
      },
      options([]),
    )
    expect(blank.ok && blank.summary.brief).toBe(false)

    // An unparseable `music` node is DROPPED by repair (D11) — the receipt
    // must read that outcome, not the document's raw claim to carry one.
    const badMusic = importProduction(
      {
        format: "nodaro-studio-production",
        version: 1,
        music: { prompt: "" },
        scenes: [{ frame: { prompt: "a plain scene" } }],
      },
      options([]),
    )
    expect(badMusic.ok && badMusic.summary.music).toBe(false)
  })

  it("castBound counts DISTINCT names that matched, not rows minus unresolved", () => {
    // `cast` is a raw row count and `unresolvedCast` is de-duped by name, so
    // `cast - unresolved.length` over-counts the moment a document asks for the
    // same actor twice — the preview then says "1 bound" about a library that
    // has nobody.
    const twice = {
      format: "nodaro-studio-production",
      version: 1,
      scenes: [{ frame: { prompt: "@Natalie waits" } }],
      cast: [
        { kind: "character" as const, name: "Natalie" },
        { kind: "character" as const, name: "Natalie", description: "again" },
      ],
    }
    const empty = importProduction(twice, options([]))
    expect(empty.ok && empty.summary).toMatchObject({
      cast: 2,
      castBound: 0,
    })
    expect(empty.ok && empty.summary.unresolvedCast).toHaveLength(1)

    // …and one library row binds the NAME, however many rows asked for it.
    const found = importProduction(twice, options())
    expect(found.ok && found.summary).toMatchObject({ cast: 2, castBound: 1 })
    // The BOUND rows are counted by the same rule, off the same enumeration:
    // one row per name, naming who it bound to.
    expect(found.ok && found.summary.boundCast).toEqual([
      {
        entry: { kind: "character", name: "Natalie" },
        candidateId: "char-natalie",
        candidateName: "Natalie",
      },
    ])
  })

  /**
   * An AMBIGUOUS name (two library rows share it) still binds — `resolveMentions`
   * warns and `recoverTypedMentions` takes the first spelling that hits, which is
   * the first candidate in library order. The preview lists that same candidate,
   * because a list that named the other one would be telling the user about a
   * binding nobody is going to get.
   */
  it("names the candidate RESOLVE actually bound for an ambiguous name", () => {
    const twins = [
      candidate("char-young-a", "Young"),
      candidate("char-young-b", "Young"),
    ]
    const doc = {
      format: "nodaro-studio-production",
      version: 2,
      scenes: [{ shots: [{ seconds: 4, text: "@Young waits" }] }],
      cast: [{ kind: "character" as const, name: "Young" }],
    }
    const out = importProduction(doc, options(twins))
    expect(out.ok && out.summary.boundCast).toEqual([
      {
        entry: { kind: "character", name: "Young" },
        candidateId: "char-young-a",
        candidateName: "Young",
      },
    ])
    // The truth check: the reference that actually landed on the shot is the
    // one the row names.
    expect(out.ok && out.shots[0].beats?.[0].references?.[0]?.id).toBe("char-young-a")
    expect(out.ok && out.warnings.map((w) => w.code)).toContain("ambiguous-cast")
  })

  it("lists the bound row of the cast entry's OWN kind, not the name-twin", () => {
    // The library is scanned by NAME, so a location called River bound a
    // character row and the preview promised the wrong entity. A row binds
    // within its own kind; a name-twin of another kind is not a match at all.
    const twins = [
      candidate("l-river", "River", "location"),
      candidate("c-river", "River", "character"),
    ]
    const doc = {
      format: "nodaro-studio-production",
      version: 2,
      scenes: [{ shots: [{ seconds: 4, text: "@River waits" }] }],
      cast: [{ kind: "character" as const, name: "River" }],
    }
    const out = importProduction(doc, options(twins))
    expect(out.ok && out.summary.boundCast).toEqual([
      {
        entry: { kind: "character", name: "River" },
        candidateId: "c-river",
        candidateName: "River",
      },
    ])
    // The truth check: the chip that landed is the row the preview names.
    expect(out.ok && out.shots[0].beats?.[0].references?.[0]?.id).toBe("c-river")
    // One match, so the name is not ambiguous either.
    expect(out.ok && out.warnings.map((w) => w.code)).not.toContain("ambiguous-cast")

    // …and with only the location in the library the row has nothing of its own
    // kind to bind to.
    const alone = importProduction(doc, options([twins[0]!]))
    expect(alone.ok && alone.summary.castBound).toBe(0)
    expect(alone.ok && alone.summary.unresolvedCast).toEqual([
      { kind: "character", name: "River" },
    ])
    // …and nothing lands on the PROSE either: an unresolved row still speaks
    // for its name, so the location it rejected can't answer `@River` behind
    // the warning's back — the mention stays prose (D4).
    expect(alone.ok && alone.shots[0].beats?.[0].references).toBeUndefined()
  })

  it("lands the chip the bound row names, whichever twin the library lists first", () => {
    // The cast pool arrives characters-then-locations, so a LOCATION row's
    // twin is the one the prose binder used to reach first: `boundCast` named
    // the location and the chip was the character, and `useLandProduction`'s
    // recast — keyed off `candidateId` — then addressed a chip that wasn't
    // there. The two are one rule now, so this asserts them against each other.
    const twins = [
      candidate("c-river", "River", "character"),
      candidate("l-river", "River", "location"),
    ]
    const doc = {
      format: "nodaro-studio-production",
      version: 2,
      scenes: [{ shots: [{ seconds: 4, text: "@River waits" }] }],
      cast: [{ kind: "location" as const, name: "River" }],
    }
    const out = importProduction(doc, options(twins))
    expect(out.ok && out.summary.boundCast[0]?.candidateId).toBe("l-river")
    expect(out.ok && out.shots[0].beats?.[0].references?.[0]?.id).toBe(
      out.ok ? out.summary.boundCast[0]?.candidateId : undefined,
    )
    expect(out.ok && out.warnings).toEqual([])
  })

  it("summary.cast counts every cast row in the document, resolved or not (C4)", () => {
    const out = importProduction(
      {
        format: "nodaro-studio-production",
        version: 1,
        scenes: [{ frame: { prompt: "@Marco waits" } }],
        cast: [
          { kind: "character", name: "Marco" },
          { kind: "location", name: "Old Bridge" },
        ],
      },
      options([]),
    )
    // Both rows count toward `cast`, whether or not they resolve — it is the
    // DOCUMENT's own count, not "how many bound".
    expect(out.ok && out.summary.cast).toBe(2)
    expect(out.ok && out.summary.unresolvedCast).toHaveLength(2)
  })

  it("counts a scene with no shots by its clip length", () => {
    // The OTHER half of the summary's seconds: a scene that is still a plan
    // contributes its `motion.duration`, so the preview's "…· 14s" is the
    // production's length whether or not its scenes have been broken into shots.
    // `durationsFor` is pinned here so the branch is measured, not the catalog's
    // clip-length ladder.
    const out = importProduction(
      {
        format: "nodaro-studio-production",
        version: 1,
        scenes: [
          { motion: { prompt: "she runs", duration: 8 } },
          { motion: { prompt: "the SUV swerves", duration: 6 } },
        ],
      },
      { ...options(), durationsFor: () => [6, 8] },
    )
    expect(out.ok && out.summary).toMatchObject({ scenes: 2, shots: 0, seconds: 14 })
  })
})

/**
 * THE GATE'S OWN PREMISE (H2's A5). `mentions` is counted with
 * `castMentionRuns` (the composer's `@`-run scan, over no library at all) while
 * the thing it gates — a name that will BIND — is found by
 * `recoverTypedMentions` (candidate-driven, its own `@` reading). Two readings
 * of one character is exactly the shape that drifts silently, and only one
 * direction matters: a bindable name the count MISSES lands the document
 * against a library that never arrived, with every name unbound.
 *
 * So the invariant is one-directional — anything the binder binds, the counter
 * counts. The reverse is deliberately false: the counter counts prose that
 * names nobody, which is what makes it a readiness GATE rather than a receipt.
 */
describe("the mentions gate covers what the binder binds (A5)", () => {
  const mentionsIn = (prompt: string): number => {
    const out = importProduction(
      {
        format: "nodaro-studio-production",
        version: 1,
        scenes: [{ frame: { prompt } }],
      },
      options(),
    )
    return out.ok ? out.summary.mentions : -1
  }

  const binds = (text: string) =>
    recoverTypedMentions(text, [], EXAMPLE_LIBRARY).length > 0

  const CORPUS = [
    "@Natalie waits",
    "@natalie waits",
    "the door opens and @Natalie walks in",
    "@Natalie, then @Natalie again",
    "(@Natalie) in brackets",
    "\u201c@Natalie\u201d in quotes",
    "@Natalie's coat",
    "waits. @Natalie",
    "@Natalie",
  ]

  it("every text the binder binds is one the counter counts", () => {
    // The corpus is only worth anything if the binder actually bites on it.
    expect(CORPUS.every(binds)).toBe(true)
    for (const text of CORPUS) expect(mentionsIn(text), text).toBeGreaterThan(0)
  })

  /**
   * THE ONE KNOWN DIVERGENCE, pinned rather than fixed. `castMentionRuns`
   * requires a boundary before the `@` (`(^|[^\p{L}\p{N}@])`); the binder
   * scans for a bare `@` and offers candidate spellings, so a `@` glued to a
   * preceding letter or digit binds while the gate reads zero. Pre-existing and
   * narrow — an address-shaped run is not something a plan author writes as a
   * mention — but it IS the shape that can make the gate miss, so it is written
   * down here instead of discovered again. Closing it means one shared `@`-run
   * enumerator, which is a change to the wire binder, not to this gate.
   */
  it("…except a `@` glued to a preceding word, which binds but does not count", () => {
    expect(castMentionRuns("mail@natalie")).toEqual([])
    expect(binds("mail@natalie")).toBe(true)
    expect(mentionsIn("mail@natalie waits")).toBe(0)
  })
})
