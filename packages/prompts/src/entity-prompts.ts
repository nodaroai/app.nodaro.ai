import { EntityStyle, PLACEHOLDER_CHARACTER_NAME } from "@nodaro/shared"

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

export interface CreaturePromptInput {
  name: string
  description?: string
  /** Free-text species/type (e.g. "dragon", "wolf") — the creature delta vs object. */
  species?: string
  category?: string
  style?: EntityStyle | string
}

/**
 * Creature establishing-shot prompt. Mirrors {@link buildObjectPrompt} but leads
 * with the free-text `species` (a dragon/wolf/etc. IS the subject) and frames the
 * subject as a living creature rather than a product. Falls back to "creature"
 * when no species is given so the prompt always names a subject.
 */
export function buildCreaturePrompt(input: CreaturePromptInput): string {
  const subject = input.species?.trim() || "creature"
  const descPart = input.description ? `, ${input.description}` : ""
  const styleDesc = input.style ?? "realistic"
  return [
    `Single ${subject}, ${input.name}${descPart},`,
    `${styleDesc} art style, full body, front view,`,
    "4k, highly detailed, plain background, no text, no labels, no watermarks.",
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

export interface LocationRefinePromptInput {
  /**
   * The user's TRANSIENT edit/refine instruction (e.g. "make it night, add
   * drifting fog"). Used only to build this one generation's prompt - it is
   * never written back to the location row, so the stored name / description /
   * canonical description stay untouched. This is the deliberate contrast with
   * `LocationPromptInput.description`, which IS the persisted scene description
   * that `buildLocationPrompt` weaves in.
   */
  editPrompt: string
  style?: EntityStyle | string
}

/**
 * Build a TRANSIENT prompt from a user-supplied edit/refine instruction.
 *
 * Used by `POST /v1/generate-location` when the caller passes `userPrompt`
 * (the studio's "describe changes" / sparkle Edit flow). Paired with an i2i
 * `sourceImageUrl` the provider edits the source establishing shot toward the
 * instruction; with no source image it reads as a from-scratch custom scene
 * prompt. Mirrors `characters.generate`'s seed/edit-prompt path, but locations
 * have no stored seed prompt - this output is purely transient and the route
 * persists nothing derived from it back to the row.
 */
export function buildLocationRefinePrompt(input: LocationRefinePromptInput): string {
  const instruction = input.editPrompt.trim()
  const styleDesc = input.style ?? "realistic"
  return [
    `${instruction},`,
    `${styleDesc} art style, wide establishing shot,`,
    "4k, highly detailed, cinematic lighting, no text, no labels, no watermarks.",
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
