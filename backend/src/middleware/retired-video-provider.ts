import type { FastifyInstance } from "fastify"
import { canonicalVideoProvider } from "@nodaro/shared/models"

/**
 * A request naming a retired video model (`RETIRED_VIDEO_PROVIDERS`, e.g.
 * `seedance` → `seedance-2-mini`) runs as the model it became. The body's
 * `provider` is rewritten before every route's own hooks and handler, so the
 * credit guard (which reads the raw body), the route's Zod and the job all see
 * the id that runs: priced, validated and dispatched as one model. Saved app
 * runs, SDK / CLI callers and older clients that still send the old id keep
 * working without a second list of aliases in each route.
 *
 * A webhook trigger (`POST /v1/webhooks/:token`) is left alone: its body is
 * someone else's payload, handed to the workflow as data, not a request to us.
 */
const PASS_THROUGH_PREFIXES = ["/v1/webhooks/"] as const

export function registerRetiredVideoProviderHook(app: FastifyInstance): void {
  app.addHook("preValidation", async (req) => {
    const route = req.routeOptions?.url ?? req.url
    if (PASS_THROUGH_PREFIXES.some((prefix) => route.startsWith(prefix))) return
    const body = req.body
    if (!body || typeof body !== "object" || Array.isArray(body)) return
    const provider = (body as { provider?: unknown }).provider
    const runsAs = canonicalVideoProvider(provider)
    if (runsAs !== provider) req.body = { ...(body as Record<string, unknown>), provider: runsAs }
  })
}
