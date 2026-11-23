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
 *
 * Fast by construction (a preview reader waits about a second): the owner's
 * block check runs beside the item's read, and the card's own picture is
 * named only when it is already known to exist (card-image/service.ts);
 * otherwise its render starts in the background, the card names the best
 * picture already ours, and caches keep that answer for one minute only.
 */
import type { FastifyInstance, FastifyReply } from "fastify"
import { config } from "../lib/config.js"
import { getStaticPublicAppUrl } from "../lib/allowed-origins.js"
import { sendInternalError } from "../lib/http-errors.js"
import { surfaceAllowsPublicOutputs } from "../lib/surface-profile.js"
import { publicShareParams } from "../lib/share-links/schemas.js"
import { publicReadLimit, readShownShare } from "../lib/share-links/public-gate.js"
import { readShareCardContent } from "../lib/share-links/card-reads.js"
import { shareCardHtml, shareCardNotFoundHtml, shareSiteOriginOf, withCardImage, type RenderedCard } from "../lib/share-links/card.js"
import { renderedCardImage } from "../lib/share-links/card-image/service.js"
import { CARD_IMAGE_HEIGHT, CARD_IMAGE_TYPE, CARD_IMAGE_WIDTH } from "../lib/share-links/card-image/plan.js"

/** How long a cache may keep a card: a link turned off stops previewing within this. */
export const SHARE_CARD_MAX_AGE_SECONDS = 300
/** How long a cache may keep a card whose own picture is not rendered yet: readers come back for the better one soon. */
export const SHARE_CARD_PENDING_MAX_AGE_SECONDS = 60

/** The brand's card, a 1200 × 630 JPEG (frontend/public/share-card.jpg): the picture of a card with none of its own yet. */
const DEFAULT_IMAGE_PATH = "/share-card.jpg"

function send(reply: FastifyReply, status: 200 | 404, card: RenderedCard, maxAge = SHARE_CARD_MAX_AGE_SECONDS) {
  return reply
    .status(status)
    .header("Content-Type", "text/html; charset=utf-8")
    .header("Cache-Control", status === 200 ? `public, max-age=${maxAge}` : "no-store")
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
      const shown = await readShownShare(params.data.token, readShareCardContent)
      if (!shown) return send(reply, 404, shareCardNotFoundHtml())
      const { share, value: content } = shown
      const rendered = content.picture ? await renderedCardImage(share.token, content.picture) : null
      const token = encodeURIComponent(share.token)
      const shareSite = shareSiteOriginOf(config.SHARE_SITE_ORIGIN)
      const platform = getStaticPublicAppUrl().replace(/\/+$/, "")
      const card = shareCardHtml(rendered ? withCardImage(content, rendered) : content, {
        cardUrl: `${shareSite}/s/${token}`,
        // Never `/s/` again: on the share site that address IS this card.
        pageUrl: `${shareSite}/shared/${token}`,
        defaultImage: { url: `${platform}${DEFAULT_IMAGE_PATH}`, width: CARD_IMAGE_WIDTH, height: CARD_IMAGE_HEIGHT, type: CARD_IMAGE_TYPE },
      })
      return send(reply, 200, card, rendered || !content.picture ? SHARE_CARD_MAX_AGE_SECONDS : SHARE_CARD_PENDING_MAX_AGE_SECONDS)
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to read the shared link")
    }
  })
}
