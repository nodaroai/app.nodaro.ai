/**
 * Video Remake's before-and-after previews, as the tools pages and the
 * shell's menu read them (Cloud: registered under `hasCredits()`, beside the
 * product's other public reads). Public: no credential is needed and none is
 * read (middleware/auth.ts lists the path), so a guest's page shows them too.
 *
 *   GET /v1/video-remake/previews?locale=<id>
 *     { data: [{ id, kind, title, caption, sourceUrl, resultUrl, sweepUrl,
 *                stackedUrl, posterUrl, stackedPosterUrl, href }] }
 *
 * The list is the previews table (ee/lib/video-remake-previews.ts), in its
 * order. `title` and `caption` are in `locale` (a platform language id;
 * anything else, or none, is English), in English where the language has no
 * copy for the preview. `posterUrl` and `stackedPosterUrl` are frames cut from
 * the sweep and the stacked clip at the preview's poster moment, for a page
 * that shows a still until a clip plays (or instead of one). `href` is the
 * page of the tools site the preview leads to.
 *
 * `{ data: [] }` where there is nothing to show:
 *
 * - this deployment does not show the platform's rendered previews (its
 *   `catalogs.images` is not `"default"`, or it is not Nodaro Cloud);
 * - it does not offer Video Remake to its users (the `cast-swap` node type is
 *   withheld; always asked as a user, never as the caller).
 *
 * The same answer for every caller in a language, so it is cacheable.
 */
import type { FastifyInstance, RouteHandlerMethod } from "fastify"
import type { LocaleId } from "@nodaro/shared/i18n"
import { lookPreviewStillUrl, platformPicturesShown } from "../../lib/picker-images.js"
import { platformLocaleOf } from "../../lib/style-labels.js"
import { USER_VIEWER, isNodeDenied } from "../../lib/surface-deny.js"
import { VIDEO_REMAKE_PREVIEWS, VIDEO_REMAKE_PREVIEW_COPY, type VideoRemakePreviewKind } from "../lib/video-remake-previews.js"

/** How long a client (or a CDN) may keep the answer: as the other public catalog reads. */
export const PREVIEWS_MAX_AGE_SECONDS = 300

/** The width the posters are cut at: the clips' own, so a poster stands in for its clip at the same sharpness. */
const POSTER_WIDTH = 854

/** One preview of the list. */
export interface VideoRemakePreview {
  readonly id: string
  readonly kind: VideoRemakePreviewKind
  readonly title: string
  readonly caption: string
  readonly sourceUrl: string
  readonly resultUrl: string
  readonly sweepUrl: string
  readonly stackedUrl: string
  readonly posterUrl: string
  readonly stackedPosterUrl: string
  readonly href: string
}

export async function videoRemakePreviewsRoutes(app: FastifyInstance) {
  // Both prefixes, each written out so the route scans read them (lib/video-remake-paths.ts).
  app.get("/v1/video-remake/previews", previewsHandler)
  app.get("/v1/cast-swap/previews", previewsHandler)
}

/** The list in `locale`; empty where Video Remake or the platform's previews are not offered. */
export async function videoRemakePreviews(locale: LocaleId): Promise<VideoRemakePreview[]> {
  if (isNodeDenied("cast-swap", USER_VIEWER) || !platformPicturesShown()) return []
  const out: VideoRemakePreview[] = []
  for (const entry of VIDEO_REMAKE_PREVIEWS) {
    const copy = VIDEO_REMAKE_PREVIEW_COPY[locale]?.[entry.id] ?? VIDEO_REMAKE_PREVIEW_COPY.en?.[entry.id]
    const posterUrl = lookPreviewStillUrl(entry.sweepUrl, POSTER_WIDTH, entry.posterAtSeconds)
    const stackedPosterUrl = lookPreviewStillUrl(entry.stackedUrl, POSTER_WIDTH, entry.posterAtSeconds)
    // A preview with no words or no poster is left out rather than sent incomplete.
    if (!copy || !posterUrl || !stackedPosterUrl) continue
    out.push({
      id: entry.id,
      kind: entry.kind,
      title: copy.title,
      caption: copy.caption,
      sourceUrl: entry.sourceUrl,
      resultUrl: entry.resultUrl,
      sweepUrl: entry.sweepUrl,
      stackedUrl: entry.stackedUrl,
      posterUrl,
      stackedPosterUrl,
      href: entry.href,
    })
  }
  return out
}

const previewsHandler: RouteHandlerMethod = async (req, reply) => {
  const locale = platformLocaleOf((req.query as { locale?: unknown } | undefined)?.locale)
  return reply
    .header("Cache-Control", `public, max-age=${PREVIEWS_MAX_AGE_SECONDS}`)
    .send({ data: await videoRemakePreviews(locale) })
}
