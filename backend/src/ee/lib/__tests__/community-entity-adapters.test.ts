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
}

const ALWAYS_IGNORED = new Set([
  "id","project_id","workflow_id","node_id","user_id","created_at","updated_at","deleted_at",
  "r2_assets_purged_at",
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
