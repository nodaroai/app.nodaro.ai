import { describe, it, expect } from "vitest"
import {
  REFERENCE_ROLE_PRESETS,
  characterMentionSlug,
  locationMentionSlug,
  type ConnectedReference,
} from "@nodaro/shared"

import {
  applyCastLook,
  castEntries,
  castKeyForActor,
  CAST_ROLE_MAX_LENGTH,
  castRolePresets,
  castRoleRenders,
  sanitizeCastRole,
  castSlug,
  copyCast,
  enrollCastMember,
  lookupCastName,
  castMentionRuns,
  memberFromCandidate,
  poolOptions,
  readCast,
  removeCastMember,
  resolveRole,
  scanCastTokens,
  unresolvedCastNames,
  type Cast,
  type CastCandidate,
} from "../cast"

/** A character candidate shaped exactly like `useEntities`' `characterToItem`. */
function character(id: string, name: string, url = `https://r2/${id}.png`): CastCandidate {
  const reference: ConnectedReference = {
    id,
    defaultName: name,
    source: "wired-character",
    url,
    description: undefined,
    characterSlug: characterMentionSlug(name),
    variantSlug: undefined,
    characterCanonicalDescription: `${name}, mid 30s`,
    variantDescription: null,
    variantDisplayName: "canonical",
  }
  return {
    id,
    kind: "character",
    name,
    thumbnailUrl: url,
    toConnectedReference: () => reference,
  }
}

function location(id: string, name: string): CastCandidate {
  const reference: ConnectedReference = {
    id,
    defaultName: name,
    source: "wired-location",
    url: `https://r2/${id}.png`,
    description: "a place",
    locationSlug: locationMentionSlug(name),
    locationCanonicalDescription: "a place",
    locationVariantBucket: undefined,
    locationVariantSlug: undefined,
    locationVariantDisplayName: "canonical",
  }
  return {
    id,
    kind: "location",
    name,
    thumbnailUrl: `https://r2/${id}.png`,
    toConnectedReference: () => reference,
  }
}

describe("D6a — one name, one cast member: a collision suffixes, never overwrites", () => {
  it("the second panda is offered panda-2, and the first is untouched", () => {
    const first = enrollCastMember({}, {
      kind: "creature",
      assetId: "c1",
      displayName: "Panda",
    })!
    expect(first.key).toBe("panda")

    const second = enrollCastMember(first.cast, {
      kind: "creature",
      assetId: "c2",
      displayName: "Panda",
    })!
    expect(second.key).toBe("panda-2")
    // THE INVARIANT: the sitting member is untouched, both bindings survive.
    expect(second.cast["panda"].assetId).toBe("c1")
    expect(second.cast["panda-2"].assetId).toBe("c2")

    const third = enrollCastMember(second.cast, {
      kind: "creature",
      assetId: "c3",
      displayName: "Panda",
    })!
    expect(third.key).toBe("panda-3")
    expect(Object.keys(third.cast).sort()).toEqual(["panda", "panda-2", "panda-3"])
  })

  it("INV-C survives the suffix: the display name still slugs to its key", () => {
    let cast: Cast = {}
    for (let n = 0; n < 4; n += 1) {
      const enrolled = enrollCastMember(cast, {
        kind: "character",
        assetId: `c${n}`,
        displayName: "Kira Vance",
      })!
      cast = enrolled.cast
    }
    for (const [key, member] of Object.entries(cast)) {
      expect(castSlug(member.kind, member.displayName)).toBe(key)
    }
    expect(cast["kira-vance-4"].displayName).toBe("Kira Vance 4")
  })

  it("an unsluggable name enrolls nothing rather than claiming an empty key", () => {
    expect(
      enrollCastMember({}, { kind: "character", assetId: "c1", displayName: "🎬" }),
    ).toBeNull()
  })

  it("a suffixed name enrolling AGAIN reads the key it was given (R75a)", () => {
    // The real path for the review's `panda-4`: the minter skips the taken
    // `panda-3`, so the display cannot be the name's own number plus one — it
    // is the KEY's number, or INV-C's belt hands the user the raw slug.
    let cast: Cast = {
      panda: { kind: "creature", assetId: "c1", displayName: "Panda" },
      "panda-2": { kind: "creature", assetId: "c2", displayName: "Panda 2" },
      "panda-3": { kind: "creature", assetId: "c3", displayName: "Panda 3" },
    }
    const enrolled = enrollCastMember(cast, {
      kind: "creature",
      assetId: "c4",
      displayName: "Panda 2",
    })!
    expect(enrolled.key).toBe("panda-4")
    expect(enrolled.cast["panda-4"].displayName).toBe("Panda 4")

    // Same fact for a name whose number is DASH-joined: "T-800" slugs to
    // `t-800`, the minter grows it, and the display follows with the name's
    // own separator rather than falling back to the key.
    cast = { "t-800": { kind: "character", assetId: "t1", displayName: "T-800" } }
    const grown = enrollCastMember(cast, {
      kind: "character",
      assetId: "t2",
      displayName: "T-800",
    })!
    expect(grown.key).toBe("t-801")
    expect(grown.cast["t-801"].displayName).toBe("T-801")
    expect(castSlug("character", grown.cast["t-801"].displayName)).toBe("t-801")
  })
  // castSlug's own grammar, and the availableCastKey / suffixedDisplayName key
  // minter these two collisions rest on, are pinned standalone in
  // cast-keys.test.ts (R74) — this describe block stays scoped to enrollment.
})

describe("removeCastMember / castEntries / copyCast", () => {
  const cast: Cast = {
    abi: { kind: "character", assetId: "a", displayName: "Abi" },
    park: { kind: "location", assetId: "p", displayName: "Park" },
  }

  it("removing a missing key returns the SAME object (no churn)", () => {
    expect(removeCastMember(cast, "nobody")).toBe(cast)
  })

  it("removing copies rather than mutating", () => {
    const next = removeCastMember(cast, "abi")
    expect(Object.keys(next)).toEqual(["park"])
    expect(Object.keys(cast).sort()).toEqual(["abi", "park"])
  })

  it("entries are ordered by display name and copies never alias", () => {
    expect(castEntries(cast).map((e) => e.key)).toEqual(["abi", "park"])
    const copy = copyCast({
      abi: {
        kind: "character",
        assetId: "a",
        displayName: "Abi",
        defaultLook: { url: "u", label: "back" },
      },
    })
    expect(copy.abi.defaultLook).not.toBe(cast.abi.defaultLook)
    expect(copy.abi).toEqual({
      kind: "character",
      assetId: "a",
      displayName: "Abi",
      defaultLook: { url: "u", label: "back" },
    })
  })

  it("copyCast carries `defaultRole`, and omits it when empty", () => {
    const copied = copyCast({
      panda: {
        kind: "character",
        assetId: "a",
        displayName: "Panda",
        defaultRole: "panda",
      },
      abi: { kind: "character", assetId: "b", displayName: "Abi", defaultRole: "" },
    })
    expect(copied.panda.defaultRole).toBe("panda")
    // The omit-when-empty rule: a cleared role must leave no key behind, or a
    // role-less row stops round-tripping byte-identically.
    expect("defaultRole" in copied.abi).toBe(false)
  })

  it("castKeyForActor makes enrollment idempotent by ACTOR", () => {
    expect(castKeyForActor(cast, "character", "a")).toBe("abi")
    expect(castKeyForActor(cast, "location", "a")).toBeUndefined()
    expect(castKeyForActor(cast, "character", "zzz")).toBeUndefined()
  })
})

describe("readCast — untrusted blob, re-keyed on read, omitted when empty", () => {
  it("narrows a well-formed blob", () => {
    expect(
      readCast({
        abi: {
          kind: "character",
          assetId: "c1",
          displayName: "Abi",
          defaultLook: { url: "u", variantSlug: "angles:back", label: "back" },
        },
      }),
    ).toEqual({
      abi: {
        kind: "character",
        assetId: "c1",
        displayName: "Abi",
        defaultLook: { url: "u", variantSlug: "angles:back", label: "back" },
      },
    })
  })

  it("drops malformed rows and never throws", () => {
    expect(
      readCast({
        ok: { kind: "location", assetId: "l1", displayName: "Park" },
        noKind: { assetId: "x", displayName: "X" },
        badKind: { kind: "vehicle", assetId: "x", displayName: "X" },
        // NO LONGER malformed: a row without an `assetId` is a DESCRIBED role
        // (R5) — a name with words and no face.
        described: { kind: "character", displayName: "Natalie" },
        // …except of kind `image`, whose "actor" IS the media url it carries,
        // so a face-less one names nothing this app can resolve or describe.
        describedImage: { kind: "image", displayName: "Y" },
        noName: { kind: "character", assetId: "x" },
        nullish: null,
        arrayish: [],
      }),
    ).toEqual({
      park: { kind: "location", assetId: "l1", displayName: "Park" },
      natalie: { kind: "character", displayName: "Natalie" },
    })
  })

  it("RE-KEYS by the display name's slug, so INV-C holds for a hand-edited blob", () => {
    const cast = readCast({
      "whatever-the-canvas-wrote": {
        kind: "character",
        assetId: "c1",
        displayName: "Jack Mercer",
      },
    })!
    expect(Object.keys(cast)).toEqual(["jack-mercer"])
  })

  it("first row per key wins — a hand-edited duplicate never swaps an identity", () => {
    const cast = readCast({
      a: { kind: "character", assetId: "first", displayName: "Abi" },
      b: { kind: "character", assetId: "second", displayName: "abi" },
    })!
    expect(cast.abi.assetId).toBe("first")
  })

  it("undefined for anything empty or non-object (the omit-when-empty rule)", () => {
    expect(readCast(undefined)).toBeUndefined()
    expect(readCast({})).toBeUndefined()
    expect(readCast([])).toBeUndefined()
    expect(readCast("nope")).toBeUndefined()
    expect(readCast({ x: { kind: "character", assetId: "1", displayName: "🎬" } }))
      .toBeUndefined()
  })

  it("reads `defaultRole` verbatim-but-trimmed, and drops a blank one", () => {
    const cast = readCast({
      panda: {
        kind: "character",
        assetId: "c1",
        displayName: "Panda",
        defaultRole: "  Panda Suit ",
      },
      abi: {
        kind: "character",
        assetId: "c2",
        displayName: "Abi",
        defaultRole: "   ",
      },
      jack: {
        kind: "character",
        assetId: "c3",
        displayName: "Jack",
        defaultRole: 7,
      },
    })!
    // Stored AS TYPED (casing kept) — the platform reads the role verbatim.
    expect(cast.panda.defaultRole).toBe("Panda Suit")
    expect("defaultRole" in cast.abi).toBe(false)
    expect("defaultRole" in cast.jack).toBe(false)
  })

  /**
   * …and BOUNDED on read, not only at the UI door: the blob is canvas-editable
   * and arrives from imports, so `readCast` is the vector a `maxLength` can't
   * reach. The word is spliced verbatim into every generation's prompt and the
   * backend takes it as an unbounded string.
   */
  it("bounds and whitespace-collapses `defaultRole` on read", () => {
    const cast = readCast({
      panda: {
        kind: "character",
        assetId: "c1",
        displayName: "Panda",
        defaultRole: "x".repeat(200),
      },
      abi: {
        kind: "character",
        assetId: "c2",
        displayName: "Abi",
        defaultRole: "empty  \n background",
      },
    })!
    expect(cast.panda.defaultRole).toBe("x".repeat(CAST_ROLE_MAX_LENGTH))
    // Collapsed to the SPACED preset form — the one `roleToPhrase` special-cases.
    expect(cast.abi.defaultRole).toBe("empty background")
  })

  it("a defaultLook with no url is dropped, not half-read", () => {
    const cast = readCast({
      abi: {
        kind: "character",
        assetId: "c1",
        displayName: "Abi",
        defaultLook: { label: "back" },
      },
    })!
    expect(cast.abi.defaultLook).toBeUndefined()
  })
})

describe("D6c — the enrollment ladder", () => {
  const abi = character("c1", "Abi")
  const park = location("l1", "Park")
  const cast: Cast = { kira: { kind: "character", assetId: "k1", displayName: "Kira" } }

  it("rung 1 — a cast name materializes, and never consults the library", () => {
    const verdict = lookupCastName("Kira", cast, [character("other", "Kira")])
    expect(verdict).toEqual({ kind: "cast", key: "kira", member: cast.kira })
  })

  it("rung 1 matches by SLUG — casing and whitespace collapse like the wire", () => {
    expect(lookupCastName("  kira  ", cast, []).kind).toBe("cast")
  })

  it("rung 2 — exactly one library hit enrolls", () => {
    const verdict = lookupCastName("Abi", cast, [abi, park])
    expect(verdict).toEqual({ kind: "enroll", candidate: abi })
  })

  it("rung 3 — two matches NEVER bind", () => {
    const verdict = lookupCastName("Abi", cast, [abi, character("c2", "Abi")])
    expect(verdict.kind).toBe("ambiguous")
    if (verdict.kind === "ambiguous") expect(verdict.candidates).toHaveLength(2)
  })

  it("rung 4 — an unknown name binds nothing", () => {
    expect(lookupCastName("Nobody", cast, [abi]).kind).toBe("unknown")
  })

  it("a half-loaded talent pool is PENDING, never a guess", () => {
    // The exact mis-enrollment hazard: "Abi" is not on the loaded page yet.
    expect(lookupCastName("Abi", cast, [], { libraryReady: false }).kind).toBe(
      "pending",
    )
    // …but a CAST hit is knowable regardless — the registry is fully in hand.
    expect(lookupCastName("Kira", cast, [], { libraryReady: false }).kind).toBe(
      "cast",
    )
  })

  /**
   * B5 — A FAILED POOL IS NOT A PENDING ONE. `pending` says "ask me again
   * later", and the entity queries retry once and never refetch on focus, so
   * for an errored library there is no later: the name would sit in a state
   * nothing can leave. `unknown` is the honest verdict — it rides as prose and
   * the submit warns about it, which is what an unbindable name deserves.
   */
  it("an ERRORED talent pool is UNKNOWN, not a pending that never resolves", () => {
    expect(
      lookupCastName("Abi", cast, [], {
        libraryReady: false,
        libraryErrored: true,
      }).kind,
    ).toBe("unknown")
    // …and never a MATCH off whatever half arrived: a pool that failed cannot
    // support rung 2's claim that this is the ONLY Abi.
    expect(
      lookupCastName("Abi", cast, [abi], {
        libraryReady: false,
        libraryErrored: true,
      }).kind,
    ).toBe("unknown")
    // A CAST hit still binds — the registry is in hand either way.
    expect(
      lookupCastName("Kira", cast, [], {
        libraryReady: false,
        libraryErrored: true,
      }).kind,
    ).toBe("cast")
  })

  it("`poolOptions` carries the pair, so a surface can't thread half of it", () => {
    expect(poolOptions({ ready: false, errored: true })).toEqual({
      libraryReady: false,
      libraryErrored: true,
    })
    expect(poolOptions({ ready: true, errored: false })).toEqual({
      libraryReady: true,
      libraryErrored: false,
    })
  })

  it("a VIEW row is not a talent-pool candidate (the role is the person)", () => {
    const view: CastCandidate = { ...abi, variant: "back" }
    expect(lookupCastName("Abi", cast, [view]).kind).toBe("unknown")
  })
})

describe("resolveRole — WIRE PARITY with a picker pick", () => {
  const abi = character("c1", "Abi")

  it("an un-renamed, look-less role returns the candidate's OWN reference", () => {
    const role = resolveRole(memberFromCandidate(abi), [abi])!
    // Identity, not merely equality: nothing re-derives the reference.
    expect(role.reference).toBe(abi.toConnectedReference())
    expect(role.attrs).toEqual({
      entityId: "c1",
      kind: "character",
      name: "Abi",
      thumbnailUrl: "https://r2/c1.png",
    })
  })

  it("null when the actor isn't in hand (a deleted row degrades to prose)", () => {
    expect(resolveRole(memberFromCandidate(abi), [])).toBeNull()
  })

  it("a RENAMED role carries the role name on BOTH halves, slug included", () => {
    const role = resolveRole(
      { kind: "character", assetId: "c1", displayName: "Michal" },
      [abi],
    )!
    expect(role.attrs.name).toBe("Michal")
    expect(role.reference.defaultName).toBe("Michal")
    expect(role.reference.characterSlug).toBe("michal")
    // The identity text still comes from the ACTOR — a rename changes the name,
    // never who it is.
    expect(role.reference.characterCanonicalDescription).toBe("Abi, mid 30s")
  })

  it("a location role renames its own slug field, not the character one", () => {
    const park = location("l1", "Park")
    const role = resolveRole(
      { kind: "location", assetId: "l1", displayName: "The Green" },
      [park],
    )!
    expect(role.reference.locationSlug).toBe("the-green")
    expect(role.reference.characterSlug).toBeUndefined()
  })

  it("a role's `defaultRole` rides on the REFERENCE the submit sends (D6p)", () => {
    const role = resolveRole(
      { ...memberFromCandidate(abi), defaultRole: "panda" },
      [abi],
    )!
    expect(role.reference.defaultRole).toBe("panda")
    // Nothing else moved: the role is a WORD for the reference, not a variant
    // pick, a rename, or a different actor.
    expect({ ...role.reference, defaultRole: undefined }).toEqual({
      ...abi.toConnectedReference(),
      defaultRole: undefined,
    })
    expect(role.attrs).toEqual({
      entityId: "c1",
      kind: "character",
      name: "Abi",
      thumbnailUrl: "https://r2/c1.png",
    })
  })

  it("a blank role is ABSENT — the same object back, byte-parity intact", () => {
    for (const blank of ["", "   "]) {
      const role = resolveRole(
        { ...memberFromCandidate(abi), defaultRole: blank },
        [abi],
      )!
      expect(role.reference).toBe(abi.toConnectedReference())
      expect("defaultRole" in role.reference).toBe(false)
    }
  })

  it("a role stamped on a LOOKED reference keeps the look (D6f still wins the url)", () => {
    const role = resolveRole(
      { ...memberFromCandidate(abi), defaultRole: "clothes" },
      [abi],
      { url: "https://r2/hat.png", variantSlug: "angles:hat", label: "hat" },
    )!
    expect(role.reference.url).toBe("https://r2/hat.png")
    expect(role.reference.variantDisplayName).toBe("hat")
    expect(role.reference.defaultRole).toBe("clothes")
  })

  it("memberFromCandidate never bakes a VIEW into the role's default look", () => {
    expect(memberFromCandidate({ ...abi, variant: "back" })).toEqual({
      kind: "character",
      assetId: "c1",
      displayName: "Abi",
    })
  })
})

describe("applyCastLook — the picker's own view shapes, not new ones", () => {
  const abi = character("c1", "Abi")

  it("a character look mirrors characterViewToConnectedReference", () => {
    const looked = applyCastLook(abi.toConnectedReference(), {
      url: "https://r2/back.png",
      variantSlug: "angles:back",
      label: "back",
    })
    expect(looked).toEqual({
      ...abi.toConnectedReference(),
      url: "https://r2/back.png",
      variantSlug: "angles:back",
      variantDisplayName: "back",
      isExtraRef: true,
      description: "back",
    })
  })

  it("a url-bound kind's look mirrors viewToConnectedReference", () => {
    const park = location("l1", "Park")
    const looked = applyCastLook(park.toConnectedReference(), {
      url: "https://r2/night.png",
      label: "Night",
    })
    expect(looked).toEqual({
      ...park.toConnectedReference(),
      url: "https://r2/night.png",
      isExtraRef: true,
      description: "Night",
    })
  })

  it("a label-less look swaps the url only — never a nameless extra ref", () => {
    const looked = applyCastLook(abi.toConnectedReference(), { url: "u" })
    expect(looked.isExtraRef).toBeUndefined()
    expect(looked.url).toBe("u")
  })
})

describe("scanCastTokens / unresolvedCastNames — the submit warning's source", () => {
  const cast: Cast = {
    abi: { kind: "character", assetId: "c1", displayName: "Abi" },
    "old-library": { kind: "location", assetId: "l1", displayName: "Old Library" },
  }
  const library = [character("c9", "Solo")]

  it("finds a typed name and walks it through the ladder", () => {
    const tokens = scanCastTokens("@Abi walks into @Nobody", cast, library)
    expect(tokens.map((t) => [t.name, t.verdict.kind])).toEqual([
      ["Abi", "cast"],
      ["Nobody", "unknown"],
    ])
  })

  it("the LONGEST matching prefix wins — a multi-word role beats its first word", () => {
    const tokens = scanCastTokens("inside the @Old Library at dusk", cast, library)
    expect(tokens[0].name).toBe("Old Library")
    expect(tokens[0].verdict.kind).toBe("cast")
  })

  it("with nothing matching, the FIRST word carries the unresolved verdict", () => {
    const tokens = scanCastTokens("@Ghost Town burns", cast, library)
    expect(tokens[0].name).toBe("Ghost")
  })

  it("an email-ish `@` embedded in a word is not a mention", () => {
    expect(scanCastTokens("mail me at me@example.com", cast, library)).toEqual([])
  })

  it("only NON-binding names reach the submit warning, deduped", () => {
    expect(
      unresolvedCastNames("@Abi and @Solo meet @Nobody, then @Nobody again", cast, library),
    ).toEqual(["Nobody"])
  })

  it("a name that would enroll is NOT warned about — it is about to bind", () => {
    expect(unresolvedCastNames("@Solo waits", cast, library)).toEqual([])
  })

  it("a DESCRIBED role IS warned about — it is cast, and still has no face", () => {
    // The one `cast` verdict that binds nothing (spec `2026-09-06-reference-
    // menu-and-described-roles-design`, R5): its words ride as prose until S2's
    // described channel, so the submit still says the name reaches no face —
    // exactly as it did before the landing enrolled it. A BOUND role, in the
    // same breath, is not warned about: it materializes into a chip.
    const described: Cast = {
      ...cast,
      natalie: {
        kind: "character",
        displayName: "Natalie",
        description: "late 20s, red parka",
      },
    }
    expect(unresolvedCastNames("@Natalie meets @Abi", described, library)).toEqual([
      "Natalie",
    ])
  })

  it("an ambiguous name IS warned about — the system asks, it never guesses", () => {
    const ambiguous = [character("a", "Twin"), character("b", "Twin")]
    expect(unresolvedCastNames("@Twin waits", cast, ambiguous)).toEqual(["Twin"])
  })

  it("a pending talent pool warns rather than silently passing", () => {
    expect(
      unresolvedCastNames("@Solo waits", cast, [], { libraryReady: false }),
    ).toEqual(["Solo"])
  })

  it("…and an ERRORED one warns too, off an `unknown` rather than a `pending`", () => {
    const opts = { libraryReady: false, libraryErrored: true }
    expect(scanCastTokens("@Solo waits", cast, library, opts)[0]?.verdict.kind).toBe(
      "unknown",
    )
    expect(unresolvedCastNames("@Solo waits", cast, library, opts)).toEqual([
      "Solo",
    ])
  })

  it("text with no `@` allocates nothing", () => {
    expect(scanCastTokens("Abi walks", cast, library)).toEqual([])
  })

  /**
   * ONE READING OF `@`. The scan walks each run's prefixes through the ladder;
   * the importer's gate signal counts the runs themselves
   * (`production-format/import.ts`). Both read this, so neither can drift into
   * a second regex.
   */
  it("`castMentionRuns` yields each run as written, with its `@` index", () => {
    expect(castMentionRuns("@Old Library, then @Old Tavern")).toEqual([
      { run: "Old Library", start: 0 },
      { run: "Old Tavern", start: 19 },
    ])
    // An `@` glued to a word is not a mention (an email, a handle mid-word).
    expect(castMentionRuns("mail@natalie")).toEqual([])
    expect(castMentionRuns("no mentions here")).toEqual([])
  })
})

/**
 * THE ROLE VOCABULARY (D6p). The menu's presets are the PLATFORM's own
 * `REFERENCE_ROLE_PRESETS`, keyed by the reference source the kind materializes
 * as — a studio-local copy would drift into offering words the assembler's
 * `roleToPhrase` doesn't render.
 */
describe("castRolePresets — the curated vocabulary comes from the platform", () => {
  it("is the shared constant itself, per kind's reference source", () => {
    expect(castRolePresets("character")).toBe(
      REFERENCE_ROLE_PRESETS["wired-character"],
    )
    expect(castRolePresets("location")).toBe(
      REFERENCE_ROLE_PRESETS["wired-location"],
    )
    expect(castRolePresets("object")).toBe(REFERENCE_ROLE_PRESETS["wired-object"])
    expect(castRolePresets("creature")).toBe(
      REFERENCE_ROLE_PRESETS["wired-creature"],
    )
    expect(castRolePresets("image")).toBe(REFERENCE_ROLE_PRESETS["wired-image"])
  })

  it("every cast kind has a non-empty list (no kind falls off the map)", () => {
    for (const kind of ["character", "location", "object", "creature", "image"] as const) {
      expect(castRolePresets(kind).length).toBeGreaterThan(0)
    }
  })

  it("the source a role menu offers is the source the candidate's ref carries", () => {
    // The gate that keeps the menu honest: `resolveRole` stamps the role onto a
    // reference whose `source` decides which preset list the platform resolver
    // reads back. Offering `wired-character` words for a `wired-location` ref
    // would show a vocabulary the assembler then ignores.
    const abi = character("c1", "Abi")
    const park = location("l1", "Park")
    expect(resolveRole(memberFromCandidate(abi), [abi])!.reference.source).toBe(
      "wired-character",
    )
    expect(resolveRole(memberFromCandidate(park), [park])!.reference.source).toBe(
      "wired-location",
    )
  })
})

/**
 * THE ROLE WORD IS BOUNDED (D6p). It is PROSE spliced verbatim into every
 * generation's assembled phrase, and the backend takes `defaultRole` as an
 * unbounded string — so studio is the only place a bound can live.
 */
describe("sanitizeCastRole — prose, normalized and bounded (never slugged)", () => {
  it("trims, collapses whitespace runs and caps at the platform's 32", () => {
    expect(sanitizeCastRole("  Panda Suit ")).toBe("Panda Suit")
    expect(sanitizeCastRole("empty  \t background")).toBe("empty background")
    expect(sanitizeCastRole("   ")).toBe("")
    expect(sanitizeCastRole("x".repeat(200))).toBe("x".repeat(32))
    expect(CAST_ROLE_MAX_LENGTH).toBe(32)
  })

  it("does NOT slug — the word is prose, and a preset only matches spaced", () => {
    // `sanitizeRole` would yield "empty-background", which `roleToPhrase`'s one
    // multi-word special case does not match; casing likewise rides as typed.
    expect(sanitizeCastRole("empty background")).toBe("empty background")
    expect(sanitizeCastRole("Panda Suit")).toBe("Panda Suit")
  })

  it("leaves no trailing space behind the cap", () => {
    expect(sanitizeCastRole(`${"y".repeat(31)} tail`)).toBe("y".repeat(31))
  })
})

/**
 * THE RENDER GATE (D6p). `ConnectedReference.defaultRole` is accepted on every
 * source but CONSULTED on only some of the assembler's paths, so the control is
 * offered only where the word can reach the prompt — and the FIELD is stamped
 * regardless, so un-gating a kind is one map entry and no wire change.
 */
describe("castRoleRenders — the role word is offered only where it renders", () => {
  it("every mention-bearing kind renders it; location alone does not", () => {
    expect(castRoleRenders("character")).toBe(true)
    expect(castRoleRenders("image")).toBe(true)
    // TODO(nodaro): location flips to `true` once the platform's location role
    // chain is live — its mention resolver still derives the role from the
    // usage mode instead of consulting `defaultRole`.
    // S7 gave creatures and objects the platform's entity mention grammar, and
    // `resolveEntityMentionsHybrid` consults `defaultRole` for every token it
    // binds — the same shape `image` has always had.
    expect(castRoleRenders("object")).toBe(true)
    expect(castRoleRenders("creature")).toBe(true)
    expect(castRoleRenders("location")).toBe(false)
  })

  it("the GATE is on the menu, never on the wire — every kind still stamps it", () => {
    const park = location("l1", "Park")
    const role = resolveRole({ ...memberFromCandidate(park), defaultRole: "layout" }, [
      park,
    ])!
    expect(castRoleRenders("location")).toBe(false)
    expect(role.reference.defaultRole).toBe("layout")
  })
})
