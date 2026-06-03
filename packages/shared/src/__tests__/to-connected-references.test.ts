import { describe, it, expect } from "vitest"

import { characterMentionSlug } from "../character-mention-slug.js"
import { locationMentionSlug } from "../location-mention-slug.js"
import {
  toConnectedReference,
  toConnectedReferences,
  type EntityReferenceInput,
} from "../to-connected-references.js"

/**
 * `toConnectedReference` is the contract seam between an app's binding UX and
 * Nodaro's reference resolver: a generic `{ id, kind, name, url, variant }`
 * binding must map to the platform `ConnectedReference` with the slug DERIVED
 * from `name`. These assertions are pinned to the consuming app's previous
 * hand-rolled output (studio `chipAttrsToConnectedReference`) so adopting the
 * shared helper can't change the wire shape, and any `@nodaro/shared` schema
 * drift (renamed field, changed `wired-*` handling, slug-helper change) fails
 * loudly here.
 */
describe("toConnectedReference", () => {
  it("maps a character binding to a wired-character reference with a derived slug", () => {
    const input: EntityReferenceInput = {
      id: "char-1",
      kind: "character",
      name: "Kira",
      url: "https://r2.example/kira.png",
    }
    expect(toConnectedReference(input)).toEqual({
      id: "char-1",
      defaultName: "Kira",
      source: "wired-character",
      url: "https://r2.example/kira.png",
      characterSlug: characterMentionSlug("Kira"),
      variantSlug: undefined,
      characterCanonicalDescription: null,
      variantDescription: null,
      variantDisplayName: "canonical",
    })
  })

  it("maps a location binding to a wired-location reference with a derived slug", () => {
    const ref = toConnectedReference({
      id: "loc-1",
      kind: "location",
      name: "Old Library",
      url: "https://r2.example/lib.png",
    })
    expect(ref.source).toBe("wired-location")
    expect(ref.locationSlug).toBe(locationMentionSlug("Old Library"))
    expect(ref.locationSlug).toBe("old-library")
    expect(ref.url).toBe("https://r2.example/lib.png")
    expect(ref.locationVariantDisplayName).toBe("canonical")
  })

  it("rides a present variant onto the character variant slug + display name", () => {
    const ref = toConnectedReference({
      id: "char-1",
      kind: "character",
      name: "Kira",
      url: "https://r2.example/kira.png",
      variant: "smile",
    })
    expect(ref.variantSlug).toBe("smile")
    expect(ref.variantDisplayName).toBe("smile")
  })

  it("rides a present variant onto the location variant slug + display name", () => {
    const ref = toConnectedReference({
      id: "loc-1",
      kind: "location",
      name: "Old Library",
      url: "https://r2.example/lib.png",
      variant: "rain",
    })
    expect(ref.locationVariantSlug).toBe("rain")
    expect(ref.locationVariantDisplayName).toBe("rain")
  })

  it("falls back to a placeholder-safe empty url when the entity has no thumbnail", () => {
    expect(
      toConnectedReference({
        id: "char-2",
        kind: "character",
        name: "Nyx",
        url: null,
      }).url,
    ).toBe("")
    expect(
      toConnectedReference({ id: "char-3", kind: "character", name: "Vex" }).url,
    ).toBe("")
  })

  it("does not mutate its input", () => {
    const input: EntityReferenceInput = {
      id: "char-1",
      kind: "character",
      name: "Kira",
      url: "https://r2.example/kira.png",
      variant: "smile",
    }
    const frozen = Object.freeze({ ...input })
    expect(() => toConnectedReference(frozen)).not.toThrow()
    expect(frozen).toEqual(input)
  })
})

describe("toConnectedReferences", () => {
  it("batch maps in order, preserving indices", () => {
    const inputs: EntityReferenceInput[] = [
      { id: "char-1", kind: "character", name: "Kira", url: "https://r2.example/kira.png" },
      { id: "loc-1", kind: "location", name: "Old Library", url: "https://r2.example/lib.png" },
    ]
    const refs = toConnectedReferences(inputs)
    expect(refs).toHaveLength(2)
    expect(refs[0]).toEqual(toConnectedReference(inputs[0]))
    expect(refs[0].source).toBe("wired-character")
    expect(refs[1]).toEqual(toConnectedReference(inputs[1]))
    expect(refs[1].source).toBe("wired-location")
  })
})
