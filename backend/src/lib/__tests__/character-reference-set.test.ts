import { describe, it, expect } from "vitest"
import { CHARACTER_ASSET_VARIANTS } from "@nodaro/shared"
import {
  assembleCharacterReferenceSet,
  characterPriorAssetsFromRow,
  preferredKind,
  DEFAULT_ENTITY_REF_CAP,
  type ReferencePhoto,
} from "../character-reference-set.js"

describe("preferredKind", () => {
  it("routes full-body asset types to frontBody regardless of variant", () => {
    expect(preferredKind("poses", "standing")).toBe("frontBody")
    expect(preferredKind("bodyAngles", "left profile")).toBe("frontBody")
    expect(preferredKind("lighting", "night")).toBe("frontBody")
  })

  it("routes head angles by variant, collision-safe against bodyAngles reusing the same strings", () => {
    expect(preferredKind("headAngles", "left profile")).toBe("sideLeft")
    expect(preferredKind("headAngles", "3/4 right")).toBe("threeQuarterRight")
    expect(preferredKind("angles", "front")).toBe("frontFace")
    // Same variant string, different asset type → different kind (the collision).
    expect(preferredKind("bodyAngles", "left profile")).toBe("frontBody")
    expect(preferredKind("headAngles", "left profile")).toBe("sideLeft")
  })

  it("routes expressions to frontFace; custom / unknown / unmapped fall back to frontFace without throwing", () => {
    expect(preferredKind("expressions", "smile")).toBe("frontFace")
    expect(preferredKind("custom", "anything")).toBe("frontFace")
    expect(preferredKind("headAngles", "back")).toBe("frontFace") // unmapped head variant
    expect(preferredKind("totally-unknown", "zzz")).toBe("frontFace")
  })
})

describe("assembleCharacterReferenceSet", () => {
  const portrait = "https://cdn/portrait.png"
  const photos: ReferencePhoto[] = [
    { url: "https://cdn/front.png", kind: "frontFace" },
    { url: "https://cdn/left.png", kind: "sideLeft" },
    { url: "https://cdn/body.png", kind: "frontBody" },
  ]

  it("puts the portrait first and never drops it", () => {
    const out = assembleCharacterReferenceSet({
      portraitUrl: portrait, referencePhotos: photos, realLifeRefs: [], priorAssets: [],
      assetType: "expressions", variant: "smile",
    })
    expect(out[0]).toBe(portrait)
  })

  it("prioritizes the angle-matched reference photo (headAngles + left profile → sideLeft ahead of others)", () => {
    const out = assembleCharacterReferenceSet({
      portraitUrl: portrait, referencePhotos: photos, realLifeRefs: [], priorAssets: [],
      assetType: "headAngles", variant: "left profile",
    })
    expect(out[0]).toBe(portrait)
    expect(out[1]).toBe("https://cdn/left.png")
  })

  it("bodyAngles + left profile prioritizes the frontBody photo (collision resolved, NOT sideLeft)", () => {
    const out = assembleCharacterReferenceSet({
      portraitUrl: portrait, referencePhotos: photos, realLifeRefs: [], priorAssets: [],
      assetType: "bodyAngles", variant: "left profile",
    })
    expect(out[1]).toBe("https://cdn/body.png")
  })

  it("ranks real photos + realLifeRefs above prior generated assets", () => {
    const out = assembleCharacterReferenceSet({
      portraitUrl: portrait,
      referencePhotos: [{ url: "https://cdn/front.png", kind: "frontFace" }],
      realLifeRefs: ["https://cdn/real.png"],
      priorAssets: [{ column: "expressions", items: [{ url: "https://cdn/gen1.png" }] }],
      assetType: "expressions", variant: "smile",
    })
    expect(out.indexOf("https://cdn/real.png")).toBeLessThan(out.indexOf("https://cdn/gen1.png"))
    expect(out.indexOf("https://cdn/front.png")).toBeLessThan(out.indexOf("https://cdn/gen1.png"))
  })

  it("dedups by URL across all tiers", () => {
    const out = assembleCharacterReferenceSet({
      portraitUrl: portrait,
      referencePhotos: [{ url: portrait, kind: "frontFace" }],
      realLifeRefs: [portrait],
      priorAssets: [{ column: "expressions", items: [{ url: portrait }] }],
      assetType: "expressions", variant: "smile",
    })
    expect(out.filter((u) => u === portrait)).toHaveLength(1)
  })

  it("uses prior assets recent-first (last appended first)", () => {
    const out = assembleCharacterReferenceSet({
      portraitUrl: null, referencePhotos: [], realLifeRefs: [],
      priorAssets: [{ column: "expressions", items: [{ url: "old.png" }, { url: "new.png" }] }],
      assetType: "expressions", variant: "smile",
    })
    expect(out).toEqual(["new.png", "old.png"])
  })

  it("sparse cases: portrait-only → [portrait]; nothing → []", () => {
    expect(assembleCharacterReferenceSet({
      portraitUrl: portrait, referencePhotos: null, realLifeRefs: null, priorAssets: null,
      assetType: "expressions", variant: "smile",
    })).toEqual([portrait])
    expect(assembleCharacterReferenceSet({
      portraitUrl: null, referencePhotos: null, realLifeRefs: null, priorAssets: null,
      assetType: "expressions", variant: "smile",
    })).toEqual([])
  })

  it("full-body render promotes the newest generated full-body asset ahead of face photos (outfit continuity)", () => {
    const out = assembleCharacterReferenceSet({
      portraitUrl: portrait,
      referencePhotos: [{ url: "https://cdn/front.png", kind: "frontFace" }], // no frontBody upload
      realLifeRefs: [],
      priorAssets: [
        { column: "expressions", items: [{ url: "expr.png" }] },
        { column: "body_angles", items: [{ url: "body-old.png" }, { url: "body-new.png" }] },
      ],
      assetType: "poses", variant: "standing",
    })
    // Newest body_angles render lands right after the portrait — ahead of the
    // frontFace photo, which carries no outfit/body signal for a pose render.
    expect(out[0]).toBe(portrait)
    expect(out[1]).toBe("body-new.png")
  })

  it("full-body promotion never outranks an uploaded frontBody photo", () => {
    const out = assembleCharacterReferenceSet({
      portraitUrl: portrait,
      referencePhotos: photos, // includes frontBody upload
      realLifeRefs: [],
      priorAssets: [{ column: "poses", items: [{ url: "pose-gen.png" }] }],
      assetType: "bodyAngles", variant: "front",
    })
    expect(out[1]).toBe("https://cdn/body.png") // uploaded body photo first
    expect(out[2]).toBe("pose-gen.png") // promoted generated full-body next
  })

  it("full-body render pulls body columns ahead of face columns in the prior-asset tier", () => {
    const out = assembleCharacterReferenceSet({
      portraitUrl: null, referencePhotos: [], realLifeRefs: [],
      priorAssets: [
        { column: "expressions", items: [{ url: "expr.png" }] },
        { column: "poses", items: [{ url: "pose.png" }] },
      ],
      assetType: "lighting", variant: "daylight",
    })
    expect(out.indexOf("pose.png")).toBeLessThan(out.indexOf("expr.png"))
  })

  it("head/face renders keep the face-first column order and get no full-body promotion", () => {
    const out = assembleCharacterReferenceSet({
      portraitUrl: null, referencePhotos: [], realLifeRefs: [],
      priorAssets: [
        { column: "expressions", items: [{ url: "expr.png" }] },
        { column: "poses", items: [{ url: "pose.png" }] },
      ],
      assetType: "expressions", variant: "smile",
    })
    expect(out.indexOf("expr.png")).toBeLessThan(out.indexOf("pose.png"))
  })

  it("only pulls prior assets from identity columns (ignores sheets/detail_closeups/motions)", () => {
    const out = assembleCharacterReferenceSet({
      portraitUrl: null, referencePhotos: [], realLifeRefs: [],
      priorAssets: [
        { column: "sheets", items: [{ url: "sheet.png" }] },
        { column: "detail_closeups", items: [{ url: "closeup.png" }] },
        { column: "motions", items: [{ url: "motion.mp4" }] },
        { column: "expressions", items: [{ url: "expr.png" }] },
      ],
      assetType: "expressions", variant: "smile",
    })
    expect(out).toEqual(["expr.png"])
  })
})

describe("characterPriorAssetsFromRow", () => {
  it("extracts identity columns and tolerates null / malformed values", () => {
    const cols = characterPriorAssetsFromRow({
      expressions: [{ name: "smile", url: "e1.png" }, { name: "bad" }],
      poses: null,
      body_angles: "not-an-array",
      lighting_variations: [{ url: "l1.png" }],
      sheets: [{ url: "sheet.png" }], // not an identity column → ignored
    })
    const byCol = Object.fromEntries(cols.map((c) => [c.column, c.items]))
    expect(byCol.expressions).toEqual([{ url: "e1.png" }]) // malformed item without url dropped
    expect(byCol.poses).toEqual([])
    expect(byCol.body_angles).toEqual([])
    expect(byCol.lighting_variations).toEqual([{ url: "l1.png" }])
    expect(byCol.sheets).toBeUndefined()
  })
})

describe("DEFAULT_ENTITY_REF_CAP", () => {
  it("is a conservative small positive integer", () => {
    expect(DEFAULT_ENTITY_REF_CAP).toBe(4)
  })
})

// Drift guard: preferredKind's variant keys are coupled to the shared
// CHARACTER_ASSET_VARIANTS catalog but live in a different package. These tests
// derive from the catalog so a rename / addition there fails loudly here instead
// of silently degrading to the frontFace fallback. (CLAUDE.md: invariant + guard
// over remember-to-update-the-list.)
describe("preferredKind stays in sync with CHARACTER_ASSET_VARIANTS", () => {
  const VALID_KINDS = new Set([
    "frontFace", "sideLeft", "sideRight", "threeQuarterLeft",
    "threeQuarterRight", "frontBody", "other",
  ])

  it("is total over every catalog variant (never returns an invalid kind)", () => {
    for (const [assetType, variants] of Object.entries(CHARACTER_ASSET_VARIANTS)) {
      for (const variant of variants) {
        expect(VALID_KINDS.has(preferredKind(assetType, variant))).toBe(true)
      }
    }
  })

  it("routes every variant of the full-body asset types to frontBody", () => {
    for (const assetType of ["poses", "bodyAngles", "lighting"] as const) {
      for (const variant of CHARACTER_ASSET_VARIANTS[assetType] ?? []) {
        expect(preferredKind(assetType, variant)).toBe("frontBody")
      }
    }
  })

  it("routes every expressions variant to frontFace", () => {
    for (const variant of CHARACTER_ASSET_VARIANTS.expressions ?? []) {
      expect(preferredKind("expressions", variant)).toBe("frontFace")
    }
  })

  it("maps the head-angle rotation variants to their side/three-quarter kinds (fails if a catalog string is renamed)", () => {
    const expected: Record<string, string> = {
      "front": "frontFace",
      "3/4 left": "threeQuarterLeft",
      "left profile": "sideLeft",
      "right profile": "sideRight",
      "3/4 right": "threeQuarterRight",
    }
    const headVariants = new Set<string>(CHARACTER_ASSET_VARIANTS.headAngles ?? [])
    for (const [variant, kind] of Object.entries(expected)) {
      expect(headVariants.has(variant)).toBe(true) // the exact string still exists in the catalog
      expect(preferredKind("headAngles", variant)).toBe(kind)
    }
  })
})
