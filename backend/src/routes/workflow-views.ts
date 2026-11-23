/**
 * A workflow's view link, the public side (decided 2026-11-23):
 *
 *   GET /v1/workflow-views/:token          the canvas, read-only (the view page and its embed draw it)
 *   GET /v1/workflow-views/:token/export   the downloadable copy the owner saved, as a file
 *   GET /og/view/:token                    the link's preview card: the HTML the bundled proxy
 *                                          serves to link-preview readers and search engines
 *                                          asking for `/view/<token>` (frontend/Caddyfile)
 *
 * PUBLIC: the 43-character token is the credential. A link that is unknown,
 * turned off, whose workflow changed hands, of a blocked account, or on a
 * deployment that does not allow public work answers 404 and says nothing
 * else. Every answer comes from the public projection
 * (lib/workflow-view/project.ts) — the canvas, the card and the copy alike —
 * and nothing branches on who asks, the owner included.
 *
 * The JSON and the file are never kept by a cache (turning the link off takes
 * effect at once); the card is kept five minutes at most, like a share card.
 * The robots rule is the owner's switch (`indexable`): the card says it in its
 * page and its header, and the JSON tells the page, which says it too.
 */
import type { FastifyInstance, FastifyReply } from "fastify"
import { getStaticPublicAppUrl } from "../lib/allowed-origins.js"
import { sendInternalError } from "../lib/http-errors.js"
import { surfaceAllowsPublicOutputs } from "../lib/surface-profile.js"
import { publicReadLimit } from "../lib/share-links/public-gate.js"
import { withCardImage } from "../lib/share-links/card.js"
import { renderedCardImage } from "../lib/share-links/card-image/service.js"
import { CARD_IMAGE_HEIGHT, CARD_IMAGE_TYPE, CARD_IMAGE_WIDTH } from "../lib/share-links/card-image/plan.js"
import { viewLinksTablePresent } from "../lib/workflow-view/table.js"
import { ViewLinksUnavailableError, exportStateOf, readLiveViewLink, readViewExport, type LiveViewLink } from "../lib/workflow-view/store.js"
import { projectWorkflowView } from "../lib/workflow-view/project.js"
import { readViewCard, viewCardKeyToken } from "../lib/workflow-view/card-content.js"
import { viewCardHtml, viewCardNotFoundHtml, type RenderedViewCard } from "../lib/workflow-view/card.js"
import { viewTokenParams } from "../lib/workflow-view/schemas.js"
import "./workflow-views-docs.js"

/** How long a cache may keep a card: a link turned off stops previewing within this. */
export const VIEW_CARD_MAX_AGE_SECONDS = 300
/** A card whose own picture is not rendered yet: readers come back for the better one soon. */
export const VIEW_CARD_PENDING_MAX_AGE_SECONDS = 60

/** The brand's card (frontend/public/share-card.jpg): the picture of a card with none of its own yet. */
const DEFAULT_IMAGE_PATH = "/share-card.jpg"

/** The JSON and the file: never cached, never indexed themselves (the card is what a search engine reads). */
function publicHeaders(reply: FastifyReply): void {
  reply.header("Cache-Control", "no-store")
  reply.header("X-Robots-Tag", "noindex")
}

function notFound(reply: FastifyReply) {
  return reply.status(404).send({ error: { code: "not_found", message: "Link not found" } })
}

function notAvailable(reply: FastifyReply) {
  return reply.status(503).send({ error: { code: "not_available", message: "View links are not available on this server yet." } })
}

type Lookup = { kind: "live"; live: LiveViewLink } | { kind: "missing" } | { kind: "unavailable" }

/** The live link a public request names. */
async function lookup(token: unknown): Promise<Lookup> {
  const params = viewTokenParams.safeParse({ token })
  // A deployment that does not allow public work has no public links (lib/surface-profile.ts).
  if (!params.success || !surfaceAllowsPublicOutputs()) return { kind: "missing" }
  if (!viewLinksTablePresent()) return { kind: "unavailable" }
  try {
    const live = await readLiveViewLink(params.data.token)
    return live ? { kind: "live", live } : { kind: "missing" }
  } catch (err) {
    if (err instanceof ViewLinksUnavailableError) return { kind: "unavailable" }
    throw err
  }
}

/** A file name a download may carry: the workflow's name, plain. */
function fileNameOf(name: string): string {
  const plain = name.normalize("NFKD").replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "-").slice(0, 80)
  return `${plain || "workflow"}.nodaro.json`
}

function sendCard(reply: FastifyReply, status: 200 | 404, card: RenderedViewCard, opts: { indexable: boolean; maxAge: number }) {
  return reply
    .status(status)
    .header("Content-Type", "text/html; charset=utf-8")
    .header("Cache-Control", status === 200 ? `public, max-age=${opts.maxAge}` : "no-store")
    .header("X-Robots-Tag", status === 200 && opts.indexable ? "all" : "noindex")
    .header("Content-Security-Policy", card.csp)
    .send(card.html)
}

export async function workflowViewRoutes(app: FastifyInstance) {
  app.get("/v1/workflow-views/:token", { config: publicReadLimit(60) }, async (req, reply) => {
    try {
      const found = await lookup((req.params as { token?: unknown }).token)
      if (found.kind === "unavailable") {
        publicHeaders(reply)
        return notAvailable(reply)
      }
      if (found.kind === "missing") {
        publicHeaders(reply)
        return notFound(reply)
      }
      const { link, workflow } = found.live
      publicHeaders(reply)
      const projection = await projectWorkflowView({ nodes: workflow.nodes, edges: workflow.edges, settings: workflow.settings, ownerId: workflow.user_id })
      return reply.send({
        name: workflow.name,
        nodes: projection.nodes,
        edges: projection.edges,
        indexable: link.indexable,
        export: exportStateOf(link),
      })
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to read the view link")
    }
  })

  app.get("/v1/workflow-views/:token/export", { config: publicReadLimit(20) }, async (req, reply) => {
    try {
      publicHeaders(reply)
      const found = await lookup((req.params as { token?: unknown }).token)
      if (found.kind === "unavailable") return notAvailable(reply)
      if (found.kind === "missing") return notFound(reply)
      const copy = await readViewExport(found.live.link.token)
      if (!copy) return notFound(reply)
      return reply
        .header("Content-Type", "application/json; charset=utf-8")
        .header("Content-Disposition", `attachment; filename="${fileNameOf(copy.name)}"`)
        .send(JSON.stringify(copy.snapshot, null, 2))
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to read the downloadable copy")
    }
  })

  app.get("/og/view/:token", { config: publicReadLimit(120) }, async (req, reply) => {
    try {
      const found = await lookup((req.params as { token?: unknown }).token)
      if (found.kind !== "live") return sendCard(reply, 404, viewCardNotFoundHtml(), { indexable: false, maxAge: 0 })
      const { link } = found.live
      const { content, text } = await readViewCard(found.live)
      const rendered = content.picture ? await renderedCardImage(viewCardKeyToken(link.token), content.picture) : null
      const platform = getStaticPublicAppUrl().replace(/\/+$/, "")
      const card = viewCardHtml(
        rendered ? withCardImage(content, rendered) : content,
        {
          cardUrl: `${platform}/view/${encodeURIComponent(link.token)}`,
          defaultImage: { url: `${platform}${DEFAULT_IMAGE_PATH}`, width: CARD_IMAGE_WIDTH, height: CARD_IMAGE_HEIGHT, type: CARD_IMAGE_TYPE },
          indexable: link.indexable,
        },
        text,
      )
      const maxAge = rendered || !content.picture ? VIEW_CARD_MAX_AGE_SECONDS : VIEW_CARD_PENDING_MAX_AGE_SECONDS
      return sendCard(reply, 200, card, { indexable: link.indexable, maxAge })
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to read the view link")
    }
  })
}
