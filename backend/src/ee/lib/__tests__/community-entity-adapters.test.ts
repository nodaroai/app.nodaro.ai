import { describe, it, expect } from "vitest"
import { COMMUNITY_ENTITY_ADAPTERS, buildSnapshot, buildCloneRow } from "../community-entity-adapters.js"

// Full live column set per table. KEEP IN SYNC with the DB — this test exists so a
// new asset/PII column can't silently leak. Source: spec §7 + migrations 004/110/117/118/126/192.
const COLUMNS: Record<string, string[]> = {
  characters: [
    "id","project_id","workflow_id","node_id","name","description","gender","style","base_outfit",
    "source_image_url","character_sheet","expressions","poses","lighting_variations","angles","motions",
    "voice","personality","user_id","reference_photos","seed_prompt","canonical_description",
    "real_life_refs_by_variant","body_angles","lora_replicate_version","lora_trigger_word",
    "lora_training_status","lora_training_replicate_id","lora_training_error","lora_trained_at",
    "lora_training_image_count","reference_videos_by_variant","created_at","updated_at","deleted_at",
  ],
  locations: [
    "id","project_id","workflow_id","node_id","name","description","category","style","main_image_url",
    "time_of_day","weather","angles","custom_variations","created_at","updated_at","source_image_url",
    "user_id","lighting","seasons","atmosphere_motions","reference_photos","canonical_description",
    "style_lock","deleted_at","pii_consent_at","r2_assets_purged_at",
  ],
  objects: [
    "id","project_id","workflow_id","node_id","name","description","category","style","main_image_url",
    "angles","materials","variations","custom_variations","created_at","updated_at","source_image_url",
    "user_id","motion_clips","reference_photos","canonical_description","style_lock","deleted_at",
  ],
  // FULL physical column set from migration 206_creatures.sql (NOT copied from the
  // stale objects block above — that one omits image_provider/selected_asset_by_variant/
  // sheets/detail_closeups). Every column below is classified by the creature adapter
  // (publicText ∪ asset ∪ strip) or in ALWAYS_IGNORED, so this guard is live.
  creatures: [
    "id","project_id","workflow_id","node_id","name","description","species","category","style",
    "main_image_url","source_image_url","image_provider","angles","poses","variations","custom_variations",
    "motion_clips","reference_photos","sheets","detail_closeups","canonical_description","style_lock",
    "selected_asset_by_variant","deleted_at","created_at","updated_at","user_id",
  ],
}

const ALWAYS_IGNORED = new Set([
  "id","project_id","workflow_id","node_id","user_id","created_at","updated_at","deleted_at",
  "r2_assets_purged_at",
  // System/derived columns (added with the creatures table, migration 204/205): the
  // provider that produced the assets, and the per-variant selected-asset pointer map.
  // Neither is public text nor a copyable asset URL — they're recomputed/owner-local.
  "image_provider","selected_asset_by_variant",
])

describe("character adapter classifies every column", () => {
  it("every characters column is public-text | asset | strip | ignored", () => {
    const a = COMMUNITY_ENTITY_ADAPTERS.character
    const classified = new Set([...a.publicTextFields, ...a.assetFields, ...a.stripFields, ...ALWAYS_IGNORED])
    const unclassified = COLUMNS.characters.filter((c) => !classified.has(c))
    expect(unclassified).toEqual([])
  })
})

describe("location adapter classifies every column", () => {
  it("every locations column is public-text | asset | strip | ignored", () => {
    const a = COMMUNITY_ENTITY_ADAPTERS.location
    const classified = new Set([...a.publicTextFields, ...a.assetFields, ...a.stripFields, ...ALWAYS_IGNORED])
    const unclassified = COLUMNS.locations.filter((c) => !classified.has(c))
    expect(unclassified).toEqual([])
  })
})

describe("object adapter classifies every column", () => {
  it("every objects column is public-text | asset | strip | ignored", () => {
    const a = COMMUNITY_ENTITY_ADAPTERS.object
    const classified = new Set([...a.publicTextFields, ...a.assetFields, ...a.stripFields, ...ALWAYS_IGNORED])
    const unclassified = COLUMNS.objects.filter((c) => !classified.has(c))
    expect(unclassified).toEqual([])
  })
})

describe("creature adapter classifies every column", () => {
  it("every creatures column is public-text | asset | strip | ignored", () => {
    const a = COMMUNITY_ENTITY_ADAPTERS.creature
    const classified = new Set([...a.publicTextFields, ...a.assetFields, ...a.stripFields, ...ALWAYS_IGNORED])
    const unclassified = COLUMNS.creatures.filter((c) => !classified.has(c))
    expect(unclassified).toEqual([])
  })
  it("strips reference_photos (PII) and never classifies it as an asset/public field", () => {
    const a = COMMUNITY_ENTITY_ADAPTERS.creature
    expect(a.stripFields).toContain("reference_photos")
    expect(a.assetFields).not.toContain("reference_photos")
    expect(a.publicTextFields).not.toContain("reference_photos")
  })
  it("treats species as public text and poses (the renamed materials slot) as an asset", () => {
    const a = COMMUNITY_ENTITY_ADAPTERS.creature
    expect(a.publicTextFields).toContain("species")
    expect(a.assetFields).toContain("poses")
    expect(a.assetFields).not.toContain("materials")
  })
  it("strips custom_variations (private — mirrors object/location), never publishes it", () => {
    const a = COMMUNITY_ENTITY_ADAPTERS.creature
    expect(a.stripFields).toContain("custom_variations")
    expect(a.assetFields).not.toContain("custom_variations")
  })
})

describe("buildSnapshot (character)", () => {
  const row = {
    name: "Hero", description: "d", gender: "f", canonical_description: "cd",
    source_image_url: "u", expressions: [{ name: "smile", url: "e" }],
    reference_photos: [{ kind: "face", url: "PII" }],
    voice: { voiceId: "v", voiceType: "custom" },
    lora_trigger_word: "trg",
  }
  it("includes public text + COPIED assets, strips PII/lora; drops a custom voice with no name", () => {
    const snap = buildSnapshot("character", row, { source_image_url: "COPIED" }) as Record<string, unknown>
    expect(snap.name).toBe("Hero")
    expect(snap.canonical_description).toBe("cd")
    expect(snap.source_image_url).toBe("COPIED")
    expect(snap.reference_photos).toBeUndefined()
    expect(snap.lora_trigger_word).toBeUndefined()
    expect(snap.voice).toBeUndefined()
  })
  it("keeps premade voice", () => {
    const snap = buildSnapshot("character", { ...row, voice: { voiceId: "v", voiceType: "premade" } }, {}) as Record<string, unknown>
    expect(snap.voice).toEqual({ voiceId: "v", voiceType: "premade" })
  })

  it("reduces a custom voice to display-name-only (drops voiceId)", () => {
    const snap = buildSnapshot(
      "character",
      { ...row, voice: { voiceId: "v", voiceName: "My Clone", traits: "warm", voiceType: "custom" } },
      {},
    ) as Record<string, unknown>
    expect(snap.voice).toEqual({ voiceName: "My Clone", voiceType: "custom" })
  })

  it("carries reference_videos_by_variant from copiedAssets", () => {
    const snap = buildSnapshot(
      "character",
      row,
      { reference_videos_by_variant: { smile: ["c1", "c2"] } },
    ) as Record<string, unknown>
    expect(snap.reference_videos_by_variant).toEqual({ smile: ["c1", "c2"] })
  })
})

describe("buildCloneRow (character)", () => {
  it("sets owner/project/name + copied assets, drops voice when absent", () => {
    const snapshot = { name: "Hero", canonical_description: "cd", source_image_url: "SNAP" }
    const row = buildCloneRow("character", snapshot, { userId: "u1", projectId: "p1", name: "Hero 2", copiedAssets: { source_image_url: "CLONED" } }) as Record<string, unknown>
    expect(row.user_id).toBe("u1"); expect(row.project_id).toBe("p1"); expect(row.name).toBe("Hero 2")
    expect(row.canonical_description).toBe("cd")
    expect(row.source_image_url).toBe("CLONED")
  })
})

describe("buildSnapshot (creature)", () => {
  const row = {
    name: "Smaug", description: "a dragon", species: "dragon", category: "mythical",
    style: "epic", canonical_description: "cd", style_lock: true,
    main_image_url: "u", source_image_url: "s",
    poses: [{ name: "coiled", url: "p" }],
    reference_photos: [{ kind: "mood", url: "PII" }],
    image_provider: "kie",
    selected_asset_by_variant: { angles: "x" },
  }
  it("includes public text (incl. species) + COPIED assets, strips PII + system columns", () => {
    const snap = buildSnapshot("creature", row, {
      main_image_url: "COPIED", poses: [{ name: "coiled", url: "COPIED-P" }],
    }) as Record<string, unknown>
    expect(snap.name).toBe("Smaug")
    expect(snap.species).toBe("dragon")
    expect(snap.canonical_description).toBe("cd")
    expect(snap.style_lock).toBe(true)
    expect(snap.main_image_url).toBe("COPIED")
    expect(snap.poses).toEqual([{ name: "coiled", url: "COPIED-P" }])
    // PII + system columns never leak into the public snapshot.
    expect(snap.reference_photos).toBeUndefined()
    expect(snap.image_provider).toBeUndefined()
    expect(snap.selected_asset_by_variant).toBeUndefined()
    // No voice special-case for non-character entities.
    expect(snap.voice).toBeUndefined()
  })
})

describe("buildCloneRow (creature)", () => {
  it("sets owner/project/name + copied assets (poses), carries species, no voice", () => {
    const snapshot = { name: "Smaug", species: "dragon", canonical_description: "cd", main_image_url: "SNAP" }
    const cloned = buildCloneRow("creature", snapshot, {
      userId: "u1", projectId: "p1", name: "Smaug 2",
      copiedAssets: { main_image_url: "CLONED", poses: [{ name: "coiled", url: "CLONED-P" }] },
    }) as Record<string, unknown>
    expect(cloned.user_id).toBe("u1"); expect(cloned.project_id).toBe("p1"); expect(cloned.name).toBe("Smaug 2")
    expect(cloned.species).toBe("dragon")
    expect(cloned.canonical_description).toBe("cd")
    expect(cloned.main_image_url).toBe("CLONED")
    expect(cloned.poses).toEqual([{ name: "coiled", url: "CLONED-P" }])
    expect(cloned.voice).toBeUndefined()
  })
})
