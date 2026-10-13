import { describe, it, expect } from "vitest"
import { resolveEffectiveSourceType, ENTITY_IMAGE_HANDLE_TYPES, AGGREGATE_LANE_SOURCE_TYPES, OUTPUT_PIP_EFFECTIVE_TYPES, outputPipSourceType, sourceRefKey } from "../entity-image-handle.js"
import { LEGACY_SOURCE_HANDLE_ALIASES } from "../handle-aliases.js"

describe("an output pip that emits a plain medium (OUTPUT_PIP_EFFECTIVE_TYPES)", () => {
  it("UGC Creator's `image` pip is a plain image producer; its `creator` pip and a missing handle stay UGC Creator", () => {
    expect(OUTPUT_PIP_EFFECTIVE_TYPES["ugc-creator"]).toEqual({ image: "upload-image" })
    expect(resolveEffectiveSourceType("ugc-creator", "image")).toBe("upload-image")
    expect(resolveEffectiveSourceType("ugc-creator", "creator")).toBe("ugc-creator")
    expect(resolveEffectiveSourceType("ugc-creator", null)).toBe("ugc-creator")
    expect(resolveEffectiveSourceType("ugc-creator", undefined)).toBe("ugc-creator")
  })

  it("UGC's plain-text pips are one text each (the script's category, the clips' transcript, the cards' Notes); the JSON pips stay their node", () => {
    expect(OUTPUT_PIP_EFFECTIVE_TYPES["ugc-script"]).toEqual({ category: "combine-text" })
    expect(OUTPUT_PIP_EFFECTIVE_TYPES["ugc-clips"]).toEqual({ transcript: "combine-text" })
    expect(OUTPUT_PIP_EFFECTIVE_TYPES["ugc-cards"]).toEqual({ report: "combine-text" })
    for (const [type, pip] of [["ugc-script", "category"], ["ugc-clips", "transcript"], ["ugc-cards", "report"]] as const) {
      expect(resolveEffectiveSourceType(type, pip), `${type}.${pip}`).toBe("combine-text")
      expect(outputPipSourceType(type, pip), `${type}.${pip}`).toBe("combine-text")
    }
    for (const [type, pip] of [["ugc-creator", "creator"], ["ugc-script", "plan"], ["ugc-clips", "clips"], ["ugc-clips", "plan-out"], ["ugc-clip", "video-out"], ["ugc-cards", "layerPlan"], ["ugc-cards", "captionPlan"]] as const) {
      expect(resolveEffectiveSourceType(type, pip), `${type}.${pip}`).toBe(type)
    }
    // An edge with no source pip reads the node's primary output, which is never a text pip.
    for (const type of ["ugc-script", "ugc-clips", "ugc-cards"]) expect(resolveEffectiveSourceType(type, null)).toBe(type)
  })

  it("the legacy-handle classifiers read this table alone: an entity's image pip or a lane keeps its own type there", () => {
    expect(outputPipSourceType("ugc-creator", "image")).toBe("upload-image")
    expect(outputPipSourceType("ugc-creator", "creator")).toBe("ugc-creator")
    expect(outputPipSourceType("character", "image")).toBe("character")
    expect(outputPipSourceType("collect", "out-image")).toBe("collect")
    expect(outputPipSourceType(undefined, "image")).toBe("")
  })

  it("is no identity remap: UGC Creator is not an entity, and its image keeps the bare node id as a ref key", () => {
    expect(ENTITY_IMAGE_HANDLE_TYPES.has("ugc-creator")).toBe(false)
    expect(sourceRefKey("n1", "image", "ugc-creator")).toBe("n1")
  })

  it("never reads an inherited key", () => {
    expect(outputPipSourceType("constructor", "image")).toBe("constructor")
    expect(outputPipSourceType("ugc-creator", "constructor")).toBe("ugc-creator")
    expect(resolveEffectiveSourceType("ugc-creator", "toString")).toBe("ugc-creator")
  })

  it("no source-handle alias names a remapped pip", () => {
    // Both engines read the remap on the pip AS WRITTEN in the Generate Image
    // handle migration, and on the pip AFTER the source-alias fix in the
    // legacy-target classifiers (the server's write-time normalizer, the
    // editor's load pass). An alias to or from a remapped pip would judge one
    // edge by two different pips. Record the remap on the alias's spelling as
    // well, or apply the alias before every read, before adding one.
    for (const [type, pips] of Object.entries(OUTPUT_PIP_EFFECTIVE_TYPES)) {
      const aliases = Object.hasOwn(LEGACY_SOURCE_HANDLE_ALIASES, type) ? LEGACY_SOURCE_HANDLE_ALIASES[type]! : {}
      for (const [from, to] of Object.entries(aliases)) {
        expect(Object.hasOwn(pips, from) || Object.hasOwn(pips, to), `${type}: the alias ${from} → ${to} names a remapped pip`).toBe(false)
      }
    }
  })
})

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

describe("resolveEffectiveSourceType (aggregate lane handle → plain producer of that type)", () => {
  const LANE_TO_PRODUCER: Record<string, string> = {
    "out-image": "upload-image",
    "out-video": "upload-video",
    "out-audio": "upload-audio",
    "out-text": "list",
  }

  it("remaps every Collect / Group lane to the plain producer of its media type", () => {
    for (const agg of AGGREGATE_LANE_SOURCE_TYPES) {
      for (const [lane, producer] of Object.entries(LANE_TO_PRODUCER)) {
        expect(resolveEffectiveSourceType(agg, lane)).toBe(producer)
      }
    }
  })

  it("leaves a non-lane / missing handle as the raw aggregate type", () => {
    expect(resolveEffectiveSourceType("collect", "out")).toBe("collect")
    expect(resolveEffectiveSourceType("collect", undefined)).toBe("collect")
    expect(resolveEffectiveSourceType("group", null)).toBe("group")
  })

  it("does not remap lane-shaped handles on non-aggregate producers", () => {
    expect(resolveEffectiveSourceType("generate-image", "out-image")).toBe("generate-image")
    expect(resolveEffectiveSourceType("list", "out-text")).toBe("list")
  })

  it("AGGREGATE_LANE_SOURCE_TYPES is exactly group + collect", () => {
    expect([...AGGREGATE_LANE_SOURCE_TYPES].sort()).toEqual(["collect", "group"])
  })
})
