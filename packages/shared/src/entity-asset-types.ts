/**
 * Structural entity vocabulary — asset-type/attach-column tuples, reference
 * photo kinds, styles, labels. Product data visible in the UI and required
 * by SDK consumers; deliberately part of the public Apache surface.
 * (The prompt-BUILDING craft lives in @nodaro/prompts.)
 */

/**
 * Prompt builders for entity nodes (character, face, object, location).
 *
 * Single source of truth shared between:
 * - Route handlers: `backend/src/routes/generate-{character,face,object,location}.ts`
 * - Backend orchestrator: `backend/src/services/workflow-engine/payload-builder.ts`
 *
 * The route handlers call these when no client-supplied prompt is provided.
 * The orchestrator calls these to build the same prompt that a single-node
 * HTTP call would produce.
 */

/**
 * Allowed style values for character / face / object / location entities.
 * Single source of truth: derive Zod enums + TS types from this tuple so the
 * Zod schema, the TS union, the SDK input types, and the CLI flag validator
 * never drift apart.
 */
export const CHARACTER_STYLES = ["realistic", "anime", "3d-pixar", "illustration"] as const
export type EntityStyle = (typeof CHARACTER_STYLES)[number]

/**
 * Character asset-type enum — the kinds of variant a user can generate off a
 * character's anchor portrait. Mirrors the literal accepted by
 * `POST /v1/generate-character-asset` (`backend/src/routes/generate-character-asset.ts`)
 * and consumed by the MCP `generate_character` verb (kind="asset") in
 * `backend/src/lib/mcp/tools/verbs-clo.ts`.
 *
 * `angles` is the legacy single-surface alias for `headAngles` — both produce
 * head-and-shoulders portrait framing. `bodyAngles` is the full-body variant.
 * `lighting` is the bucket key (the DB column is `lighting_variations`).
 */
export const CHARACTER_ASSET_TYPES = [
  "expressions",
  "poses",
  "lighting",
  "angles",
  "headAngles",
  "bodyAngles",
  "custom",
] as const
export type CharacterAssetType = (typeof CHARACTER_ASSET_TYPES)[number]

/**
 * DB columns the character-asset worker may auto-attach to. Required when
 * `assetType === "custom"` (the worker can't infer the bucket from the asset
 * type); for canonical asset types the column is derived automatically.
 *
 * Mirrors the literal accepted by the route's `attachToColumn` Zod field.
 */
export const CHARACTER_ATTACH_COLUMNS = [
  "expressions",
  "poses",
  "angles",
  "body_angles",
  "lighting_variations",
  // Reference-sheet buckets (migration 200). `sheets` holds composited
  // reference sheets; `detail_closeups` holds macro close-up panels;
  // `outfit_variations` holds wardrobe panels (character-only — objects and
  // locations don't have an outfit dimension).
  "sheets",
  "detail_closeups",
  "outfit_variations",
] as const
export type CharacterAttachColumn = (typeof CHARACTER_ATTACH_COLUMNS)[number]

/**
 * Canonical variant presets per character asset type — the SINGLE source of
 * truth shared by the `generate-character-asset` route (Zod validation rejects a
 * non-`custom` variant outside this list) and any client building the asset-set
 * UI (e.g. the Studio character creator), so the two can't drift. `custom` has no
 * preset list (free-form variant).
 */
export const CHARACTER_ASSET_VARIANTS = {
  expressions: [
    "neutral",
    "smile",
    "angry",
    "surprised",
    "sad",
    "talking",
    "laughing",
    "disgusted",
    "fearful",
    "smirk",
    "crying",
  ],
  poses: [
    "standing",
    "walking",
    "sitting",
    "running",
    "crouching",
    "pointing",
    "fighting stance",
    "jumping",
    "turning",
  ],
  lighting: ["daylight", "night", "dramatic"],
  angles: ["front", "3/4 left", "left profile", "right profile", "3/4 right", "back", "above", "below"],
  headAngles: ["front", "3/4 left", "left profile", "right profile", "3/4 right", "above", "below", "back"],
  bodyAngles: ["front", "3/4 left", "left profile", "right profile", "3/4 right", "back", "above", "below"],
} as const satisfies Partial<Record<CharacterAssetType, readonly string[]>>

/**
 * Location asset-type enum — the kinds of variant a user can generate off a
 * location's anchor establishing shot. Mirrors the literal accepted by
 * `POST /v1/generate-location-asset` (`backend/src/routes/generate-location-asset.ts`)
 * and consumed by the MCP `generate_location` verb (kind="asset").
 *
 * `lighting` is the bucket key (the DB column is `lighting`). `custom` is the
 * free-form bucket where callers must supply `attachToColumn` explicitly since
 * the worker can't infer the destination from the asset type.
 */
export const LOCATION_ASSET_TYPES = [
  "timeOfDay",
  "weather",
  "seasons",
  "angles",
  "lighting",
  "custom",
] as const
export type LocationAssetType = (typeof LOCATION_ASSET_TYPES)[number]

/**
 * DB columns the location-asset worker may auto-attach to. Required when
 * `assetType === "custom"` (the worker can't infer the bucket from the asset
 * type); for canonical asset types the column is derived automatically.
 *
 * Mirrors the literal accepted by the route's `attachToColumn` Zod field.
 */
export const LOCATION_ATTACH_COLUMNS = [
  "time_of_day",
  "weather",
  "seasons",
  "angles",
  "lighting",
  "atmosphere_motions",
  // Reference-sheet buckets (migration 200). Locations get `sheets` +
  // `detail_closeups` (no `outfit_variations` — that's character-only).
  "sheets",
  "detail_closeups",
] as const
export type LocationAttachColumn = (typeof LOCATION_ATTACH_COLUMNS)[number]

/**
 * Canonical variant presets per LOCATION asset type — hoisted from
 * `backend/src/routes/generate-location-asset.ts` (single source of truth shared
 * with the reference-sheet catalog; Plan 04 switches the route to import this).
 */
export const LOCATION_ASSET_VARIANTS = {
  timeOfDay: ["dawn", "morning", "noon", "afternoon", "golden hour", "dusk", "blue hour", "night", "midnight"],
  weather: ["clear", "cloudy", "light rain", "heavy rain", "storm", "snow", "blizzard", "fog", "mist"],
  seasons: ["spring", "summer", "autumn", "winter"],
  angles: ["wide", "medium", "closeup", "aerial", "low-angle", "eye-level", "bird's-eye", "dutch tilt"],
  lighting: ["soft natural", "harsh sunlight", "golden", "blue hour", "neon", "candlelit", "cinematic", "dramatic chiaroscuro"],
} as const satisfies Partial<Record<LocationAssetType, readonly string[]>>

/**
 * Reference-photo kind discriminator — the mood-board roles a user can attach
 * to a location row. Single source of truth shared between:
 *  - Backend route Zod enum (`backend/src/routes/locations.ts`)
 *  - Backend export/import bundle schema (`backend/src/lib/workflow-assets.ts`)
 *  - Frontend Studio picker (`reference-photos-section.tsx`)
 *  - Frontend `LocationNodeData.referencePhotos.kind` union (`frontend/src/types/nodes.ts`)
 *
 * `other` is the free-form bucket; the rest are user-curated mood-board roles.
 */
export const LOCATION_REFERENCE_PHOTO_KINDS = [
  "wide",
  "interior",
  "exterior",
  "detail",
  "moodBoard",
  "other",
] as const
export type LocationReferencePhotoKind = (typeof LOCATION_REFERENCE_PHOTO_KINDS)[number]

/**
 * Human-friendly label for each photo kind, used in prompt subject lines
 * (`Image N (Old Library — wide-angle reference)`) so the model knows the
 * role of each reference photo at generate time. Kept as a separate map
 * from `LOCATION_REFERENCE_PHOTO_KINDS` so labels can be edited without
 * disturbing the kind enum (which is the schema-of-record).
 */
export const LOCATION_REFERENCE_PHOTO_KIND_LABELS: Record<LocationReferencePhotoKind, string> = {
  wide: "wide-angle reference",
  interior: "interior reference",
  exterior: "exterior reference",
  detail: "detail reference",
  moodBoard: "mood-board reference",
  other: "reference",
}

export function locationReferencePhotoKindLabel(kind: LocationReferencePhotoKind): string {
  return LOCATION_REFERENCE_PHOTO_KIND_LABELS[kind]
}

/**
 * Reference-photo kinds captured in the Character Studio identity foundation —
 * the SINGLE schema-of-record for the 7 kinds. Previously duplicated across the
 * `generate-character` + `characters` route Zod enums, `character-reference-set.ts`
 * (backend ranking), and `frontend/src/lib/reference-photo-routing.ts` (UI
 * filtering). All of those now derive from this const (build a Zod enum via
 * `z.enum(CHARACTER_REFERENCE_PHOTO_KINDS)` at the backend edge — this package
 * stays zod-free). Also the shape of the DB `characters.reference_photos[].kind`.
 *
 * `other` is the free-form bucket; the rest are curated identity-foundation roles
 * (frontFace + the four rotation views + a full-body shot).
 */
export const CHARACTER_REFERENCE_PHOTO_KINDS = [
  "frontFace",
  "sideLeft",
  "sideRight",
  "threeQuarterLeft",
  "threeQuarterRight",
  "frontBody",
  "other",
] as const
export type CharacterReferencePhotoKind = (typeof CHARACTER_REFERENCE_PHOTO_KINDS)[number]

/** A single character reference photo: a URL plus its identity-foundation role. */
export interface CharacterReferencePhoto {
  url: string
  kind: CharacterReferencePhotoKind
}

/**
 * Reserved name the Character Studio auto-assigns when a user clicks Generate
 * before naming the character. Treated as "no name" by prompt builders so the
 * literal string "Untitled character" never leaks into a generation prompt.
 * Frontend stays in sync via `@nodaro/shared`.
 */
export const PLACEHOLDER_CHARACTER_NAME = "Untitled character"


export const OBJECT_ASSET_TYPES = [
  "angles",
  "materials",
  "variations",
  "motion",
  "custom",
] as const
export type ObjectAssetType = (typeof OBJECT_ASSET_TYPES)[number]

/**
 * DB columns the object-asset worker may auto-attach to. Aligns with the
 * `append_object_asset` RPC's CASE/WHEN whitelist (migration 147). Required
 * when `assetType === "custom"`; for canonical asset types the column is
 * derived automatically.
 */
export const OBJECT_ATTACH_COLUMNS = [
  "angles",
  "materials",
  "variations",
  "motion_clips",
  // Reference-sheet buckets (migration 200). Objects get `sheets` +
  // `detail_closeups` (no `outfit_variations` — that's character-only).
  "sheets",
  "detail_closeups",
] as const
export type ObjectAttachColumn = (typeof OBJECT_ATTACH_COLUMNS)[number]

/** Worker-attachable JSONB asset columns on `creatures` (mirrors OBJECT_ATTACH_COLUMNS;
 *  `materials`→`poses`). The append_creature_asset RPC (migration 206) whitelists these. */
export const CREATURE_ATTACH_COLUMNS = [
  "angles", "poses", "variations", "motion_clips", "sheets", "detail_closeups",
] as const
export type CreatureAttachColumn = (typeof CREATURE_ATTACH_COLUMNS)[number]

/**
 * Canonical variant presets per OBJECT asset type — hoisted from
 * `backend/src/routes/generate-object-asset.ts` so the route, the reference-sheet
 * catalog, and any client share one list and can't drift. (Plan 04 switches the
 * route to import this.) `custom`/`motion` have no preset list.
 */
export const OBJECT_ASSET_VARIANTS = {
  angles: ["front", "side", "top", "back", "three-quarter"],
  materials: ["wood", "metal", "glass", "plastic", "fabric", "stone"],
  variations: ["clean", "weathered", "damaged", "ornate", "minimal"],
} as const satisfies Partial<Record<ObjectAssetType, readonly string[]>>

/**
 * Input shape for buildObjectMotionPrompt.
 *
 * Mirrors LocationMotionPromptInput's role. `canonicalDescription` is preferred
 * (LLM-authored from the approved main image) but the helper falls back to
 * category+name if not yet set, and to a generic placeholder if both are absent.
 */
