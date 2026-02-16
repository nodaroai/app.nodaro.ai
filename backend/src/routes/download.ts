import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { config } from "../lib/config.js"
import path from "path"

const downloadQuery = z.object({
  url: z.string().url(),
})

const ALLOWED_DOMAIN = "pub-c813076fe3024da78029786e7b9fd59d.r2.dev"

export async function downloadRoutes(app: FastifyInstance) {
  app.get("/v1/download", async (req, reply) => {
    const parsed = downloadQuery.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "Missing or invalid 'url' query parameter" },
      })
    }

    const { url } = parsed.data

    // Validate URL is from our R2 bucket
    const parsedUrl = new URL(url)
    const isAllowed =
      parsedUrl.hostname === ALLOWED_DOMAIN ||
      (config.R2_PUBLIC_URL && url.startsWith(config.R2_PUBLIC_URL))

    if (!isAllowed) {
      return reply.status(403).send({
        error: { code: "forbidden", message: "Only files from the R2 bucket can be downloaded" },
      })
    }

    const upstream = await fetch(url)
    if (!upstream.ok) {
      return reply.status(502).send({
        error: { code: "proxy_error", message: `Upstream returned ${upstream.status}` },
      })
    }

    const contentType = upstream.headers.get("content-type") ?? "application/octet-stream"
    const filename = path.basename(parsedUrl.pathname) || "download"
    const buffer = Buffer.from(await upstream.arrayBuffer())

    return reply
      .header("Content-Type", contentType)
      .header("Content-Disposition", `attachment; filename="${filename}"`)
      .header("Content-Length", buffer.length)
      .header("Cache-Control", "public, max-age=3600")
      .send(buffer)
  })
}
