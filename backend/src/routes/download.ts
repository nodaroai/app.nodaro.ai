import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { safeFetch } from "../lib/safe-fetch.js"
import { config } from "../lib/config.js"
import path from "path"

const downloadQuery = z.object({
  url: safeUrlSchema,
})

const ALLOWED_DOMAIN = "pub-c813076fe3024da78029786e7b9fd59d.r2.dev"

/**
 * Parse R2_PUBLIC_URL once at module load, cache its origin for constant-time
 * comparison. Previously used `url.startsWith(config.R2_PUBLIC_URL)` which is
 * a prefix-substring match: with `R2_PUBLIC_URL=https://assets.nodaro.ai` (no
 * trailing slash, as the env examples ship), an attacker URL
 * `https://assets.nodaro.ai.evil.com/payload` satisfied the check and the
 * public /v1/download route became a forced-attachment download proxy for
 * arbitrary external hosts under app.nodaro.ai — a phishing/malware
 * delivery vector. Origin comparison eliminates that class.
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

    // Validate URL is from our R2 bucket. Compare parsed origin (not string
    // prefix) so a look-alike hostname like `assets.nodaro.ai.evil.com`
    // cannot satisfy the allowlist under app.nodaro.ai.
    const parsedUrl = new URL(url)
    const isAllowed =
      parsedUrl.hostname === ALLOWED_DOMAIN ||
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
    const buffer = Buffer.from(await upstream.arrayBuffer())

    return reply
      .header("Content-Type", contentType)
      .header("Content-Disposition", `attachment; filename="${filename}"`)
      .header("Content-Length", buffer.length)
      .header("Cache-Control", "public, max-age=3600")
      .send(buffer)
  })
}
