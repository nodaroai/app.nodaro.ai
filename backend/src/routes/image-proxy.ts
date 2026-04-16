import type { FastifyInstance } from "fastify"
import { Readable } from "node:stream"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"

const proxyQuery = z.object({
  url: safeUrlSchema,
  download: z.string().optional(),
})

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
    // URL is validated by safeUrlSchema (blocks localhost, private IPs, non-http(s)).
    // Content-type is checked below (rejects non-images unless download mode).

    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) })
    if (!response.ok) {
      return reply.status(502).send({
        error: { code: "proxy_error", message: `Upstream returned ${response.status}` },
      })
    }

    const contentType = response.headers.get("content-type") ?? "image/png"
    const isDownload = parsed.data.download === '1'
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
