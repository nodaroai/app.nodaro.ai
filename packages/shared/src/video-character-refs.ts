import { VIDEO_REF_LIMITS_BY_PROVIDER } from "./model-constants.js"
import type { ConnectedReference } from "./types.js"
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
  /**
   * More views of the same person, after the portrait and body image. Read by
   * models whose subject takes several images (Kling 4.0: 2-4 per subject, the
   * portrait first); ignored elsewhere. At most
   * {@link VIDEO_CHARACTER_EXTRA_IMAGES_MAX}.
   */
  extraImageUrls?: string[]
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
  /**
   * A short single-shot clip of this character (public URL). On a model with a
   * positive `videoCharacters` cap (Kling 4.0, Kling 4.0 Flash) the character
   * becomes a VIDEO subject made from this clip instead of an image subject.
   * The clip rides as one more reference video ({@link seatCharacterVideos}),
   * so it is measured, capped and priced exactly as a reference video is; its
   * own length must fit `VIDEO_CHARACTER_CLIP_DURATION_LIMITS`. Any other model
   * refuses it.
   */
  videoUrl?: string
}

/** Zod `.max()` ceiling for the wire field — the widest cap any provider declares. */
export const VIDEO_CHARACTER_REFS_WIRE_MAX = Math.max(
  0,
  ...Object.values(VIDEO_REF_LIMITS_BY_PROVIDER).map((l) => l?.characters ?? 0),
)

/** Most `extraImageUrls` a character reference may carry (Kling 4.0's subject takes 4 images: the portrait + 3). */
export const VIDEO_CHARACTER_EXTRA_IMAGES_MAX = 3

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

/** How many characters may be VIDEO subjects (a `videoUrl` clip) on the provider; 0 = none. */
export function videoCharacterVideoCap(provider: string | undefined): number {
  return provider ? (VIDEO_REF_LIMITS_BY_PROVIDER[provider]?.videoCharacters ?? 0) : 0
}

/** Every provider that takes video subjects, in declaration order. */
export function videoCharacterVideoProviders(): string[] {
  return Object.entries(VIDEO_REF_LIMITS_BY_PROVIDER)
    .filter(([, l]) => (l?.videoCharacters ?? 0) > 0)
    .map(([id]) => id)
}

/** The clips a set of character references carries (`videoUrl`, trimmed, non-empty), in order. */
export function characterVideoUrls(
  characterReferences: readonly unknown[] | undefined,
): string[] {
  const out: string[] = []
  for (const c of characterReferences ?? []) {
    const url = (c as { videoUrl?: unknown } | null | undefined)?.videoUrl
    if (typeof url === "string" && url.trim()) out.push(url.trim())
  }
  return out
}

/** A refusal from {@link seatCharacterVideos}: a finished, user-facing sentence. */
export interface CharacterVideoSeatProblem {
  code: "character_video_unsupported" | "character_videos_over_limit" | "character_video_shared" | "reference_videos_over_limit"
  message: string
}

/**
 * The reference-video list a run sends once its characters' clips are seated
 * in it — the ONE rule both video routes (a precheck, before the duration
 * check, the quote and any reservation) and the workflow run (the payload
 * builder) apply, so a video subject's clip is measured, capped, priced, held
 * and settled exactly as a reference video is (KIE bills video subjects as
 * reference-video seconds, summed). The provider runner then takes the seat
 * back out of the reference videos and sends it as the character's subject.
 *
 * - No clip: the list as it came (the same value).
 * - A clip already in the list (also wired as a plain reference video) keeps
 *   its seat, and becomes the subject only; any other is appended, in
 *   character order, after the reference videos.
 * - Refused: a model that takes no video subjects; more clips than its
 *   `videoCharacters` cap; two characters with the same clip; reference
 *   videos plus clips over its `videos` cap (the provider counts both in one
 *   cap, and a clip past it would be neither measured nor sent).
 * - On a model that takes video subjects (one shared cap), plain reference
 *   videos alone over that cap are refused too, instead of the extra ones
 *   being left out without a word (decided 2026-11-13). Any other model's
 *   list is not judged here.
 */
export function seatCharacterVideos(args: {
  provider: string | undefined
  referenceVideoUrls: readonly unknown[] | undefined
  characterReferences: readonly unknown[] | undefined
}):
  | { ok: true; referenceVideoUrls: readonly unknown[] | undefined }
  | ({ ok: false } & CharacterVideoSeatProblem) {
  const clips = characterVideoUrls(args.characterReferences)
  const provider = args.provider ?? "the selected model"
  const cap = videoCharacterVideoCap(args.provider)
  const videosCap = VIDEO_REF_LIMITS_BY_PROVIDER[args.provider as string]?.videos ?? 0
  const overVideos = (count: number): { ok: false } & CharacterVideoSeatProblem => ({
    ok: false,
    code: "reference_videos_over_limit",
    message:
      `${provider} takes at most ${videosCap} videos in all — reference videos and characters made from a video together. ` +
      `This run has ${count}. Remove a reference video${clips.length > 0 ? ", or the video from a character" : ""}.`,
  })
  if (clips.length === 0) {
    const sent = (args.referenceVideoUrls ?? []).length
    if (cap > 0 && sent > videosCap) return overVideos(sent)
    return { ok: true, referenceVideoUrls: args.referenceVideoUrls }
  }
  if (cap === 0) {
    const takers = videoCharacterVideoProviders()
    return {
      ok: false,
      code: "character_video_unsupported",
      message:
        `A character video (characterReferences[].videoUrl) is not supported by ${provider}. ` +
        `Models that take one: ${takers.join(", ")}. Otherwise drop the video and keep the character's images.`,
    }
  }
  if (clips.length > cap) {
    return {
      ok: false,
      code: "character_videos_over_limit",
      message: `${provider} takes at most ${cap} characters made from a video; ${clips.length} characters carry one. Remove the video from some of them.`,
    }
  }
  if (new Set(clips).size < clips.length) {
    return {
      ok: false,
      code: "character_video_shared",
      message: "Two characters carry the same video. Each character made from a video needs a clip of its own.",
    }
  }
  // The list as sent stays as it is (an entry the route's schema would refuse
  // is still there for it to refuse); the clips follow it.
  const raw = args.referenceVideoUrls ?? []
  const seated: unknown[] = [...raw, ...clips.filter((c) => !raw.includes(c))]
  if (seated.length > videosCap) return overVideos(seated.length)
  return { ok: true, referenceVideoUrls: seated }
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
  /** Reference audio clips that will ship (counted by a `materials` budget). */
  audioCount?: number
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
  // A provider that counts every material against ONE budget (Kling 4.0: 15
  // images + videos + subjects + voices) takes characters beside a start frame
  // (the frame joins the reference images) — the Gemini Omni unit rules below
  // do not apply to it. Where audio rides on the characters as their voices
  // (`audioBindsToCharacters`, Kling 4.0 Flash), a clip takes no seat.
  const limits = VIDEO_REF_LIMITS_BY_PROVIDER[provider as string]
  const materials = limits?.materials
  if (materials !== undefined) {
    const audioSeats = limits?.audioBindsToCharacters ? 0 : (args.audioCount ?? 0)
    const used =
      args.imageCount + (args.hasStartFrame ? 1 : 0) + args.videoCount + characterReferences.length + audioSeats
    if (used > materials) {
      return {
        code: "character_references_quota",
        message:
          `${provider} takes at most ${materials} materials in all — reference images (a start frame counts as one), ` +
          `reference videos, characters${limits?.audioBindsToCharacters ? "" : " and voices"}. This request uses ${used}. Remove some.`,
      }
    }
    return videoCharacterVoiceProblem({ provider, characterReferences })
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

/**
 * One provider-neutral character reference per wired Character node, for a
 * model that takes wired characters as NAMED SUBJECTS (catalog feature
 * `character-subjects`, Kling 4.0). Input: the wired-character entries both
 * engines already expand (`expandWiredCharacterRefs` server-side, the editor's
 * twin) — the canonical portrait and every variant, grouped here by character.
 * The portrait leads; up to {@link VIDEO_CHARACTER_EXTRA_IMAGES_MAX} more views
 * follow in expansion order. The name is the character's own; the description
 * its canonical description, else its description. A character with a single
 * image still yields a reference — the provider decides (Kling keeps it a
 * reference image).
 */
export function characterReferencesFromWired(
  refs: readonly ConnectedReference[],
  /**
   * The clip each wired character carries, by its slug (`wiredCharacterVideoUrls`):
   * pass it only for a model that takes video subjects. Absent = none.
   */
  videoBySlug?: ReadonlyMap<string, string>,
): VideoCharacterReference[] {
  const bySlug = new Map<string, { name: string; description?: string; urls: string[]; videoUrl?: string }>()
  for (const r of refs) {
    if (r.source !== "wired-character" || !r.characterSlug || !r.url) continue
    let entry = bySlug.get(r.characterSlug)
    if (!entry) {
      const videoUrl = videoBySlug?.get(r.characterSlug)
      entry = { name: r.defaultName.split(" / ")[0]!.trim() || r.characterSlug, urls: [], ...(videoUrl ? { videoUrl } : {}) }
      bySlug.set(r.characterSlug, entry)
    }
    const description = (r.characterCanonicalDescription ?? r.description)?.trim()
    if (!entry.description && description) entry.description = description
    if (entry.urls.includes(r.url)) continue
    // The canonical portrait leads whatever order the variants arrived in.
    if (!r.variantSlug) entry.urls.unshift(r.url)
    else entry.urls.push(r.url)
  }
  return [...bySlug.values()].map((c) => ({
    imageUrl: c.urls[0]!,
    ...(c.urls.length > 1 ? { extraImageUrls: c.urls.slice(1, 1 + VIDEO_CHARACTER_EXTRA_IMAGES_MAX) } : {}),
    description: (c.description ?? c.name).slice(0, VIDEO_CHARACTER_DESCRIPTION_MAX),
    name: c.name.slice(0, VIDEO_CHARACTER_NAME_MAX),
    ...(c.videoUrl ? { videoUrl: c.videoUrl } : {}),
  }))
}
