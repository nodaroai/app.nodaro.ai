import type { FastifyInstance } from "fastify"
import { Readable } from "node:stream"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { safeFetch } from "../lib/safe-fetch.js"
import { config } from "../lib/config.js"
import { isOurCdnUrl } from "../lib/cdn-host.js"
import { isRestrictedAddress } from "../lib/content-restrictions.js"
import { CONTENT_RESTRICTED_BODY } from "./download.js"

const proxyQuery = z.object({
  url: safeUrlSchema,
  download: z.string().optional(),
  /** `video`: stream a video instead of an image (Meta Ad Library creatives —
   *  the CDN blocks direct cross-origin loads, same as its images). Forwards
   *  the browser's Range request so the player can seek, and passes the
   *  upstream 206 / Content-Range straight through. */
  media: z.enum(["video"]).optional(),
})

/** Response headers a ranged video reply must carry for the browser player to seek. */
const RANGE_HEADERS = ["content-range", "accept-ranges"] as const

function sanitizeFilename(rawUrl: string): string {
  const pathname = new URL(rawUrl).pathname
  const decoded = decodeURIComponent(pathname.split("/").pop() ?? "file")
  return decoded.replace(/["\r\n\\]/g, "_")
}

function isBlockedUpstreamUrlError(error: unknown): boolean {
  return error instanceof Error && (
    error.message.startsWith("safeFetch: blocked") ||
    error.message.includes("private/reserved IP")
  )
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
    const isVideo = parsed.data.media === "video"

    // Restrict download mode to Nodaro media. Without this, any user can pass
    // ?url=<arbitrary>&download=1 and the route emits a forced attachment of
    // ANY content type from app.nodaro.ai — an open download proxy. The
    // non-download path remains permissive (it still requires safeUrlSchema +
    // image content-type, used legitimately for cached avatar/OG previews).
    if (isDownload && !isOurCdnUrl(url, config.R2_PUBLIC_URL, config.R2_PUBLIC_FALLBACK_DOMAIN)) {
      return reply.status(403).send({
        error: { code: "forbidden", message: "Download mode is restricted to Nodaro media URLs" },
      })
    }

    // One of our own files an administrator restricted after a complaint is
    // not served in any mode (lib/content-restrictions.ts); another host's
    // address is not ours to restrict.
    if (await isRestrictedAddress(url)) return reply.status(451).send(CONTENT_RESTRICTED_BODY)

    // Two-layer SSRF defense: safeUrlSchema rejects syntactic red flags at
    // request boundary; safeFetch rejects DNS resolutions to private IP ranges
    // at connect time (catches hostnames that resolve to internal targets).
    // Content-type is checked below (rejects non-images unless download mode).
    // A video player fetches in ranges; forward the browser's Range header so
    // the upstream answers 206 for exactly the bytes the player wants.
    const range = isVideo && typeof req.headers.range === "string" ? req.headers.range : undefined
    let response: Response
    try {
      response = await safeFetch(url, { timeoutMs: 120_000, ...(range ? { headers: { range } } : {}) })
    } catch (error) {
      req.log.warn({ err: error, url }, "[image-proxy] upstream fetch failed")
      if (isBlockedUpstreamUrlError(error)) {
        return reply.status(400).send({
          error: { code: "validation_error", message: "URL resolves to a blocked address" },
        })
      }
      return reply.status(502).send({
        error: { code: "proxy_error", message: "Failed to fetch upstream URL" },
      })
    }

    if (!response.ok) {
      return reply.status(502).send({
        error: { code: "proxy_error", message: `Upstream returned ${response.status}` },
      })
    }

    // Another host's address may have redirected to one of our own files: the
    // address the bytes came from is held to the same restriction.
    if (response.url && response.url !== url && (await isRestrictedAddress(response.url))) {
      return reply.status(451).send(CONTENT_RESTRICTED_BODY)
    }

    const contentType = response.headers.get("content-type") ?? (isVideo ? "video/mp4" : "image/png")
    if (!isDownload && isVideo && !contentType.startsWith("video/")) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "URL does not point to a video" },
      })
    }
    if (!isDownload && !isVideo && !contentType.startsWith("image/")) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "URL does not point to an image" },
      })
    }

    const disposition = isDownload
      ? { "Content-Disposition": `attachment; filename="${sanitizeFilename(url)}"` }
      : {}
    // An SVG is a document that can carry script, and this answer comes from
    // the app's own origin: opened directly it would run there. Sandboxed and
    // never sniffed, it still draws in an <img> (an image ignores both).
    const svgHeaders = /^image\/svg\+xml\b/i.test(contentType)
      ? { "Content-Security-Policy": "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'", "X-Content-Type-Options": "nosniff" }
      : {}

    // Stream response directly without buffering in memory. A ranged video
    // reply keeps the upstream's 206 + Content-Range so the player can seek;
    // signed CDN video urls expire, so they are cached briefly, not forever.
    const contentLength = response.headers.get("content-length")
    const rangeHeaders = isVideo
      ? Object.fromEntries(RANGE_HEADERS.flatMap((h) => { const v = response.headers.get(h); return v ? [[h, v]] : [] }))
      : {}
    reply.raw.writeHead(isVideo && response.status === 206 ? 206 : 200, {
      "Content-Type": contentType,
      "Cache-Control": isVideo ? "public, max-age=3600" : "public, max-age=31536000, immutable",
      "Access-Control-Allow-Origin": req.headers.origin ?? "*",
      ...(contentLength ? { "Content-Length": contentLength } : {}),
      ...rangeHeaders,
      ...disposition,
      ...svgHeaders,
    })
    const nodeStream = Readable.fromWeb(response.body as import("stream/web").ReadableStream)
    nodeStream.pipe(reply.raw)
    return reply
  })
}
