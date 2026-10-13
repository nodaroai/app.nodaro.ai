/**
 * The REST route that runs one node type on its own: `POST /v1/<type>` by
 * convention, or the route listed here.
 *
 * Part of the public API contract: `@nodaro/sdk`'s `nodes.run(type)` posts to
 * the route this resolves, and the platform's workflow engine calls the same
 * routes for the node types it runs over HTTP, so the two cannot disagree.
 */
import { SOCIAL_POST_NODE_TYPES } from "./social-post.js"

const SOCIAL_PUBLISH_ROUTE = "/v1/social/publish"

/** Node types whose run route is NOT `POST /v1/<type>`. */
export const NODE_RUN_ROUTES: Readonly<Record<string, string>> = Object.freeze({
  "generate-3d-scene": "/v1/3d-scene/generate",
  "edit-3d-scene": "/v1/3d-scene/edit",
  "ai-writer": "/v1/ai-writer/generate",
  "llm-chat": "/v1/llm-chat/generate",
  "video-composer": "/v1/scene-graph/generate",
  "after-effects": "/v1/after-effects/generate",
  "lottie-overlay": "/v1/lottie-overlay/generate",
  "3d-title": "/v1/3d-title/generate",
  "motion-graphics": "/v1/motion-graphics/generate",
  "image-to-text": "/v1/image-to-text/describe",
  "telegram-channel-feed": "/v1/telegram-channel/fetch",
  "suno-generate": "/v1/suno/generate",
  "suno-cover": "/v1/suno/cover",
  "suno-extend": "/v1/suno/extend",
  "suno-lyrics": "/v1/suno/lyrics",
  "suno-separate": "/v1/suno/separate",
  "suno-music-video": "/v1/suno/music-video",
  "suno-mashup": "/v1/suno/mashup",
  "suno-replace-section": "/v1/suno/replace-section",
  "suno-style-boost": "/v1/suno/style-boost",
  "suno-add-instrumental": "/v1/suno/add-instrumental",
  "suno-add-vocals": "/v1/suno/add-vocals",
  "suno-convert-wav": "/v1/suno/convert-wav",
  "suno-upload-extend": "/v1/suno/upload-extend",
  "suno-voice": "/v1/suno/voice/generate",
  // The UGC nodes' routes, served by the Nodaro Cloud plugin.
  "ugc-creator": "/v1/ugc/creator",
  "ugc-script": "/v1/ugc/script",
  "ugc-clips": "/v1/ugc/clips",
  "ugc-clip": "/v1/ugc/clip",
  "ugc-cards": "/v1/ugc/cards",
  // Every social post node publishes through the one route; the body's
  // `platform` says where (SOCIAL_POST_NODE_PLATFORM).
  ...Object.fromEntries([...SOCIAL_POST_NODE_TYPES].map((type) => [type, SOCIAL_PUBLISH_ROUTE])),
})

/**
 * Node types with no route that runs them on their own, each with what to run
 * instead. They run inside the editor or a workflow, or through a sibling
 * route that takes a differently shaped body.
 */
export const NODE_TYPES_WITHOUT_RUN_ROUTE: Readonly<Record<string, string>> = Object.freeze({
  "modify-image": 'run "image-to-image" instead (or "edit-image" for the nano-banana-edit provider)',
  "upscale-image": 'run "edit-image" with an upscale provider instead (e.g. provider "recraft-upscale")',
  "remove-background": 'run "edit-image" with provider "recraft-remove-bg" instead',
  "image-to-video": 'run "generate-video" with a start frame instead',
  composite: "it runs only as part of a workflow (client.workflows.run)",
  "manual-edit": "it opens the in-browser editor and runs only inside a workflow",
  "paint-mask": "it is painted in the editor and never runs; use its mask output inside a workflow",
  scene: "it is run by the pipeline orchestrator (client.pipelines)",
  "generative-pipeline": "it is run by the pipeline orchestrator (client.pipelines)",
})

/**
 * The route that runs `type` on its own, or null when it has none (see
 * {@link NODE_TYPES_WITHOUT_RUN_ROUTE} for what to run instead).
 */
export function nodeRunRoute(type: string): string | null {
  if (Object.prototype.hasOwnProperty.call(NODE_TYPES_WITHOUT_RUN_ROUTE, type)) return null
  if (Object.prototype.hasOwnProperty.call(NODE_RUN_ROUTES, type)) return NODE_RUN_ROUTES[type]!
  return `/v1/${encodeURIComponent(type)}`
}
