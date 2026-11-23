import type { FastifyInstance } from "fastify"
import { castSwapEngineFrom, videoRemakeFlashEngineFrom } from "@nodaro/shared/models"
import { castSwapSpelling } from "../lib/video-remake-paths.js"
import { FLASH_NOT_OFFERED, flashChoiceOffered, flashNotOfferedMessage } from "../lib/video-remake-flash.js"

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
 *
 * A FLASH CHOICE (`"nodaro-prism-flash"`, `"nodaro-pulse-flash"`, 2026-11-22)
 * is never rewritten (the base engine's internal id would silently drop it):
 * it reaches the engine as it is while this deployment offers it
 * (`flashChoiceOffered`: the engine declares it AND the admin's Offer Flash is
 * on for its engine), and is refused here otherwise, 409 `flash_not_offered`,
 * before anything is read or held — the same refusal the engine gives, so an
 * engine from before Flash never answers a vaguer one.
 */
const ENGINE_ROUTES: ReadonlySet<string> = new Set(["/v1/cast-swap", "/v1/cast-swap/estimate"])

export function registerNodaroMotionEngineHook(app: FastifyInstance): void {
  app.addHook("preValidation", async (req, reply) => {
    if (req.method !== "POST" || !ENGINE_ROUTES.has(castSwapSpelling(req.routeOptions?.url ?? ""))) return
    const body = req.body
    if (!body || typeof body !== "object" || Array.isArray(body)) return
    const named = (body as { engine?: unknown }).engine
    const flash = videoRemakeFlashEngineFrom(named)
    if (flash !== undefined) {
      if (await flashChoiceOffered(flash)) return
      return reply.status(409).send({ error: { code: FLASH_NOT_OFFERED, message: flashNotOfferedMessage(flash) } })
    }
    const internal = castSwapEngineFrom(named)
    if (internal !== undefined && internal !== named) req.body = { ...(body as Record<string, unknown>), engine: internal }
  })
}
