/**
 * Publish action vocabulary — shared by the immediate-publish route and the
 * scheduled-posts CRUD so the two never drift.
 */

export const VALID_ACTIONS = [
  "post-image", "post-reel", "post-story", "post-carousel",
  "post-video", "upload-video", "upload-short",
  "post-text", "post-tweet",
  "send-message", "send-photo", "send-video", "send-audio", "send-media-group",
] as const

export type PublishAction = (typeof VALID_ACTIONS)[number]

export const MEDIA_REQUIRED_ACTIONS: ReadonlySet<string> = new Set([
  "post-image", "post-reel", "post-story", "post-carousel",
  "post-video", "upload-video", "upload-short",
  "send-photo", "send-video", "send-audio", "send-media-group",
])

/**
 * Actions whose `mediaUrl` is a photo. On a network that declares a photo byte
 * limit (`SocialProvider.photoMaxBytes`), these photos and every `"photo"`
 * media item are fitted under it before the publish call (`photo-fit.ts`).
 */
export const PHOTO_URL_ACTIONS: ReadonlySet<string> = new Set(["post-image", "send-photo"])
