/**
 * Shared constants for social post nodes.
 *
 * Used by both the frontend DAG executor and backend orchestrator so input
 * routing + API validation agree on which node types are social posts and
 * on Instagram's carousel item limits.
 */

/** Node types that publish to a social platform via POST /v1/social/publish. */
export const SOCIAL_POST_NODE_TYPES = new Set([
  "instagram-post",
  "tiktok-post",
  "youtube-upload",
  "linkedin-post",
  "x-post",
  "facebook-post",
  "telegram-post",
])

/** Instagram carousel limits per Meta Graph API.
 *  Meta's documented limit is 10 items; sending >10 fails at container
 *  creation with "(#100) too little or too many attachments". */
export const INSTAGRAM_CAROUSEL_MIN_ITEMS = 2
export const INSTAGRAM_CAROUSEL_MAX_ITEMS = 10
