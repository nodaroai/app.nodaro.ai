/**
 * The share card (lib/share-links/card.ts): `GET /og/s/:token`, the HTML a
 * share link's own address answers. The address people share is
 * `${SHARE_SITE_ORIGIN}/s/<token>`; that site forwards it, for every client, to
 * this server's `/s/<token>`, which the bundled proxy hands to this route
 * (frontend/Caddyfile). Social networks and chats read its tags for a preview,
 * and people are sent on to the share page, `${SHARE_SITE_ORIGIN}/shared/<token>`.
 *
 * PUBLIC, like the link's JSON reads (routes/shares.ts), on the same gate: a
 * link that is unknown, turned off, whose item is gone or may not be shown, of
 * a blocked account, or on a deployment that does not allow public work, is a
 * 404 page that says nothing about any content. A card is kept by caches for
 * five minutes at most, so a link turned off stops previewing within minutes.
 */
import type { FastifyInstance, FastifyReply } from "fastify"
import { config } from "../lib/config.js"
import { getStaticPublicAppUrl } from "../lib/allowed-origins.js"
import { sendInternalError } from "../lib/http-errors.js"
import { surfaceAllowsPublicOutputs } from "../lib/surface-profile.js"
import { publicShareParams } from "../lib/share-links/schemas.js"
import { findShownShare, publicReadLimit } from "../lib/share-links/public-gate.js"
import { readShareCardContent } from "../lib/share-links/card-reads.js"
import { shareCardHtml, shareCardNotFoundHtml, shareSiteOriginOf, type RenderedCard } from "../lib/share-links/card.js"

/** How long a cache may keep a card: a link turned off stops previewing within this. */
export const SHARE_CARD_MAX_AGE_SECONDS = 300

/** The brand picture of a card with none of its own: the app's 512 × 512 logo (frontend/public/logo-512.png). */
const DEFAULT_IMAGE_PATH = "/logo-512.png"

function send(reply: FastifyReply, status: 200 | 404, card: RenderedCard) {
  return reply
    .status(status)
    .header("Content-Type", "text/html; charset=utf-8")
    .header("Cache-Control", status === 200 ? `public, max-age=${SHARE_CARD_MAX_AGE_SECONDS}` : "no-store")
    .header("X-Robots-Tag", "noindex")
    .header("Content-Security-Policy", card.csp)
    .send(card.html)
}

export async function shareCardRoutes(app: FastifyInstance) {
  app.get("/og/s/:token", { config: publicReadLimit(120) }, async (req, reply) => {
    try {
      const params = publicShareParams.safeParse(req.params)
      // A deployment that does not allow public work has no public links (lib/surface-profile.ts).
      if (!params.success || !surfaceAllowsPublicOutputs()) return send(reply, 404, shareCardNotFoundHtml())
      const share = await findShownShare(params.data.token)
      const content = share ? await readShareCardContent(share) : null
      if (!share || !content) return send(reply, 404, shareCardNotFoundHtml())
      const token = encodeURIComponent(share.token)
      const shareSite = shareSiteOriginOf(config.SHARE_SITE_ORIGIN)
      const platform = getStaticPublicAppUrl().replace(/\/+$/, "")
      return send(
        reply,
        200,
        shareCardHtml(content, {
          cardUrl: `${shareSite}/s/${token}`,
          // Never `/s/` again: on the share site that address IS this card.
          pageUrl: `${shareSite}/shared/${token}`,
          defaultImage: { url: `${platform}${DEFAULT_IMAGE_PATH}`, width: 512, height: 512 },
        }),
      )
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to read the shared link")
    }
  })
}
