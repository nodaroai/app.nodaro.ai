import type { FastifyInstance } from "fastify"
import { castSwapSpelling } from "../lib/video-remake-paths.js"
import { loadedEngineTakesQuality, withQualityTheEngineTakes } from "../lib/video-remake-quality.js"

/**
 * Video Remake's Quality choice (`quality: "full" | "economy"`, lib/video-remake-quality.ts) reaches the engine
 * only where the loaded engine takes it (`castSwap.quality`).
 *
 * An engine from before the choice knows `quality` as its older `"draft"` alone and refuses any other value, so a
 * caller that sends the choice to a deployment whose engine does not take it yet would be answered 400. Here the
 * value is taken out of the body first: the request is then the one of before the choice, which is exactly what
 * "economy" (the default) means, and a "full" there is made the only way that engine has. `quality: "draft"` is
 * never touched, nor any other value (the engine's own refusal), nor a body that names no `quality` (it reaches
 * the engine as the very object it arrived as).
 *
 * On the run, its estimate and its intent check (which takes the estimate's body), under both prefixes
 * (`/v1/video-remake*` and `/v1/cast-swap*`), before every route's own validation: so for every caller: REST, the
 * SDK, the CLI, and the platform's own internal requests (the MCP tools, the Video to Video quote), which all
 * arrive through these routes.
 */
const QUALITY_ROUTES: ReadonlySet<string> = new Set(["/v1/cast-swap", "/v1/cast-swap/estimate", "/v1/cast-swap/intent"])

export function registerVideoRemakeQualityHook(app: FastifyInstance): void {
  app.addHook("preValidation", async (req) => {
    if (req.method !== "POST" || !QUALITY_ROUTES.has(castSwapSpelling(req.routeOptions?.url ?? ""))) return
    const body = withQualityTheEngineTakes(req.body, loadedEngineTakesQuality())
    if (body !== req.body) req.body = body
  })
}
