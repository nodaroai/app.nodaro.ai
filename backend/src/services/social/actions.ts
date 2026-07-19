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
