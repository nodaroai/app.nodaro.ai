import type { TtsProvider } from "./model-constants.js"

/**
 * A premade ElevenLabs voice as returned by `GET /v1/voices`.
 * Field names + types mirror the route verbatim: the route normalizes every
 * optional field to `""` (never null), so these are all non-null strings.
 */
export interface Voice {
  voice_id: string
  name: string
  preview_url: string
  gender: string
  accent: string
  age: string
  description: string
  use_case: string
  category: string
}

/**
 * A shared/community Voice Library entry (`GET /v1/voices/library`).
 * Same shape as {@link Voice} plus the TTS provider the voice is verified on.
 */
export interface SharedVoice extends Voice {
  /**
   * The best of our TTS providers whose underlying ElevenLabs model the
   * voice lists in `verified_languages` (v4 preferred when verified, then v3,
   * which renders any voice unmodified, then the cheapest v2 model: turbo
   * preferred, else multilingual). Only the base model id `eleven_v4` counts
   * toward v4; its `eleven_v4_…` variants do not. Models the deployment does
   * not offer are never recommended.
   * Clients without a provider picker should send it as the `provider` on
   * text-to-speech so generation uses a model the voice is actually verified
   * for — rendering a voice on an unverified model is what makes output drift
   * audibly from its preview. Absent when the entry has no model metadata, or
   * when none of the models it is verified for is offered by the deployment.
   */
  recommendedProvider?: TtsProvider
  /**
   * Every TTS provider the voice is verified on and the deployment offers
   * (subset of `elevenlabs-v4` / `elevenlabs-v3` / `elevenlabs-turbo` /
   * `elevenlabs-multilingual`, v4 first when present, then v3, turbo,
   * multilingual); absent whenever `recommendedProvider` is. Clients WITH a provider picker should only snap the
   * provider when the current choice is NOT in this set — most voices verify
   * more than one, and an explicit user choice within the set must win.
   */
  verifiedProviders?: TtsProvider[]
}

/** Query params for `GET /v1/voices/library`. All optional; sent as a querystring. */
export interface VoiceLibraryParams {
  search?: string
  gender?: string
  age?: string
  accent?: string
  language?: string
  category?: string
  use_cases?: string
  descriptives?: string
  featured?: boolean
  /** e.g. "trending" — passed through to the route. */
  sort?: string
  /** 0-based page; route default 0. */
  page?: number
  /** Route default 30, clamped to 1..100. */
  page_size?: number
}

/** `GET /v1/voices/library` response. */
export interface VoiceLibraryResponse {
  voices: SharedVoice[]
  hasMore: boolean
}

/**
 * A user voice clone. `GET /v1/voice-clones` returns the full shape; the create
 * response (`POST /v1/voice-clones/from-url`) returns only `id, name,
 * elevenlabsVoiceId, sampleAudioUrl, createdAt` (+ a credit-tracking `jobId`),
 * so the list-only fields are optional here. `elevenlabsVoiceId` is the id that
 * resolves the clone at text-to-speech time (use it as the selected voiceId).
 */
export interface VoiceClone {
  id: string
  name: string
  elevenlabsVoiceId: string
  sampleAudioUrl: string
  createdAt: string
  /** Present on the list response; absent on the create response. */
  description?: string | null
  previewUrl?: string | null
  gender?: string | null
  accent?: string | null
  updatedAt?: string
  /** Only on the create response (credit-tracking); never on the list. */
  jobId?: string
}
