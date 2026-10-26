import type { FastifyInstance } from "fastify"
import { castSwapEngineFrom } from "@nodaro/shared/models"

/**
 * A Nodaro Motion run or quote (`POST /v1/cast-swap`, `POST
 * /v1/cast-swap/estimate`, both served by the Cast Swap engine of the cloud
 * plugin) naming its engine in any vocabulary — the public ids
 * (`"motion-prism"`, `"motion-pulse"`), the earlier ones (`"motion-pro"`,
 * `"motion-lite"`) or the internal ones — reaches the engine as the INTERNAL
 * id (`castSwapEngineFrom`), the one every engine version takes.
 *
 * So a REST, SDK or CLI caller may send the current public ids whatever
 * plugin the environment pins: a plugin up to 0.397.0 refuses
 * `"motion-prism"` / `"motion-pulse"`, and the platform's own sends (MCP,
 * trends) already use the internal ids. A value that names no engine is left
 * as it is, for the engine's own refusal. Before every route's own hooks and
 * handler, as the retired-video-provider rewrite is.
 */
const ENGINE_ROUTES: ReadonlySet<string> = new Set(["/v1/cast-swap", "/v1/cast-swap/estimate"])

export function registerNodaroMotionEngineHook(app: FastifyInstance): void {
  app.addHook("preValidation", async (req) => {
    if (req.method !== "POST" || !ENGINE_ROUTES.has(req.routeOptions?.url ?? "")) return
    const body = req.body
    if (!body || typeof body !== "object" || Array.isArray(body)) return
    const named = (body as { engine?: unknown }).engine
    const internal = castSwapEngineFrom(named)
    if (internal !== undefined && internal !== named) req.body = { ...(body as Record<string, unknown>), engine: internal }
  })
}
