import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { Readable } from "node:stream"
import { safeUrlSchema } from "../lib/url-validator.js"
import { safeFetch } from "../lib/safe-fetch.js"
import { config } from "../lib/config.js"
import path from "path"

const downloadQuery = z.object({
  url: safeUrlSchema,
})

// Extra allowed bucket host, configured via R2_PUBLIC_FALLBACK_DOMAIN (empty
// by default). The primary allowlist is the origin derived from R2_PUBLIC_URL
// below; this covers deployments that also serve assets from a raw bucket host.
const ALLOWED_DOMAIN = config.R2_PUBLIC_FALLBACK_DOMAIN

/**
 * Parse R2_PUBLIC_URL once at module load, cache its origin for constant-time
 * comparison. Previously used `url.startsWith(config.R2_PUBLIC_URL)` which is
 * a prefix-substring match: with `R2_PUBLIC_URL=https://assets.example.com` (no
 * trailing slash, as the env examples ship), an attacker URL
 * `https://assets.example.com.evil.com/payload` satisfied the check and the
 * public /v1/download route became a forced-attachment download proxy for
 * arbitrary external hosts — a phishing/malware delivery vector. Origin
 * comparison eliminates that class.
 */
const R2_PUBLIC_ORIGIN: string | null = (() => {
  if (!config.R2_PUBLIC_URL) return null
  try {
    return new URL(config.R2_PUBLIC_URL).origin
  } catch {
    return null
  }
})()

export async function downloadRoutes(app: FastifyInstance) {
  app.get("/v1/download", async (req, reply) => {
    const parsed = downloadQuery.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "Missing or invalid 'url' query parameter" },
      })
    }

    const { url } = parsed.data

    // Validate URL is from our configured asset storage. Compare parsed origin
    // (not string prefix) so a look-alike hostname like
    // `assets.example.com.evil.com` cannot satisfy the allowlist.
    const parsedUrl = new URL(url)
    const isAllowed =
      (ALLOWED_DOMAIN !== "" && parsedUrl.hostname === ALLOWED_DOMAIN) ||
      (R2_PUBLIC_ORIGIN !== null && parsedUrl.origin === R2_PUBLIC_ORIGIN)

    if (!isAllowed) {
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
