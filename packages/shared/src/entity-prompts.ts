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
] as const
export type CharacterAttachColumn = (typeof CHARACTER_ATTACH_COLUMNS)[number]

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
