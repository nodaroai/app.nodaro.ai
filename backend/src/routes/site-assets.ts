import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { siteAssetArchiveEnabled } from "../lib/site-asset-archive.js"
import { siteAssetKey, siteAssetType } from "../lib/site-asset-keys.js"
import { streamR2Object } from "../lib/storage.js"

/** Everything under the prefix: a path of another shape is a 404 of the same kind, not Fastify's own. */
const params = z.object({ "*": z.string() })

const NOT_FOUND = { error: { code: "not_found", message: "No such file." } }

/**
 * A styling file an earlier deployment served, from the archive of past
 * builds (`lib/site-asset-archive.ts`). The Caddyfile's `/assets/*` handle
 * sends here every name the running build does not have (`/assets/<name>` →
 * `/v1/site-assets/assets/<name>`), so the file keeps its original URL.
 * Public, like the file itself, and readable from any origin: a session
 * replay player draws the page from its own. A name the archive does not
 * hold is a 404 nobody caches, never the app's HTML; the type always comes
 * from the name, never from the request or the stored object.
 */
export async function siteAssetRoutes(app: FastifyInstance) {
  app.get<{ Params: { "*": string } }>(
    "/v1/site-assets/*",
    // Past the CDN, which keeps every file it is given: only first fetches and misses arrive here.
    { config: { rateLimit: { max: 600, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const parsed = params.safeParse(req.params)
      const path = parsed.success ? parsed.data["*"] : ""
      const name = path.startsWith("assets/") ? path.slice("assets/".length) : ""
      const type = siteAssetType(name)
      const file = type && siteAssetArchiveEnabled() ? await streamR2Object(siteAssetKey(name)) : null
      if (!type || !file) return reply.status(404).header("Cache-Control", "no-store").send(NOT_FOUND)
      reply
        .header("Cache-Control", "public, max-age=31536000, immutable")
        .header("Access-Control-Allow-Origin", "*")
        .header("X-Content-Type-Options", "nosniff")
        .header("Content-Type", type)
      if (file.contentLength !== null) reply.header("Content-Length", String(file.contentLength))
      // A probe reads the headers only: stop the object's download instead of draining it.
      if (req.method === "HEAD") {
        file.body.destroy()
        return reply.send()
      }
      return reply.send(file.body)
    },
  )
}
