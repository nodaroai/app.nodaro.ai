import { registerImageVerbs, type RegisterOpts } from "./verbs-image.js"
import { registerVideoVerbs } from "./verbs-video.js"
import { registerAudioVerbs } from "./verbs-audio.js"
import { registerCloVerbs } from "./verbs-clo.js"
import { registerShotSequenceVerbs } from "./verbs-shot-sequence.js"
import { registerShotShapeTools } from "./shot-shapes.js"
import { registerVideoDirectorTool } from "./video-director.js"
import { registerVideoDirectorTools } from "./video-director-tools.js"
import { registerRecipeTool } from "./recipes.js"
import { hasCredits } from "../../config.js"

export type RegisterVerbsOpts = RegisterOpts

/**
 * Register all v1.1 generation verb tools on the given MCP server.
 *
 * Verbs are split by media kind across `verbs-image.ts`, `verbs-video.ts`,
 * `verbs-audio.ts`, and `verbs-clo.ts` (character/location/object) so that
 * each file stays under ~500 lines. Every verb follows the canonical pattern
 * established by `generate_image`:
 *
 *  1. Parse arguments via the SDK's raw-shape `inputSchema`.
 *  2. Resolve `*_asset_id` to URLs via {@link resolveAssetId} when applicable.
 *  3. Compose Path-1 structured fields onto the free-text prompt where the
 *     route accepts a `prompt`.
 *  4. Hit the existing `/v1/...` route via `fastify.inject()` with the
 *     internal-orchestrator-secret header so the auth middleware accepts
 *     `userId` from the body.
 *  5. Tag the job with `mcp_client` so trigger badges + admin views show
 *     which connector originated the work.
 *  6. Return a JSON-RPC tool result whose `_meta.task_id` carries the job id
 *     for v1.2 progress streaming and for the client to poll via `tasks/get`.
 *
 */
export function registerVerbs(opts: RegisterVerbsOpts): void {
  registerImageVerbs(opts)
  registerVideoVerbs(opts)
  registerAudioVerbs(opts)
  registerCloVerbs(opts)
  registerShotSequenceVerbs(opts)
  // list_shot_shapes / get_shot_shape: pure catalog discovery — no scope gate,
  // no side effects. Same posture as list_models / get_node_skill. Ungated so
  // the blueprint catalog is discoverable regardless of session scopes.
  registerShotShapeTools(opts.server, opts.session)
  // start_video_director: pure content delivery (motion-director doctrine),
  // no side effects — registered unconditionally on all editions so the
  // skill is universally discoverable. The actions it instructs the LLM to
  // take (generate_speech, render_shot_sequence, etc.) are scope-gated by
  // their own tools, so no capability leak from omitting a gate here.
  registerVideoDirectorTool(opts.server, opts.session)
  // get_recipe: pure content delivery (multi-step content recipe catalog),
  // no side effects — registered unconditionally on all editions, same
  // posture as start_video_director / get_node_skill. The actions a recipe
  // instructs the LLM to take are scope-gated by their own tools.
  registerRecipeTool(opts.server, opts.session)
  // create_explainer / create_launch_video: dispatch to the director worker
  // (author → speech → align → render). The worker is Cloud-only (started
  // in server.ts only when hasCredits()), so register these tools only on
  // Cloud — they would hang at pending on community/business editions.
  if (hasCredits()) {
    registerVideoDirectorTools(opts)
  }
}
