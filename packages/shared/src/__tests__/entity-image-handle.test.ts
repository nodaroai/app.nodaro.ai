import { describe, it, expect } from "vitest"
import { resolveEffectiveSourceType, ENTITY_IMAGE_HANDLE_TYPES, sourceRefKey } from "../entity-image-handle.js"

const ENTITY_REF_HANDLE: Record<string, string> = {
  character: "characterRef",
  location: "locationRef",
  object: "objectRef",
  creature: "creatureRef",
}

describe("resolveEffectiveSourceType (entity image handle → upload-image)", () => {
  it("remaps every entity type's `image` handle to a plain image producer", () => {
    for (const entity of ENTITY_IMAGE_HANDLE_TYPES) {
      expect(resolveEffectiveSourceType(entity, "image")).toBe("upload-image")
    }
  })

  it("leaves the identity `*Ref` handle as the entity type", () => {
    for (const entity of ENTITY_IMAGE_HANDLE_TYPES) {
      expect(resolveEffectiveSourceType(entity, ENTITY_REF_HANDLE[entity])).toBe(entity)
    }
  })

  it("leaves the bare/legacy no-handle case as the entity type", () => {
    expect(resolveEffectiveSourceType("character", undefined)).toBe("character")
    expect(resolveEffectiveSourceType("character", null)).toBe("character")
  })

  it("does not remap non-entity producers on the `image` handle", () => {
    expect(resolveEffectiveSourceType("generate-image", "image")).toBe("generate-image")
    expect(resolveEffectiveSourceType("upload-image", "image")).toBe("upload-image")
  })

  it("returns empty string for an undefined source type", () => {
    expect(resolveEffectiveSourceType(undefined, "image")).toBe("")
  })

  it("ENTITY_IMAGE_HANDLE_TYPES is exactly the four entity nodes with an image handle", () => {
    expect([...ENTITY_IMAGE_HANDLE_TYPES].sort()).toEqual(
      ["character", "creature", "location", "object"],
    )
  })
})

describe("sourceRefKey (handle-scoped ref key — prevents node-id collision)", () => {
  it("scopes an entity's image handle to `${id}::image`", () => {
    for (const entity of ENTITY_IMAGE_HANDLE_TYPES) {
      expect(sourceRefKey("n1", "image", entity)).toBe("n1::image")
    }
  })

  it("keeps the bare node id for the identity handle so the two refs stay distinct", () => {
    expect(sourceRefKey("n1", "characterRef", "character")).toBe("n1")
    // Identity vs image handle of the SAME node → distinct keys (the fix).
    expect(sourceRefKey("n1", "characterRef", "character"))
      .not.toBe(sourceRefKey("n1", "image", "character"))
  })

  it("leaves non-entity image producers and the no-handle case on the bare node id", () => {
    expect(sourceRefKey("n1", "image", "generate-image")).toBe("n1")
    expect(sourceRefKey("n1", "image", "upload-image")).toBe("n1")
    expect(sourceRefKey("n1", undefined, "character")).toBe("n1")
  })
})
