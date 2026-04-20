import type { FastifyInstance } from "fastify"
import { Readable } from "node:stream"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { safeFetch } from "../lib/safe-fetch.js"
import { config } from "../lib/config.js"

const proxyQuery = z.object({
  url: safeUrlSchema,
  download: z.string().optional(),
})

// Mirrors the allow-list in routes/download.ts. Only Nodaro-hosted media may
// be served with Content-Disposition: attachment, so the route can't be used
// as a phishing/malware download proxy under app.nodaro.ai.
const ALLOWED_DOMAIN = "pub-c813076fe3024da78029786e7b9fd59d.r2.dev"

// Parsed origin of R2_PUBLIC_URL, cached once. Origin (protocol+host+port)
// comparison replaces the previous `rawUrl.startsWith(config.R2_PUBLIC_URL)`
// check — which, with the env example value `https://assets.nodaro.ai` (no
// trailing slash), allowed look-alike hostnames like
// `assets.nodaro.ai.evil.com` to pass the allowlist.
const R2_PUBLIC_ORIGIN: string | null = (() => {
  if (!config.R2_PUBLIC_URL) return null
  try {
    return new URL(config.R2_PUBLIC_URL).origin
  } catch {
    return null
  }
})()

function isAllowedDownloadHost(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl)
    if (parsed.hostname === ALLOWED_DOMAIN) return true
    if (R2_PUBLIC_ORIGIN !== null && parsed.origin === R2_PUBLIC_ORIGIN) return true
    return false
  } catch {
    return false
  }
}

function sanitizeFilename(rawUrl: string): string {
  const pathname = new URL(rawUrl).pathname
  const decoded = decodeURIComponent(pathname.split("/").pop() ?? "file")
  return decoded.replace(/["\r\n\\]/g, "_")
}

export async function imageProxyRoutes(app: FastifyInstance) {
  app.get("/v1/image-proxy", async (req, reply) => {
    const parsed = proxyQuery.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "Missing or invalid 'url' query parameter" },
      })
    }

    const { url } = parsed.data
    const isDownload = parsed.data.download === '1'

    // Restrict download mode to Nodaro media. Without this, any user can pass
    // ?url=<arbitrary>&download=1 and the route emits a forced attachment of
    // ANY content type from app.nodaro.ai — an open download proxy. The
    // non-download path remains permissive (it still requires safeUrlSchema +
    // image content-type, used legitimately for cached avatar/OG previews).
    if (isDownload && !isAllowedDownloadHost(url)) {
      return reply.status(403).send({
        error: { code: "forbidden", message: "Download mode is restricted to Nodaro media URLs" },
      })
    }

    // Two-layer SSRF defense: safeUrlSchema rejects syntactic red flags at
    // request boundary; safeFetch rejects DNS resolutions to private IP ranges
    // at connect time (catches hostnames that resolve to internal targets).
    // Content-type is checked below (rejects non-images unless download mode).
    const response = await safeFetch(url, { timeoutMs: 120_000 })
    if (!response.ok) {
      return reply.status(502).send({
        error: { code: "proxy_error", message: `Upstream returned ${response.status}` },
      })
    }

    const contentType = response.headers.get("content-type") ?? "image/png"
    if (!isDownload && !contentType.startsWith("image/")) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "URL does not point to an image" },
      })
    }

    const disposition = isDownload
      ? { "Content-Disposition": `attachment; filename="${sanitizeFilename(url)}"` }
      : {}

    // Stream response directly without buffering in memory
    const contentLength = response.headers.get("content-length")
    reply.raw.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "Access-Control-Allow-Origin": req.headers.origin ?? "*",
      ...(contentLength ? { "Content-Length": contentLength } : {}),
      ...disposition,
    })
    const nodeStream = Readable.fromWeb(response.body as import("stream/web").ReadableStream)
    nodeStream.pipe(reply.raw)
    return reply
  })
}
