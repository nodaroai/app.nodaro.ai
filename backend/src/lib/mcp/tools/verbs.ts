import { registerImageVerbs, type RegisterOpts } from "./verbs-image.js"
import { registerVideoVerbs } from "./verbs-video.js"
import { registerAudioVerbs } from "./verbs-audio.js"
import { registerCloVerbs } from "./verbs-clo.js"

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
 * Notes on omissions:
 *  - `swap_face` is intentionally NOT registered because the underlying
 *    `/v1/swap-face` route does not exist in the codebase. v1.2+ may revisit.
 */
export function registerVerbs(opts: RegisterVerbsOpts): void {
  registerImageVerbs(opts)
  registerVideoVerbs(opts)
  registerAudioVerbs(opts)
  registerCloVerbs(opts)
}
