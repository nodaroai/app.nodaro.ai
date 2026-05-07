/**
 * OG Meta Tags — serves minimal HTML with Open Graph tags for social sharing.
 * Called by Caddy when a bot user-agent requests /app/:slug.
 */

import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { getStaticPublicAppUrl } from "../lib/allowed-origins.js"

const slugParams = z.object({ slug: z.string().min(1) })

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

export async function ogTagsRoutes(app: FastifyInstance) {
  app.get("/og/app/:slug", { config: { skipAuth: true } }, async (req, reply) => {
    const parsed = slugParams.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send("Invalid slug")
    }

    const { slug } = parsed.data

    // Fetch app metadata (latest version)
    const { data: appRow } = await supabase
      .from("published_apps")
      .select("name, description, icon_url, workflow_id, snapshot_nodes, thumbnail_node_id")
      .eq("slug", slug)
      .is("deleted_at", null)
      .order("version", { ascending: false })
      .limit(1)
      .single()

    if (!appRow) {
      // Fallback to generic OG tags
      return reply
        .header("Content-Type", "text/html; charset=utf-8")
        .send(buildHtml({ slug, title: "Nodaro App", description: "AI-powered app on Nodaro.ai" }))
    }

    // TODO(oss): make site name + tagline configurable via SITE_NAME / SITE_TAGLINE env vars
    const title = (appRow.name as string) || "Nodaro App"
    const description = (appRow.description as string) || "AI-powered app on Nodaro.ai"

    // Resolve preview image: icon_url > thumbnail node > first image/video node output
    let imageUrl = appRow.icon_url as string | null
    if (!imageUrl) {
      const nodes = (appRow.snapshot_nodes ?? []) as Array<{ id: string; type?: string; data?: Record<string, unknown> }>
      const thumbNodeId = appRow.thumbnail_node_id as string | null

      // Try thumbnail node first
      if (thumbNodeId) {
        const thumbNode = nodes.find((n) => n.id === thumbNodeId)
        if (thumbNode?.data) {
          imageUrl = extractMediaUrl(thumbNode.data)
        }
      }

      // Fallback: first node with a media result
      if (!imageUrl) {
        for (const n of nodes) {
          if (n.data) {
            const url = extractMediaUrl(n.data)
            if (url) { imageUrl = url; break }
          }
        }
      }
    }

    return reply
      .header("Content-Type", "text/html; charset=utf-8")
      .header("Cache-Control", "public, max-age=3600, s-maxage=3600")
      .send(buildHtml({ slug, title, description, imageUrl }))
  })
}

function extractMediaUrl(data: Record<string, unknown>): string | null {
  // Check common result fields
  const results = data.results as Array<{ url?: string }> | undefined
  if (results?.[0]?.url) return results[0].url
  const url = (data.imageUrl ?? data.videoUrl ?? data.audioUrl ?? data.url) as string | undefined
  return url || null
}

function buildHtml(opts: { slug: string; title: string; description: string; imageUrl?: string | null }): string {
  const appUrl = `${getStaticPublicAppUrl()}/app/${escapeHtml(opts.slug)}`
  const title = escapeHtml(opts.title)
  const description = escapeHtml(opts.description)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${title} — Nodaro.ai</title>
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:url" content="${appUrl}" />
  <meta property="og:site_name" content="Nodaro.ai" />
  ${opts.imageUrl ? `<meta property="og:image" content="${escapeHtml(opts.imageUrl)}" />` : ""}
  <meta name="twitter:card" content="${opts.imageUrl ? "summary_large_image" : "summary"}" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${description}" />
  ${opts.imageUrl ? `<meta name="twitter:image" content="${escapeHtml(opts.imageUrl)}" />` : ""}
  <meta http-equiv="refresh" content="0;url=${appUrl}" />
</head>
<body>
  <p>Redirecting to <a href="${appUrl}">${title}</a>...</p>
</body>
</html>`
}
