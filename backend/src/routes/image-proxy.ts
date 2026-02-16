import type { FastifyInstance } from "fastify"
import { Readable } from "node:stream"
import { z } from "zod"
import { config } from "../lib/config.js"

const proxyQuery = z.object({
  url: z.string().url(),
})

export async function imageProxyRoutes(app: FastifyInstance) {
  app.get("/v1/image-proxy", async (req, reply) => {
    const parsed = proxyQuery.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "Missing or invalid 'url' query parameter" },
      })
    }

    const { url } = parsed.data

    // Only proxy images from our own R2 bucket
    if (config.R2_PUBLIC_URL && !url.startsWith(config.R2_PUBLIC_URL)) {
      return reply.status(403).send({
        error: { code: "forbidden", message: "Only R2 bucket images can be proxied" },
      })
    }

    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) })
    if (!response.ok) {
      return reply.status(502).send({
        error: { code: "proxy_error", message: `Upstream returned ${response.status}` },
      })
    }

    const contentType = response.headers.get("content-type") ?? "image/png"
    if (!contentType.startsWith("image/")) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "URL does not point to an image" },
      })
    }

    // Stream response directly without buffering in memory
    const contentLength = response.headers.get("content-length")
    reply.raw.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "Access-Control-Allow-Origin": "*",
      ...(contentLength ? { "Content-Length": contentLength } : {}),
    })
    const nodeStream = Readable.fromWeb(response.body as import("stream/web").ReadableStream)
    nodeStream.pipe(reply.raw)
    return reply
  })
}
