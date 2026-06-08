export type EntityType = "character" | "location" | "object" | "creature"

export interface CommunityEntityAdapter {
  readonly table: "characters" | "locations" | "objects" | "creatures"
  readonly publicTextFields: readonly string[]
  readonly assetFields: readonly string[]
  readonly stripFields: readonly string[]
}

export const COMMUNITY_ENTITY_ADAPTERS: Record<EntityType, CommunityEntityAdapter> = {
  character: {
    table: "characters",
    publicTextFields: [
      "name", "description", "gender", "base_outfit", "style",
      "canonical_description", "seed_prompt", "personality",
    ],
    assetFields: [
      "source_image_url", "character_sheet", "expressions", "poses",
      "lighting_variations", "angles", "body_angles", "motions",
      "reference_videos_by_variant",
    ],
    stripFields: [
      "reference_photos", "real_life_refs_by_variant",
      "voice",
      "lora_replicate_version", "lora_trigger_word", "lora_training_status",
      "lora_training_replicate_id", "lora_training_error", "lora_trained_at",
      "lora_training_image_count",
    ],
  },
  location: {
    table: "locations",
    publicTextFields: ["name", "description", "category", "style", "canonical_description", "style_lock"],
    assetFields: ["main_image_url", "source_image_url", "time_of_day", "weather", "angles", "lighting", "seasons", "atmosphere_motions"],
    stripFields: ["reference_photos", "custom_variations", "pii_consent_at"],
  },
  object: {
    table: "objects",
    publicTextFields: ["name", "description", "category", "style", "canonical_description", "style_lock"],
    assetFields: ["main_image_url", "source_image_url", "angles", "materials", "variations", "motion_clips"],
    stripFields: ["reference_photos", "custom_variations"],
  },
  // Creature mirrors the object adapter for the shared column set (D10 — the
  // creatures table is a structural clone of objects), with three deltas:
  //   • species → publicTextFields (creature-specific column)
  //   • poses   → assetFields      (the renamed objects.materials slot)
  //   • the four columns the object adapter omits (pre-existing drift) are
  //     classified here: sheets/detail_closeups → assetFields (R2-backed
  //     {name,url} arrays); image_provider/selected_asset_by_variant are
  //     system/derived and live in the test's ALWAYS_IGNORED set.
  // Every column in 206_creatures.sql is classified — see COLUMNS.creatures in
  // the classification test.
  creature: {
    table: "creatures",
    publicTextFields: ["name", "description", "species", "category", "style", "canonical_description", "style_lock"],
    assetFields: ["main_image_url", "source_image_url", "angles", "poses", "variations", "motion_clips", "sheets", "detail_closeups"],
    // custom_variations is STRIPPED (mirrors object/location): user-authored private
    // variation content must not be R2-copied into the public snapshot on share.
    stripFields: ["reference_photos", "custom_variations"],
  },
}

/**
 * Public-safe snapshot: public text + the COPIED asset URLs (copiedAssets maps
 * field → new community URL/array). Strips everything in stripFields, EXCEPT
 * `voice` survives when voiceType === "premade".
 */
export function buildSnapshot(
  entityType: EntityType,
  row: Record<string, unknown>,
  copiedAssets: Record<string, unknown>,
): Record<string, unknown> {
  const a = COMMUNITY_ENTITY_ADAPTERS[entityType]
  const snap: Record<string, unknown> = {}
  for (const f of a.publicTextFields) if (row[f] !== undefined && row[f] !== null) snap[f] = row[f]
  for (const f of a.assetFields) if (copiedAssets[f] !== undefined) snap[f] = copiedAssets[f]
  const voice = row.voice as
    | { voiceId?: string; voiceName?: string; voiceType?: string }
    | null
    | undefined
  if (entityType === "character" && voice) {
    if (voice.voiceType === "premade") {
      snap.voice = voice
    } else if (voice.voiceName) {
      // Custom/cloned: carry the DISPLAY NAME only — never a usable voiceId
      // cross-user (privacy). Decision A.
      snap.voice = { voiceName: voice.voiceName, voiceType: voice.voiceType }
    }
  }
  return snap
}

/** Build the new private row for a clone (consumer-owned). */
export function buildCloneRow(
  entityType: EntityType,
  snapshot: Record<string, unknown>,
  ctx: { userId: string; projectId: string; name: string; copiedAssets: Record<string, unknown> },
): Record<string, unknown> {
  const a = COMMUNITY_ENTITY_ADAPTERS[entityType]
  const out: Record<string, unknown> = { user_id: ctx.userId, project_id: ctx.projectId, name: ctx.name }
  for (const f of a.publicTextFields) if (f !== "name" && snapshot[f] !== undefined) out[f] = snapshot[f]
  for (const f of a.assetFields) if (ctx.copiedAssets[f] !== undefined) out[f] = ctx.copiedAssets[f]
  if (snapshot.voice !== undefined) out.voice = snapshot.voice
  return out
}
