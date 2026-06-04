/**
 * HeyGen provider — normalized FE-facing shapes and raw API response shapes.
 *
 * Normalized types are what the catalog functions return and what routes expose.
 * Raw types represent the actual HeyGen API JSON fields (snake_case).
 */

// ---------------------------------------------------------------------------
// Normalized types (camelCase, FE-facing)
// ---------------------------------------------------------------------------

/** A single photo-avatar look from /v3/avatars/looks (filtered to avatar_type="photo_avatar"). */
export interface HeygenAvatar {
  avatarId: string
  groupId?: string
  name: string
  gender: string
  previewImageUrl: string
  defaultVoiceId?: string
  preferredOrientation?: string
}

/** A single voice from /v2/voices. */
export interface HeygenVoice {
  voiceId: string
  name: string
  language: string
  gender: string
  previewAudio: string
  supportPause: boolean
  emotionSupport: boolean
  supportLocale: boolean
}

// ---------------------------------------------------------------------------
// Raw API types (snake_case, internal only)
// ---------------------------------------------------------------------------

/** Single look from /v3/avatars/looks response `data` array. */
export interface RawHeygenAvatarLook {
  id: string
  group_id?: string
  avatar_type: string
  name: string
  gender: string
  preview_image_url: string
  default_voice_id?: string
  preferred_orientation?: string
  image_width?: number
  image_height?: number
}

/** GET /v3/avatars/looks response shape. */
export interface RawAvatarsLooksResponse {
  code: number
  message: string
  data: RawHeygenAvatarLook[]
}

/** Single voice from /v2/voices response `voices` array. */
export interface RawHeygenVoice {
  voice_id: string
  name: string
  language: string
  gender: string
  /** Preview audio URL. Note: field is `preview_audio`, NOT `preview_audio_url`. */
  preview_audio: string
  support_pause: boolean
  emotion_support: boolean
  support_interactive_avatar?: boolean
  support_locale?: boolean
}

/** GET /v2/voices response shape. */
export interface RawVoicesResponse {
  code: number
  message: string
  data: {
    voices: RawHeygenVoice[]
  }
}

/** POST /v3/videos response data when successful. */
export interface RawCreateVideoResponse {
  code: number
  message: string
  data: {
    video_id: string
    status: string
    output_format?: string
  }
}

/** GET /v1/video_status.get?video_id=... response data. */
export interface RawVideoStatusData {
  id: string
  status: "waiting" | "processing" | "completed" | "failed"
  video_url?: string
  thumbnail_url?: string
  caption_url?: string
  gif_url?: string
  /** Fractional seconds (e.g. 3.05633). Only present when status = "completed". */
  duration?: number
  error?: string
  callback_id?: string
  created_at?: string
}

/** GET /v1/video_status.get response shape. */
export interface RawVideoStatusResponse {
  code: number
  message: string
  data: RawVideoStatusData
}

/** HeyGen error body shape (sometimes returned with HTTP 200). */
export interface RawHeygenErrorBody {
  error?: {
    code?: string
    message?: string
  }
  code?: number
  message?: string
}
