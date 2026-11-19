/**
 * Video Remake's art styles, as a menu reads them (Cloud: registered under
 * `hasCredits()`, beside the product's other public reads). Public: no
 * credential is needed and none is read (middleware/auth.ts lists the path),
 * so a guest's menu lists them too.
 *
 *   GET /v1/video-remake/art-styles?locale=<id>
 *     { data: [{ id, label, clipUrl, stillUrl }] }
 *
 * The list is what Video Remake's art style picker offers: the options of the
 * `style` picker catalog (pack-composed, so a deployment's catalog packs
 * apply), in the catalog's order, that
 *
 * - are offered for video (`media` absent, or naming `"video"`),
 * - are not left out of restyle lists (`restyle` is not `false`), and
 * - have an approved restyle preview (lib/picker-images.ts
 *   `shownRestylePreviews`): a clip of real footage wiping into the style.
 *
 * `id` is the catalog option id a run takes as its art style. `label` is the
 * style's name in `locale` (a platform language id; anything else, or none,
 * is English), from the catalog's locale sidecars (lib/style-labels.ts), in
 * English where the language does not name the style. `clipUrl` is the
 * preview clip and `stillUrl` a frame cut from it, both absolute.
 *
 * `{ data: [] }` where there is nothing to list:
 *
 * - this deployment does not show the platform's rendered previews (its
 *   `catalogs.images` is not `"default"`);
 * - it does not offer Video Remake to its users (the `cast-swap` node type is
 *   withheld; always asked as a user, never as the caller);
 * - this environment's engine takes no art style.
 *
 * The same answer for every caller in a language, so it is cacheable.
 */
import type { FastifyInstance, RouteHandlerMethod } from "fastify"
import type { LocaleId } from "@nodaro/shared/i18n"
import { getPickerCatalog } from "@nodaro/prompts/picker-catalogs"
import { loadedEngineTakesArtStyle } from "../../lib/cast-swap-engines.js"
import { shownRestylePreviews } from "../../lib/picker-images.js"
import { platformLocaleOf, styleLabelsIn } from "../../lib/style-labels.js"
import { USER_VIEWER, isNodeDenied } from "../../lib/surface-deny.js"

/** How long a client (or a CDN) may keep the answer: as the other public catalog reads. */
export const ART_STYLES_MAX_AGE_SECONDS = 300

/** One art style of the list. */
export interface VideoRemakeArtStyle {
  readonly id: string
  readonly label: string
  readonly clipUrl: string
  readonly stillUrl: string
}

export async function castSwapArtStylesRoutes(app: FastifyInstance) {
  // Both prefixes, each written out so the route scans read them (lib/video-remake-paths.ts).
  app.get("/v1/video-remake/art-styles", artStylesHandler)
  app.get("/v1/cast-swap/art-styles", artStylesHandler)
}

/** The list in `locale`; empty where Video Remake, its art styles or the platform's previews are not offered. */
export async function videoRemakeArtStyles(locale: LocaleId): Promise<VideoRemakeArtStyle[]> {
  if (isNodeDenied("cast-swap", USER_VIEWER) || !loadedEngineTakesArtStyle()) return []
  const previews = shownRestylePreviews()
  if (!previews) return []
  const label = await styleLabelsIn(locale)
  const out: VideoRemakeArtStyle[] = []
  for (const option of getPickerCatalog("style")?.options ?? []) {
    const preview = previews.get(option.id)
    if (!preview || option.restyle === false) continue
    if (option.media !== undefined && !option.media.includes("video")) continue
    out.push({ id: option.id, label: label(option.id, option.label), clipUrl: preview.clipUrl, stillUrl: preview.stillUrl })
  }
  return out
}

const artStylesHandler: RouteHandlerMethod = async (req, reply) => {
  const locale = platformLocaleOf((req.query as { locale?: unknown } | undefined)?.locale)
  return reply
    .header("Cache-Control", `public, max-age=${ART_STYLES_MAX_AGE_SECONDS}`)
    .send({ data: await videoRemakeArtStyles(locale) })
}
