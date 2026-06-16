import { describe, it, expect } from "vitest"
import { COMMUNITY_ENTITY_ADAPTERS, buildSnapshot, buildCloneRow } from "../community-entity-adapters.js"

// Full live column set per table. KEEP IN SYNC with the DB — this test exists so a
// new asset/PII column can't silently leak. Source: spec §7 + migrations 004/110/117/118/126/192/200/202/204/205/222.
const COLUMNS: Record<string, string[]> = {
  characters: [
    "id","project_id","workflow_id","node_id","name","description","gender","style","base_outfit",
    "source_image_url","image_provider","expressions","poses","lighting_variations","angles","motions",
    "voice","personality","user_id","reference_photos","seed_prompt","canonical_description",
    "real_life_refs_by_variant","body_angles","lora_replicate_version","lora_trigger_word",
    "lora_training_status","lora_training_replicate_id","lora_training_error","lora_trained_at",
    "lora_training_image_count","reference_videos_by_variant","selected_asset_by_variant",
    "character_sheet",
    "created_at","updated_at","deleted_at",
    // Named Character Boards (migration 212) — published + cloned like the buckets.
    "boards",
    // Reference-sheet buckets (migration 202) — published + cloned like the buckets.
    "sheets","detail_closeups","outfit_variations",
    // Structured Person + Wardrobe picker selections (migration 222) — STRIPPED on
    // share (may embed private refs), classified in stripFields.
    "person","wardrobe",
  ],
  locations: [
    "id","project_id","workflow_id","node_id","name","description","category","style","main_image_url",
    "time_of_day","weather","angles","custom_variations","created_at","updated_at","source_image_url",
    "user_id","lighting","seasons","atmosphere_motions","reference_photos","canonical_description",
    "style_lock","deleted_at","pii_consent_at","r2_assets_purged_at",
    // Named Location Boards (migration 213) — published + cloned like the buckets.
    "boards",
  ],
  objects: [
    "id","project_id","workflow_id","node_id","name","description","category","style","main_image_url",
    "angles","materials","variations","custom_variations","created_at","updated_at","source_image_url",
    "user_id","motion_clips","reference_photos","canonical_description","style_lock","deleted_at",
    // Named Product Boards (migration 213) — published + cloned like the buckets.
    "boards",
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
    // Creature Boards + the "talking creature" voice (migration 220) —
    // boards published + cloned like the buckets; voice carried by KIND.
    "boards","voice",
  ],
}

const ALWAYS_IGNORED = new Set([
  "id","project_id","workflow_id","node_id","user_id","created_at","updated_at","deleted_at",
  "r2_assets_purged_at",
  // System/derived columns (added with the creatures table, migration 204/205): the
  // provider that produced the assets, and the per-variant selected-asset pointer map.
  // Neither is public text nor a copyable asset URL — they're recomputed/owner-local.
  "image_provider","selected_asset_by_variant",
  // legacy dead column (migration 004) — superseded by sheets/detail_closeups/outfit_variations; physically present but no route/business code reads or writes it.
  "character_sheet",
])

describe("character adapter classifies every column", () => {
  it("every characters column is public-text | asset | strip | ignored", () => {
    const a = COMMUNITY_ENTITY_ADAPTERS.character
    const classified = new Set([...a.publicTextFields, ...a.assetFields, ...a.stripFields, ...ALWAYS_IGNORED])
    const unclassified = COLUMNS.characters.filter((c) => !classified.has(c))
    expect(unclassified).toEqual([])
  })
  it("character assetFields use real columns (no phantom character_sheet) and carry sheets/detail/outfit", () => {
    const a = COMMUNITY_ENTITY_ADAPTERS.character
    expect(a.assetFields).not.toContain("character_sheet")
    expect(a.assetFields).toContain("sheets")
    expect(a.assetFields).toContain("detail_closeups")
    expect(a.assetFields).toContain("outfit_variations")
  })
  // REVERSE guard: catches a phantom adapter field that isn't a real column (the
  // bug that silently dropped sheets/detail/outfit lived precisely because the
  // forward guard above can't see a declared field pointing at a non-existent column).
  it("every character adapter field is a REAL column (no phantom fields)", () => {
    const a = COMMUNITY_ENTITY_ADAPTERS.character
    const real = new Set(COLUMNS.characters)
    const declared = [...a.publicTextFields, ...a.assetFields, ...a.stripFields]
    expect(declared.filter((f) => !real.has(f))).toEqual([])
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
  it("treats boards as an asset (migration 220 — published + cloned like objects/locations)", () => {
    const a = COMMUNITY_ENTITY_ADAPTERS.creature
    expect(a.assetFields).toContain("boards")
  })
  it("strip-lists voice like characters (buildSnapshot re-adds it by KIND)", () => {
    const a = COMMUNITY_ENTITY_ADAPTERS.creature
    expect(a.stripFields).toContain("voice")
    expect(a.assetFields).not.toContain("voice")
    expect(a.publicTextFields).not.toContain("voice")
  })
})

// The creature voice carry mirrors the character rules exactly (Decision A):
// premade + library survive fully; custom/cloned reduce to display name +
// sample. One test per kind so a regression that re-gates the voice block to
// `entityType === "character"` only fails loudly here.
describe("buildSnapshot (creature voice + boards)", () => {
  const row = {
    name: "Ember", description: "a small red dragon", species: "dragon",
    canonical_description: "cd", source_image_url: "u",
    reference_photos: [{ kind: "side", url: "PII" }],
  }
  it("keeps a premade voice fully", () => {
    const snap = buildSnapshot(
      "creature",
      { ...row, voice: { voiceId: "v", voiceType: "premade" } },
      {},
    ) as Record<string, unknown>
    expect(snap.voice).toEqual({ voiceId: "v", voiceType: "premade" })
  })
  it("keeps a library voice fully (public ElevenLabs data)", () => {
    const voice = {
      voiceId: "V55PLkF0YuZYdHsom49R", voiceName: "Growl", traits: "raspy",
      voiceType: "library", previewUrl: "https://cdn/p.mp3", ttsProvider: "elevenlabs-turbo",
    }
    const snap = buildSnapshot("creature", { ...row, voice }, {}) as Record<string, unknown>
    expect(snap.voice).toEqual(voice)
  })
  it("reduces a custom/cloned voice to display-name + sample (drops voiceId)", () => {
    const snap = buildSnapshot(
      "creature",
      { ...row, voice: { voiceId: "v", voiceName: "My Cat's Voice", traits: "soft", voiceType: "custom", previewUrl: "https://cdn/s.mp3" } },
      {},
    ) as Record<string, unknown>
    expect(snap.voice).toEqual({ voiceName: "My Cat's Voice", voiceType: "custom", previewUrl: "https://cdn/s.mp3" })
  })
  it("snapshots COPIED boards and buildCloneRow hands them (+ voice) to the consumer", () => {
    const boards = [{ name: "Moods", url: "COPIED-BOARD" }]
    const snap = buildSnapshot(
      "creature",
      { ...row, voice: { voiceId: "v", voiceType: "premade" }, boards: [{ name: "Moods", url: "orig" }] },
      { boards },
    ) as Record<string, unknown>
    expect(snap.boards).toEqual(boards)
    expect(snap.reference_photos).toBeUndefined()

    const clone = buildCloneRow("creature", snap, {
      userId: "u2", projectId: "p2", name: "Ember Copy", copiedAssets: { boards },
    }) as Record<string, unknown>
    expect(clone.boards).toEqual(boards)
    expect(clone.voice).toEqual({ voiceId: "v", voiceType: "premade" })
    expect(clone.user_id).toBe("u2")
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

  it("keeps a library voice fully (public ElevenLabs data — id + preview + provider)", () => {
    const voice = {
      voiceId: "V55PLkF0YuZYdHsom49R", voiceName: "Mike", traits: "deep",
      voiceType: "library", previewUrl: "https://cdn/p.mp3", ttsProvider: "elevenlabs-turbo",
    }
    const snap = buildSnapshot("character", { ...row, voice }, {}) as Record<string, unknown>
    expect(snap.voice).toEqual(voice)
  })

  it("classifies a legacy untyped premade-name voice as premade and carries it", () => {
    const snap = buildSnapshot(
      "character",
      { ...row, voice: { voiceId: "Rachel", voiceName: "Rachel", traits: "calm" } },
      {},
    ) as Record<string, unknown>
    expect(snap.voice).toEqual({ voiceId: "Rachel", voiceName: "Rachel", traits: "calm", voiceType: "premade" })
  })

  it("reduces a custom voice to display-name + sample (drops voiceId)", () => {
    const snap = buildSnapshot(
      "character",
      { ...row, voice: { voiceId: "v", voiceName: "My Clone", traits: "warm", voiceType: "custom", previewUrl: "https://cdn/clone-sample.mp3" } },
      {},
    ) as Record<string, unknown>
    expect(snap.voice).toEqual({ voiceName: "My Clone", voiceType: "custom", previewUrl: "https://cdn/clone-sample.mp3" })
  })

  it("reduces a legacy untyped voice with an unrecognized id to name-only (could be a clone)", () => {
    const snap = buildSnapshot(
      "character",
      { ...row, voice: { voiceId: "aB3dE5fG7hI9kL1mN0pQ", voiceName: "Old Voice" } },
      {},
    ) as Record<string, unknown>
    expect(snap.voice).toEqual({ voiceName: "Old Voice", voiceType: undefined })
  })

  it("carries reference_videos_by_variant from copiedAssets", () => {
    const snap = buildSnapshot(
      "character",
      row,
      { reference_videos_by_variant: { smile: ["c1", "c2"] } },
    ) as Record<string, unknown>
    expect(snap.reference_videos_by_variant).toEqual({ smile: ["c1", "c2"] })
  })

  it("carries boards (named reference sheets) from copiedAssets", () => {
    const snap = buildSnapshot(
      "character",
      { ...row, boards: [{ name: "Evening gown", url: "PRIVATE" }] },
      { boards: [{ name: "Evening gown", url: "COPIED-B" }] },
    ) as Record<string, unknown>
    expect(snap.boards).toEqual([{ name: "Evening gown", url: "COPIED-B" }])
  })

  it("locations + objects carry boards through snapshot AND clone too", () => {
    const locSnap = buildSnapshot(
      "location",
      { name: "Loft", boards: [{ name: "Winter", url: "PRIVATE" }] },
      { boards: [{ name: "Winter", url: "COPIED-L" }] },
    ) as Record<string, unknown>
    expect(locSnap.boards).toEqual([{ name: "Winter", url: "COPIED-L" }])

    const objClone = buildCloneRow(
      "object",
      { name: "Lamp", boards: [{ name: "Brass", url: "SNAP-O" }] },
      {
        userId: "u1", projectId: "p1", name: "Lamp 2",
        copiedAssets: { boards: [{ name: "Brass", url: "CLONED-O" }] },
      },
    ) as Record<string, unknown>
    expect(objClone.boards).toEqual([{ name: "Brass", url: "CLONED-O" }])
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

  it("hands the consumer their own boards copy to extend", () => {
    const snapshot = { name: "Hero", boards: [{ name: "Evening gown", url: "SNAP-B" }] }
    const row = buildCloneRow("character", snapshot, {
      userId: "u1", projectId: "p1", name: "Hero 2",
      copiedAssets: { boards: [{ name: "Evening gown", url: "CLONED-B" }] },
    }) as Record<string, unknown>
    expect(row.boards).toEqual([{ name: "Evening gown", url: "CLONED-B" }])
  })

  it("mints a FRESH node_id for every clone (a NULL node_id used to break studio updates on the copy)", () => {
    for (const kind of ["character", "location", "object", "creature"] as const) {
      const row = buildCloneRow(kind, { name: "X" }, {
        userId: "u1", projectId: "p1", name: "X 2", copiedAssets: {},
      }) as Record<string, unknown>
      expect(typeof row.node_id).toBe("string")
      expect((row.node_id as string).length).toBeGreaterThan(0)
    }
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
