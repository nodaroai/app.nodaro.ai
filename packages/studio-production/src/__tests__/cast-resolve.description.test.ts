import { describe, it, expect } from "vitest"
import {
  characterMentionSlug,
  locationMentionSlug,
  type ConnectedReference,
} from "@nodaro/shared"

import {
  libraryDescription,
  resolveRole,
  type CastCandidate,
  type CastMember,
} from "../cast"

/**
 * THE ROLE'S OWN DESCRIPTION ON THE WIRE (spec
 * `2026-09-06-reference-menu-and-described-roles-design`, R4): a role that says
 * what it looks like in its own words rides as `descriptionOverride` — a NEW
 * explicit field, never `description`, which stays the view-label slot studio
 * already sends.
 *
 * The invariant this suite exists for is the ABSENCE case: a role with no
 * description of its own, or one that merely repeats the live library caption,
 * must leave the reference byte-identical — the same OBJECT, so the wire-parity
 * guard (`cast-wire-parity.test.ts`) holds without knowing this feature exists.
 */

function character(id: string, name: string, canonical: string): CastCandidate {
  const reference: ConnectedReference = {
    id,
    defaultName: name,
    source: "wired-character",
    url: `https://r2.example/${id}.png`,
    description: undefined,
    characterSlug: characterMentionSlug(name),
    variantSlug: undefined,
    characterCanonicalDescription: canonical,
    variantDescription: null,
    variantDisplayName: "canonical",
  }
  return {
    id,
    kind: "character",
    name,
    thumbnailUrl: reference.url,
    toConnectedReference: () => reference,
  }
}

const abi = character("c1", "Abi", "weathered, mid 40s")
const member: CastMember = { kind: "character", assetId: "c1", displayName: "Abi" }

describe("resolveRole — the role's own description", () => {
  it("no description ⇒ the SAME reference object (wire parity)", () => {
    const role = resolveRole(member, [abi])
    expect(role?.reference).toBe(abi.toConnectedReference())
  })

  it("a description equal to the library caption ⇒ the SAME object", () => {
    // Presence is the SOURCE, not the decision: a row that merely repeats what
    // the library already says has nothing to override, and sending one would
    // put a redundant identity line on every generation.
    const role = resolveRole(
      { ...member, description: "weathered, mid 40s" },
      [abi],
    )
    expect(role?.reference).toBe(abi.toConnectedReference())
  })

  it("…including a caption the library padded — both sides are sanitized", () => {
    // The row's own words are stored trimmed, so comparing them against a RAW
    // caption would call a description that merely repeats a padded one an
    // override, and send the redundant line the branch above exists to avoid.
    const padded = character("c1", "Abi", "  weathered, mid 40s\n")
    const role = resolveRole({ ...member, description: "weathered, mid 40s" }, [padded])
    expect(role?.reference).toBe(padded.toConnectedReference())
  })

  it("a description that DIFFERS rides as descriptionOverride, alone", () => {
    const role = resolveRole({ ...member, description: "clean-shaven, 30s" }, [abi])
    expect(role?.reference).toEqual({
      ...abi.toConnectedReference(),
      descriptionOverride: "clean-shaven, 30s",
    })
    // `description` is NOT re-purposed (R4) — it stays the view-label slot.
    expect(role?.reference.description).toBeUndefined()
  })

  it("a role with a description but no actor still resolves to nothing", () => {
    // S1 has no hollow chip yet: a DESCRIBED role has no actor to materialize,
    // so the editor leaves its name as prose exactly as it does today.
    expect(
      resolveRole({ kind: "character", displayName: "Natalie" }, [abi]),
    ).toBeNull()
  })
})

describe("libraryDescription — the caption the override replaces", () => {
  it("reads the IDENTITY description each source actually carries", () => {
    expect(libraryDescription(abi.toConnectedReference())).toBe("weathered, mid 40s")
    expect(
      libraryDescription({
        id: "l1",
        defaultName: "Park",
        source: "wired-location",
        url: "https://r2.example/l1.png",
        description: "a harbour at dusk",
        locationSlug: locationMentionSlug("Park"),
        locationCanonicalDescription: "a harbour at dusk",
      }),
    ).toBe("a harbour at dusk")
    expect(
      libraryDescription({
        id: "o1",
        defaultName: "Lantern",
        source: "wired-object",
        url: "https://r2.example/o1.png",
        description: "a brass storm lantern",
      }),
    ).toBe("a brass storm lantern")
  })

  it("prefers the CANONICAL caption over `description` — what the model sees", () => {
    // A character carries BOTH: `description` is the view-label slot studio
    // sends, `characterCanonicalDescription` is the identity line the assembler
    // reads on the canonical path. The comparison has to be against the second,
    // or a role that merely repeats the caption the model already gets would
    // send it a second time — and one that says something else would be judged
    // against a label nobody renders.
    // ONE reference object per candidate, as the helper above builds them: the
    // identity assertions below are `toBe`.
    const reaRef: ConnectedReference = {
      id: "c3",
      defaultName: "Rea",
      source: "wired-character",
      url: "https://r2.example/c3.png",
      description: "Rain coat",
      characterSlug: characterMentionSlug("Rea"),
      characterCanonicalDescription: "shaved head, late 50s",
    }
    const twoCaptions: CastCandidate = {
      id: "c3",
      kind: "character",
      name: "Rea",
      thumbnailUrl: reaRef.url,
      toConnectedReference: () => reaRef,
    }
    expect(libraryDescription(twoCaptions.toConnectedReference())).toBe(
      "shaved head, late 50s",
    )
    const rea: CastMember = { kind: "character", assetId: "c3", displayName: "Rea" }
    // Equal to the CANONICAL ⇒ nothing to override, the same object back.
    expect(
      resolveRole({ ...rea, description: "shaved head, late 50s" }, [twoCaptions])
        ?.reference,
    ).toBe(twoCaptions.toConnectedReference())
    // Equal to the view LABEL only ⇒ it says something the identity line does
    // not, so the override rides.
    expect(
      resolveRole({ ...rea, description: "Rain coat" }, [twoCaptions])?.reference,
    ).toEqual({
      ...twoCaptions.toConnectedReference(),
      descriptionOverride: "Rain coat",
    })
  })

  it("a caption-less row has none — and then any description is an override", () => {
    const plain = character("c2", "Solo", "")
    expect(libraryDescription(plain.toConnectedReference())).toBeUndefined()
    const role = resolveRole(
      { kind: "character", assetId: "c2", displayName: "Solo", description: "tall" },
      [plain],
    )
    expect(role?.reference).toEqual({
      ...plain.toConnectedReference(),
      descriptionOverride: "tall",
    })
  })
})
