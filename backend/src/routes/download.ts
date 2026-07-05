import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { Readable } from "node:stream"
import { safeUrlSchema } from "../lib/url-validator.js"
import { safeFetch } from "../lib/safe-fetch.js"
import { config } from "../lib/config.js"
import { isOurCdnUrl } from "../lib/cdn-host.js"
import path from "path"

const downloadQuery = z.object({
  url: safeUrlSchema,
})

export async function downloadRoutes(app: FastifyInstance) {
  app.get("/v1/download", async (req, reply) => {
    const parsed = downloadQuery.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "Missing or invalid 'url' query parameter" },
      })
    }

    const { url } = parsed.data

    // Validate URL is from our configured asset storage via the shared
    // allowlist (cdn-host.ts) — exact-origin/exact-host equality (not prefix,
    // not substring) so a look-alike hostname like `assets.example.com.evil.com`
    // cannot satisfy it.
    const parsedUrl = new URL(url)
    if (!isOurCdnUrl(url, config.R2_PUBLIC_URL, config.R2_PUBLIC_FALLBACK_DOMAIN)) {
      return reply.status(403).send({
        error: { code: "forbidden", message: "Only files from the R2 bucket can be downloaded" },
      })
    }

    // safeFetch: defense-in-depth. The origin allowlist above is the
    // primary gate (only our R2 bucket reaches this line), but routing the
    // fetch through safeFetch rules out any future regression where the
    // allowlist loosens or an attacker finds a bypass — DNS resolution to
    // private IPs is rejected at connect time regardless.
    let upstream: Response
    try {
      upstream = await safeFetch(url, { timeoutMs: 120_000 })
    } catch (error) {
      req.log.warn({ err: error, url }, "[download] upstream fetch failed")
      return reply.status(502).send({
        error: { code: "proxy_error", message: "Failed to fetch upstream file" },
      })
    }

    if (!upstream.ok) {
      return reply.status(502).send({
        error: { code: "proxy_error", message: `Upstream returned ${upstream.status}` },
      })
    }

    const contentType = upstream.headers.get("content-type") ?? "application/octet-stream"
    const filename = path.basename(parsedUrl.pathname) || "download"

    if (!upstream.body) {
      return reply.status(502).send({
        error: { code: "proxy_error", message: "Upstream returned no body" },
      })
    }

    // Stream the body straight through instead of buffering the whole object
    // into a single Buffer. This route is PUBLIC + unauthenticated and R2
    // objects can be up to 500MB (the video upload cap), so the old
    // `Buffer.from(await upstream.arrayBuffer())` let a handful of concurrent
    // requests exhaust the single-process heap and OOM-kill the API for every
    // tenant. Piping keeps per-request memory bounded. Mirrors image-proxy.ts.
    const contentLength = upstream.headers.get("content-length")
    reply.raw.writeHead(200, {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "public, max-age=3600",
      ...(contentLength ? { "Content-Length": contentLength } : {}),
    })
    const nodeStream = Readable.fromWeb(upstream.body as import("stream/web").ReadableStream)
    nodeStream.pipe(reply.raw)
    return reply
  })
}
