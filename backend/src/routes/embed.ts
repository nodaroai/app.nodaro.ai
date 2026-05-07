/**
 * Embed route — serves iframe-friendly HTML page for published apps.
 * GET /v1/embed/:slug — Returns HTML redirect to frontend embed route with CSP headers
 */

import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { getStaticPublicAppUrl } from "../lib/allowed-origins.js"

const slugParams = z.object({
  slug: z.string().min(1),
})

export async function embedRoutes(app: FastifyInstance) {
  app.get("/v1/embed/:slug", async (req, reply) => {
    const parsed = slugParams.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send("Invalid slug")
    }

    const { slug } = parsed.data

    // Look up app to get allowed_origins for CSP
    const { data: appRow, error } = await supabase
      .from("published_apps")
      .select("id, slug, is_embeddable, allowed_origins")
      .eq("slug", slug)
      .eq("is_active", true)
      .is("deleted_at", null)
      .single()

    if (error || !appRow) {
      return reply.status(404).send("App not found")
    }

    if (!appRow.is_embeddable) {
      return reply.status(403).send("This app does not allow embedding")
    }

    // Embedding requires a domain allowlist — reject if none configured
    const origins = (appRow.allowed_origins as string[]) ?? []
    if (origins.length === 0) {
      return reply.status(403).send("Embedding requires an allowed domains list. Configure allowed domains in your app settings.")
    }

    // Build frame-ancestors CSP directive
    const frameAncestors = origins.join(" ")

    // Determine the frontend URL
    const appUrl = getStaticPublicAppUrl()
    const theme = (req.query as Record<string, string>).theme ?? "dark"
    const embedUrl = `${appUrl}/embed/${encodeURIComponent(slug)}?theme=${encodeURIComponent(theme)}`

    // Set CSP headers — allow framing from specified origins
    reply.header("Content-Security-Policy", `frame-ancestors ${frameAncestors}`)
    // Remove X-Frame-Options to allow embedding (Fastify may set DENY by default)
    reply.removeHeader("X-Frame-Options")
    reply.header("Content-Type", "text/html; charset=utf-8")

    return reply.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="0;url=${embedUrl}">
  <title>Loading...</title>
  <style>body{margin:0;background:#121212;display:flex;align-items:center;justify-content:center;height:100vh;font-family:system-ui}
  .loader{width:32px;height:32px;border:3px solid #333;border-top-color:#ff0073;border-radius:50%;animation:spin 0.8s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}</style>
</head>
<body>
  <div class="loader"></div>
  <script>window.location.replace("${embedUrl}")</script>
</body>
</html>`)
  })
}
