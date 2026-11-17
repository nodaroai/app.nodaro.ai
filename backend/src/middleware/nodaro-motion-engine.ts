import type { FastifyInstance } from "fastify"
import { castSwapEngineFrom } from "@nodaro/shared/models"
import { castSwapSpelling } from "../lib/video-remake-paths.js"

/**
 * A Video Remake run or quote (`POST /v1/video-remake`, `POST
 * /v1/video-remake/estimate`, or the same under `/v1/cast-swap`, all served by the Cast Swap engine of the cloud
 * plugin) naming its engine in any vocabulary — the public ids
 * (`"nodaro-prism"`, `"nodaro-pulse"`), the earlier ones (`"motion-prism"`,
 * `"motion-pulse"`, `"motion-pro"`, `"motion-lite"`) or the internal ones —
 * reaches the engine as the INTERNAL id (`castSwapEngineFrom`), the one every
 * engine version takes.
 *
 * So a REST, SDK or CLI caller may send the current public ids whatever
 * plugin the environment pins: an engine from before a rename refuses the ids
 * that came after it, and the platform's own sends (MCP, trends) already use
 * the internal ids. A value that names no engine is left
 * as it is, for the engine's own refusal. Before every route's own hooks and
 * handler, as the retired-video-provider rewrite is.
 */
const ENGINE_ROUTES: ReadonlySet<string> = new Set(["/v1/cast-swap", "/v1/cast-swap/estimate"])

export function registerNodaroMotionEngineHook(app: FastifyInstance): void {
  app.addHook("preValidation", async (req) => {
    if (req.method !== "POST" || !ENGINE_ROUTES.has(castSwapSpelling(req.routeOptions?.url ?? ""))) return
    const body = req.body
    if (!body || typeof body !== "object" || Array.isArray(body)) return
    const named = (body as { engine?: unknown }).engine
    const internal = castSwapEngineFrom(named)
    if (internal !== undefined && internal !== named) req.body = { ...(body as Record<string, unknown>), engine: internal }
  })
}
