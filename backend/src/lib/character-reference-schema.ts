import { z } from "zod"
import { safeUrlSchema } from "./url-validator.js"
import {
  VIDEO_CHARACTER_REFS_WIRE_MAX,
  VIDEO_CHARACTER_DESCRIPTION_MAX,
  VIDEO_CHARACTER_NAME_MAX,
  VIDEO_CHARACTER_VOICE_DESCRIPTION_MAX,
  VIDEO_CHARACTER_VOICE_EXAMPLE_MAX,
  GEMINI_OMNI_VOICE_PRESET_IDS,
} from "@nodaro/shared"

/**
 * Route-level Zod schema for `@nodaro/shared`'s `VideoCharacterReference` — the
 * provider-neutral wire shape of a character (identity) reference on the video
 * routes. Shared by `/v1/generate-video` and `/v1/text-to-video` so the two can
 * never disagree.
 *
 * SSRF parity: both image URLs ride `safeUrlSchema` (the same syntactic gate as
 * `referenceImageUrls`). The provider hands them to the upstream, which fetches
 * them itself — we never fetch them.
 *
 * WHICH models accept a character reference is NOT decided here: the array is
 * capped at the widest provider cap on the wire, and `videoCharacterRefProblem`
 * (shared, reading `VIDEO_REF_LIMITS_BY_PROVIDER`) gates the per-model rules.
 */
/**
 * A pinned voice persona: one of the documented preset voices plus optional
 * free-text character. Strict — an unknown key is a client mistake, never
 * silently dropped. WHICH models take a voice is `videoCharacterVoiceProblem`
 * (shared), not this schema.
 */
export const characterVoiceSchema = z
  .object({
    preset: z.enum(GEMINI_OMNI_VOICE_PRESET_IDS),
    description: z.string().trim().min(1).max(VIDEO_CHARACTER_VOICE_DESCRIPTION_MAX).optional(),
    exampleLine: z.string().trim().min(1).max(VIDEO_CHARACTER_VOICE_EXAMPLE_MAX).optional(),
  })
  .strict()

export const characterReferenceSchema = z.object({
  /** Portrait of the person (public URL). */
  imageUrl: safeUrlSchema,
  /** Optional full-body image; costs a second input unit on the provider. */
  bodyImageUrl: safeUrlSchema.optional(),
  /** Who this is — appearance, identity, clothing. Required by the upstream. */
  description: z.string().trim().min(1).max(VIDEO_CHARACTER_DESCRIPTION_MAX),
  /** Optional display name. */
  name: z.string().trim().min(1).max(VIDEO_CHARACTER_NAME_MAX).optional(),
  /** Pin a voice persona so the character keeps one voice across clips. */
  voice: characterVoiceSchema.optional(),
})

export const characterReferencesSchema = z.array(characterReferenceSchema).max(VIDEO_CHARACTER_REFS_WIRE_MAX)
