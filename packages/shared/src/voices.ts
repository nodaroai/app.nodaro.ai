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
 * Identical in shape to {@link Voice} as the route maps it today.
 */
export type SharedVoice = Voice

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
