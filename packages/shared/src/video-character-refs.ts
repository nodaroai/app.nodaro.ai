import { VIDEO_REF_LIMITS_BY_PROVIDER } from "./model-constants.js"
import type { GeminiOmniVoicePresetId } from "./gemini-omni-voices.js"

/**
 * Character references — the dedicated IDENTITY input of a video model, as
 * opposed to a loose reference image.
 *
 * Gemini Omni treats `image_urls` as "reference images for characters, scenes,
 * styles, or storyboard guidance": a portrait sent there steers the clip but
 * the face drifts. Its separate `character_ids` input is the one that keeps a
 * real person's face, and it takes ids minted from a portrait by a create
 * call. The PUBLIC shape below is provider-neutral — a portrait and a
 * description — and the provider layer mints (and caches) whatever ids its
 * upstream needs. Nothing upstream-shaped ever appears in the API.
 *
 * WHICH models take them is data, never a name list: a positive `characters`
 * cap on `VIDEO_REF_LIMITS_BY_PROVIDER`.
 */
export interface VideoCharacterVoice {
  /** The base voice — one of `GEMINI_OMNI_VOICE_PRESETS`. */
  preset: GeminiOmniVoicePresetId
  /** Free-text timbre / pace / emotion for the persona. Optional. */
  description?: string
  /** One example line the persona says (≤ 120 chars). Optional. */
  exampleLine?: string
}

export interface VideoCharacterReference {
  /** Portrait of the person (public URL). Index 0 of the upstream image set. */
  imageUrl: string
  /** Optional full-body image; costs a second input unit. */
  bodyImageUrl?: string
  /** Who this is: appearance, identity, style, clothing. Required by the upstream. */
  description: string
  /** Optional display name. */
  name?: string
  /**
   * Pin a voice persona to this character so it keeps ONE voice across clips
   * (the model otherwise improvises a voice per generation). Only models with a
   * positive `voices` cap take it.
   */
  voice?: VideoCharacterVoice
}

/** Zod `.max()` ceiling for the wire field — the widest cap any provider declares. */
export const VIDEO_CHARACTER_REFS_WIRE_MAX = Math.max(
  0,
  ...Object.values(VIDEO_REF_LIMITS_BY_PROVIDER).map((l) => l?.characters ?? 0),
)

/** Longest `description` / `name` a client may send (route Zod reads these). */
export const VIDEO_CHARACTER_DESCRIPTION_MAX = 2000
export const VIDEO_CHARACTER_NAME_MAX = 100
/** Longest voice `description` / `exampleLine` a client may send. The upstream
 *  allows far more description (20000); we cap the PUBLIC field at the same
 *  ceiling as a character description so policy text and prompts stay bounded. */
export const VIDEO_CHARACTER_VOICE_DESCRIPTION_MAX = 2000
export const VIDEO_CHARACTER_VOICE_EXAMPLE_MAX = 120

/** How many character references the provider takes; 0 = none (or unknown). */
export function videoCharacterRefCap(provider: string | undefined): number {
  return provider ? (VIDEO_REF_LIMITS_BY_PROVIDER[provider]?.characters ?? 0) : 0
}

/** How many DISTINCT voice personas the provider takes per request; 0 = none. */
export function videoCharacterVoiceCap(provider: string | undefined): number {
  return provider ? (VIDEO_REF_LIMITS_BY_PROVIDER[provider]?.voices ?? 0) : 0
}

/**
 * Identity of a voice persona — what makes two voices "the same voice". The
 * persona is minted per (preset, description, example line) AND the character's
 * name (the label it is created under), so the name is part of the identity:
 * this count must equal the number of personas the provider will actually mint,
 * or the cap would be checked against a different number than what ships.
 */
export function videoCharacterVoiceKey(ref: Pick<VideoCharacterReference, "voice" | "name">): string | null {
  const voice = ref.voice
  if (!voice) return null
  return JSON.stringify([voice.preset, voice.description?.trim() ?? "", voice.exampleLine?.trim() ?? "", ref.name?.trim() ?? ""])
}

/** How many distinct voice personas a set of references asks for. */
export function videoCharacterDistinctVoices(
  characterReferences: readonly Pick<VideoCharacterReference, "voice" | "name">[] | undefined,
): number {
  const keys = new Set<string>()
  for (const c of characterReferences ?? []) {
    const key = videoCharacterVoiceKey(c)
    if (key) keys.add(key)
  }
  return keys.size
}

/** Every provider that declares a character-reference cap, in declaration order. */
export function videoCharacterRefProviders(): string[] {
  return Object.entries(VIDEO_REF_LIMITS_BY_PROVIDER)
    .filter(([, l]) => (l?.characters ?? 0) > 0)
    .map(([id]) => id)
}

/**
 * Input units a set of character references draws from the provider's shared
 * input budget: 1 per character, 2 when a body image is supplied (the upstream
 * counts a dual-image character as two slots).
 */
export function videoCharacterRefUnits(
  characterReferences: readonly Pick<VideoCharacterReference, "bodyImageUrl">[] | undefined,
): number {
  let units = 0
  for (const c of characterReferences ?? []) units += c.bodyImageUrl ? 2 : 1
  return units
}

export interface VideoCharacterRefProblem {
  code:
    | "character_references_unsupported"
    | "character_references_over_limit"
    | "character_references_with_start_frame"
    | "character_references_with_end_frame"
    | "character_references_quota"
    | "character_voice_unsupported"
    | "character_voices_over_limit"
  message: string
}

/**
 * Voice-persona rule: the provider must take voices at all, and the DISTINCT
 * voices must fit its cap (Gemini Omni: 3 `audio_ids` per task). Two characters
 * with an identical voice AND name count once. `cap` overrides the provider's declared cap
 * (tests; a future model with a different limit declares it as data instead).
 */
export function videoCharacterVoiceProblem(args: {
  provider: string | undefined
  characterReferences: readonly VideoCharacterReference[] | undefined
  cap?: number
}): VideoCharacterRefProblem | null {
  const distinct = videoCharacterDistinctVoices(args.characterReferences)
  if (distinct === 0) return null
  const cap = args.cap ?? videoCharacterVoiceCap(args.provider)
  if (cap === 0) {
    return {
      code: "character_voice_unsupported",
      message:
        `A character voice is not supported by ${args.provider ?? "the selected model"}. ` +
        "Drop the voice, or pick a model that takes characterReferences.",
    }
  }
  if (distinct > cap) {
    return {
      code: "character_voices_over_limit",
      message: `${args.provider} accepts at most ${cap} distinct character voices per video; got ${distinct}. Give some characters the same voice, or drop some.`,
    }
  }
  return null
}

/**
 * The one validation both video routes (and the provider backstop) run. Returns
 * the first problem as a friendly 400 body, or null when the request is fine.
 *
 * The shared budget: for a model that declares `characters`, its `images` cap
 * IS the total input budget (images + 2×videos + character units ≤ images cap —
 * 7 for Gemini Omni). Callers pass the ASSEMBLED image count, after any
 * `connectedReferences` expansion, so the budget is measured on what ships.
 */
export function videoCharacterRefProblem(args: {
  provider: string | undefined
  characterReferences: readonly VideoCharacterReference[] | undefined
  /** Reference images that will ship (assembled, flat). */
  imageCount: number
  /** Source / reference videos that will ship. */
  videoCount: number
  /** True when the request carries a start frame (`imageUrl`). */
  hasStartFrame: boolean
  /** True when the request carries an end frame (`endFrameUrl`). */
  hasEndFrame?: boolean
}): VideoCharacterRefProblem | null {
  const { provider, characterReferences } = args
  if (!characterReferences || characterReferences.length === 0) return null

  const cap = videoCharacterRefCap(provider)
  if (cap === 0) {
    return {
      code: "character_references_unsupported",
      message:
        `characterReferences is not supported by ${provider ?? "the selected model"}. ` +
        `Models that take them: ${videoCharacterRefProviders().join(", ")}. ` +
        "Otherwise send the portrait as a reference image instead.",
    }
  }
  if (characterReferences.length > cap) {
    return {
      code: "character_references_over_limit",
      message: `${provider} accepts at most ${cap} character references; got ${characterReferences.length}.`,
    }
  }
  // A NODARO limit, not an upstream exclusivity: Gemini Omni's start frame is
  // sent as the first entry of `image_urls` (never as `first_frame_url`), so
  // the upstream would take it beside `character_ids`. We reject the pair
  // because the frame / identity roles are not yet bound in the prompt
  // (and the frame would need to be budgeted against the shared input quota).
  if (args.hasStartFrame) {
    return {
      code: "character_references_with_start_frame",
      message:
        `${provider} does not yet support combining characterReferences with a start frame (imageUrl) — ` +
        "the frame and the characters would compete for the same input slots without a defined role. " +
        "Drop the start frame (the character's portrait carries the face), or drop characterReferences.",
    }
  }
  // Gemini Omni has no end-frame input; without this the frame would be dropped
  // silently once characters make a frame-less request look "referenced".
  if (args.hasEndFrame) {
    return {
      code: "character_references_with_end_frame",
      message:
        `${provider} does not use an end frame (endFrameUrl) together with characterReferences. ` +
        "Drop the end frame, or drop characterReferences.",
    }
  }
  const budget = VIDEO_REF_LIMITS_BY_PROVIDER[provider as string]?.images ?? 7
  const used = args.imageCount + args.videoCount * 2 + videoCharacterRefUnits(characterReferences)
  if (used > budget) {
    return {
      code: "character_references_quota",
      message:
        `${provider} takes at most ${budget} input units: reference images count 1, each reference video 2, ` +
        `each character 1 (2 with a body image). This request uses ${used}. Remove some reference images or characters.`,
    }
  }
  return videoCharacterVoiceProblem({ provider, characterReferences })
}
