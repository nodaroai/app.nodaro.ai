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
  headAngles: ["front", "3/4 left", "left profile", "right profile", "3/4 right", "above", "below"],
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
 * Reserved name the Character Studio auto-assigns when a user clicks Generate
 * before naming the character. Treated as "no name" by prompt builders so the
 * literal string "Untitled character" never leaks into a generation prompt.
 * Frontend stays in sync via `@nodaro/shared`.
 */
export const PLACEHOLDER_CHARACTER_NAME = "Untitled character"

function effectiveName(name: string): string | undefined {
  const trimmed = name.trim()
  if (!trimmed || trimmed === PLACEHOLDER_CHARACTER_NAME) return undefined
  return trimmed
}

export interface CharacterPromptInput {
  name: string
  description?: string
  gender?: string
  style?: EntityStyle | string
  baseOutfit?: string
}

export function buildCharacterPrompt(input: CharacterPromptInput): string {
  const charDesc = [effectiveName(input.name), input.gender, input.description].filter(Boolean).join(", ")
  const outfitDesc = input.baseOutfit ? `, wearing ${input.baseOutfit}` : ""
  const styleDesc = input.style ?? "realistic"
  return [
    `${charDesc}${outfitDesc},`,
    `${styleDesc} style, front view, looking at camera,`,
    "full body portrait, 4k, highly detailed, clean background.",
  ].join(" ")
}

export interface ObjectPromptInput {
  name: string
  description?: string
  category?: string
  style?: EntityStyle | string
}

export function buildObjectPrompt(input: ObjectPromptInput): string {
  const categoryDesc = input.category ?? "object"
  const descPart = input.description ? `, ${input.description}` : ""
  const styleDesc = input.style ?? "realistic"
  return [
    `Single ${categoryDesc} ${input.name}${descPart},`,
    `${styleDesc} art style, front view,`,
    "4k, highly detailed, white/plain background, no text, no labels, no watermarks, product photography style.",
  ].join(" ")
}

export interface LocationPromptInput {
  name: string
  description?: string
  category?: string
  style?: EntityStyle | string
}

export function buildLocationPrompt(input: LocationPromptInput): string {
  const categoryDesc = input.category ?? "location"
  const descPart = input.description ? `, ${input.description}` : ""
  const styleDesc = input.style ?? "realistic"
  return [
    `${categoryDesc} scene, ${input.name}${descPart},`,
    `${styleDesc} art style,`,
    "wide establishing shot, 4k, highly detailed, cinematic lighting, no people, no text, no labels, no watermarks.",
  ].join(" ")
}

export interface FacePromptInput {
  name: string
  description?: string
  style?: EntityStyle | string
}

/**
 * Face prompt uses the "face-generation" template (resolved via prompt-templates.ts).
 * Returns the template inputs so callers can call resolveTemplate + applyTemplate.
 */
export function buildFaceTemplateInputs(input: FacePromptInput): {
  description: string
  style: string
} {
  const descParts = [input.name, input.description].filter(Boolean).join(", ")
  return { description: descParts, style: input.style ?? "realistic" }
}

export interface CharacterMotionPromptInput {
  name: string
  description?: string
  gender?: string
  style?: EntityStyle | string
  baseOutfit?: string
  motionPrompt: string
}

export function buildMotionPrompt(input: CharacterMotionPromptInput): string {
  const charDesc = [effectiveName(input.name), input.gender, input.description].filter(Boolean).join(", ")
  const outfitDesc = input.baseOutfit ? `, wearing ${input.baseOutfit}` : ""
  const styleDesc = input.style ?? "realistic"
  const charPart = charDesc ? `${charDesc}${outfitDesc}, ` : ""
  return `${charPart}${input.motionPrompt}. ${styleDesc} style.`
}

/**
 * Input shape for buildLocationMotionPrompt.
 *
 * Mirrors CharacterMotionPromptInput's role. `canonicalDescription` is preferred
 * (LLM-authored from the approved main image) but the helper falls back to
 * category+name if not yet set, and to a generic placeholder if both are absent.
 */
export interface LocationMotionPromptInput {
  name: string
  category?: string
  style?: EntityStyle | string
  motionPrompt: string
  canonicalDescription?: string
}

/**
 * Build the prompt sent to the i2v provider for a location atmosphere clip.
 *
 * Note: character's analog is named `buildMotionPrompt` (historical); location
 * uses the more specific `buildLocationMotionPrompt`.
 */
export function buildLocationMotionPrompt(input: LocationMotionPromptInput): string {
  const sceneDesc =
    input.canonicalDescription?.trim() ||
    [input.category, input.name].filter(Boolean).join(", ").trim() ||
    "A generic location"
  return `${sceneDesc}. Camera move: ${input.motionPrompt}. ${input.style ?? "realistic"} style. Slow, ambient, cinematic.`
}

/**
 * Object asset-type enum — the kinds of variant a user can generate off an
 * object's anchor main image. Mirrors the literal accepted by
 * `POST /v1/generate-object-asset` (`backend/src/routes/generate-object-asset.ts`)
 * and consumed by the MCP `generate_object` verb (kind="asset").
 *
 * The `motion` value is reserved for type-system exhaustiveness on the
 * frontend; the route rejects it because motion variants flow through the
 * dedicated `/v1/generate-object-motion` endpoint (worker-side it's a different
 * BullMQ job type). `custom` is the free-form bucket — callers must supply
 * `attachToColumn` explicitly since the worker can't infer it.
 */
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
export interface ObjectMotionPromptInput {
  name: string
  category?: string
  style?: EntityStyle | string
  motionPrompt: string
  canonicalDescription?: string
  seedPromptHint?: string
}

/**
 * Build the prompt sent to the i2v provider for an object atmosphere/motion clip.
 *
 * Naming note: character's analog is `buildMotionPrompt`; location uses
 * `buildLocationMotionPrompt`; object uses `buildObjectMotionPrompt` to make
 * the entity type explicit at call sites.
 *
 * The `seedPromptHint` is appended verbatim — Phase C's route layer composes
 * wired-picker hints (Material/Animal/Vehicle/Weapon/Furniture) into this
 * field before passing the input. Empty hint = no-op (the trailing dot still
 * reads cleanly: "...motion. " not "...motion.  .").
 */
export function buildObjectMotionPrompt(input: ObjectMotionPromptInput): string {
  const objDesc =
    input.canonicalDescription?.trim() ||
    [input.category, input.name].filter(Boolean).join(", ").trim() ||
    "A generic object"
  const baseStyle = input.style ?? "realistic"
  const seedSuffix = input.seedPromptHint?.trim()
    ? `. ${input.seedPromptHint.trim()}`
    : ""
  return `${objDesc}. Motion: ${input.motionPrompt}. ${baseStyle} style. Smooth, controlled, product-showcase quality${seedSuffix}.`
}
