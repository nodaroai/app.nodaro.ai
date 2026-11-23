/**
 * The share card: the small public HTML page a share link's address answers,
 * so a link pasted on a social network, a chat or a messenger shows a
 * preview. The address people share is `${SHARE_SITE_ORIGIN}/s/<token>`; that
 * site forwards it, for every client, to this server's `/s/<token>`, which the
 * bundled proxy answers from `GET /og/s/:token`. Preview readers take the Open
 * Graph and Twitter tags from the page's HTML and run no script; people are
 * sent on at once to the share page, `${SHARE_SITE_ORIGIN}/shared/<token>` (never
 * back to `/s/`, which would loop). The card's `og:url` and canonical are the
 * shared address.
 *
 * What the tags say is what the link shows (`public-reads.ts`), never more:
 *  - the title: the result's own name (the owner's, else its trend's, else its
 *    song's, else the start of its prompt) and the tool that made it,
 *    "Lady's on the Loose · Song Mashup"; a session or project: its title;
 *  - the description: one line, what it is and that it was made with Nodaro,
 *    in the language the link was shared in (card-locale.ts);
 *  - the picture: the card's own 1200 × 630 picture on our storage
 *    (card-image/), else the best picture of the result already ours, else the
 *    brand's card; never a provider's address;
 *  - a video's or a sound's file, when it is ours.
 * A trend run is named by its trend, never a prompt. Every value is escaped,
 * and only https addresses are written. The tags come first in `<head>`,
 * right after the charset and the title: some readers stop early.
 *
 * Pure: the caller hands in the addresses and what is ours.
 */
import { createHash } from "node:crypto"
import { isShareableAddress } from "./settings.js"
import { shareToolOf, shareWorkOf } from "./tool-names.js"
import { CARD_WORDS, HTML_LANGS, OG_LOCALES, RTL_LOCALES, type ShareCardLocale } from "./card-locale.js"
import { GRID_MAX, type CardPicture } from "./card-image/plan.js"
import type { SharedJob } from "./types.js"

export interface CardImage {
  readonly url: string
  readonly width?: number
  readonly height?: number
  readonly type?: string
}

export interface CardMedia {
  readonly url: string
  readonly type: string
  readonly width?: number
  readonly height?: number
}

export interface ShareCardContent {
  readonly title: string
  readonly description: string
  readonly locale: ShareCardLocale
  /** What the card's own picture shows (card-image/), or null when there is nothing to draw it from. */
  readonly picture: CardPicture | null
  /** The best picture of the item already on our storage: the card's picture until its own is rendered. */
  readonly fallbackImage: CardImage | null
  /** The picture the card names: set by the caller (`withCardImage`); else the fallback, else the brand's. */
  readonly image?: CardImage | null
  readonly video?: CardMedia
  readonly audio?: CardMedia
}

/** How the caller judges an address. */
export interface CardSources {
  /** An address of our own storage. */
  readonly isOurs: (url: string) => boolean
  /** An address the caller found restricted: never named, never drawn. */
  readonly refuse?: (url: string) => boolean
}

/** The page's addresses, handed in by the route. */
export interface ShareCardPlace {
  /** The address people share: the card's `og:url` and canonical. */
  readonly cardUrl: string
  /** Where people are sent: the share page (never the card's own address). */
  readonly pageUrl: string
  /** The picture of a card with none of its own (the brand's card). */
  readonly defaultImage: CardImage | null
}

const SITE_NAME = "Nodaro"
const TITLE_MAX = 90
const NAME_MAX = 60
const SEPARATOR = " · "

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/** Spaces collapsed and cut at `max` characters (whole code points), with an ellipsis when cut. */
export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim()
  const chars = Array.from(flat)
  if (chars.length <= max) return flat
  return `${chars.slice(0, max - 1).join("").trimEnd()}…`
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** An https address a card may name, or undefined. */
function httpsUrl(value: unknown, refuse?: (url: string) => boolean): string | undefined {
  if (typeof value !== "string" || !isShareableAddress(value)) return undefined
  return refuse?.(value) ? undefined : value
}

const MEDIA_TYPES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\.webm(?:[?#]|$)/i, "video/webm"],
  [/\.(mov|qt)(?:[?#]|$)/i, "video/quicktime"],
  [/\.mp4(?:[?#]|$)/i, "video/mp4"],
  [/\.mp3(?:[?#]|$)/i, "audio/mpeg"],
  [/\.wav(?:[?#]|$)/i, "audio/wav"],
  [/\.(m4a|aac)(?:[?#]|$)/i, "audio/mp4"],
  [/\.ogg(?:[?#]|$)/i, "audio/ogg"],
  [/\.flac(?:[?#]|$)/i, "audio/flac"],
  [/\.jpe?g(?:[?#]|$)/i, "image/jpeg"],
  [/\.png(?:[?#]|$)/i, "image/png"],
  [/\.webp(?:[?#]|$)/i, "image/webp"],
  [/\.gif(?:[?#]|$)/i, "image/gif"],
]

/** A file's type by its address's extension, or undefined. */
export function mediaTypeOf(url: string): string | undefined {
  return MEDIA_TYPES.find(([re]) => re.test(url))?.[1]
}

/** A picture already on our storage, with what is known of it. */
function ownImage(url: string | undefined, sources: CardSources, size: { width?: number; height?: number } = {}): CardImage | null {
  if (!url || !sources.isOurs(url)) return null
  const type = mediaTypeOf(url)
  return { url, ...(size.width && size.height ? { width: size.width, height: size.height } : {}), ...(type?.startsWith("image/") ? { type } : {}) }
}

/** "<name> · <tool>", the name cut to fit; just one of them when only one is known or they say the same. */
function titleOf(name: string | null, tool: string | null): string | null {
  const shortName = name ? clip(name, NAME_MAX) : null
  if (shortName && tool && shortName.toLowerCase() !== tool.toLowerCase()) return clip(`${shortName}${SEPARATOR}${tool}`, TITLE_MAX)
  return shortName ?? tool
}

/**
 * A shared result's card. `output` is the job's own `output_data` (already
 * redacted), read for the poster and the art a link's projection does not carry.
 */
export function jobCardContent(job: SharedJob, output: unknown, sources: CardSources, locale: ShareCardLocale = "en"): ShareCardContent {
  const { refuse } = sources
  const out = record(output)
  const words = CARD_WORDS[locale]
  const work = shareWorkOf(job.type, job.mediaKind)
  // What a person reads: the pills' names in place of the reference tokens. A trend run never shows a prompt.
  const prompt = job.trend ? null : (job.displayPrompt ?? job.prompt)
  const ownName = job.title ?? job.trend?.name ?? job.songTitle ?? null
  const name = ownName ?? (prompt ? clip(prompt, NAME_MAX) : null)
  const tool = job.toolName ?? shareToolOf(job.type)?.name ?? null
  const description = job.trend ? words.trend.replace("{trend}", job.trend.name) : words.made[work]
  const title = titleOf(name, tool) ?? description
  const base = { title, description, locale }
  const size = job.width !== undefined && job.height !== undefined ? { width: job.width, height: job.height } : {}
  const outputUrl = httpsUrl(job.outputUrl, refuse)
  const ownOutput = outputUrl && sources.isOurs(outputUrl) ? outputUrl : undefined

  if (job.mediaKind === "image") {
    return {
      ...base,
      picture: outputUrl ? { kind: "picture", source: outputUrl } : null,
      fallbackImage: ownImage(outputUrl, sources, size),
    }
  }
  if (job.mediaKind === "video") {
    // The owner's cover first (job.coverUrl), then the frame the video was given.
    const poster = httpsUrl(job.coverUrl, refuse) ?? httpsUrl(out.thumbnailUrl, refuse) ?? httpsUrl(out.posterUrl, refuse) ?? null
    return {
      ...base,
      picture: { kind: "video", poster, video: ownOutput ?? null },
      fallbackImage: ownImage(poster ?? undefined, sources),
      ...(ownOutput ? { video: { url: ownOutput, type: mediaTypeOf(ownOutput) ?? "video/mp4", ...size } } : {}),
    }
  }
  // A sound: the owner's cover or the provider's art (job.coverUrl), else art its output carries.
  const art =
    httpsUrl(job.coverUrl, refuse) ??
    httpsUrl(out.coverUrl, refuse) ??
    httpsUrl(out.imageUrl, refuse) ??
    httpsUrl(out.sunoImageUrl, refuse) ??
    httpsUrl(out.thumbnailUrl, refuse) ??
    null
  const audioType = ownOutput ? mediaTypeOf(ownOutput) : undefined
  return {
    ...base,
    picture: { kind: "sound", art, title: ownName, work },
    fallbackImage: ownImage(art ?? undefined, sources),
    ...(ownOutput ? { audio: { url: ownOutput, type: audioType?.startsWith("audio/") ? audioType : "audio/mpeg" } } : {}),
  }
}

function gridContent(title: string, description: string, locale: ShareCardLocale, previews: readonly (string | null)[], sources: CardSources): ShareCardContent {
  const shown = [...new Set(previews.map((u) => httpsUrl(u, sources.refuse)).filter((u): u is string => !!u))].slice(0, GRID_MAX)
  return {
    title,
    description,
    locale,
    picture: { kind: "grid", sources: shown },
    fallbackImage: shown.map((u) => ownImage(u, sources)).find((i) => i !== null) ?? null,
  }
}

/** A shared session's card: its title and a grid of its first shown results. */
export function sessionCardContent(
  title: string | null,
  itemCount: number,
  previewUrls: readonly string[],
  sources: CardSources,
  locale: ShareCardLocale = "en",
): ShareCardContent {
  const words = CARD_WORDS[locale]
  const description = words.results(itemCount)
  return gridContent(title ? clip(title, TITLE_MAX) : description, description, locale, previewUrls, sources)
}

/** A shared project's card: its name and a grid of its first sessions' pictures. */
export function projectCardContent(
  name: string,
  sessionCount: number,
  coverUrls: readonly (string | null)[],
  sources: CardSources,
  locale: ShareCardLocale = "en",
): ShareCardContent {
  const words = CARD_WORDS[locale]
  const description = words.sessions(sessionCount)
  return gridContent(clip(name, TITLE_MAX) || description, description, locale, coverUrls, sources)
}

/**
 * A workflow view link's card (lib/workflow-view/card.ts): "<name> · Workflow",
 * how many steps its canvas shows, and a grid of its first results.
 */
export function workflowCardContent(
  name: string,
  stepCount: number,
  previewUrls: readonly string[],
  sources: CardSources,
  locale: ShareCardLocale = "en",
): ShareCardContent {
  const words = CARD_WORDS[locale]
  const description = words.workflowSteps(stepCount)
  const title = titleOf(name.trim() || null, words.workflow) ?? description
  const content = gridContent(title, description, locale, previewUrls, sources)
  return content.picture?.kind === "grid" && content.picture.sources.length === 0 ? { ...content, picture: null } : content
}

/** The content with the picture the card names. */
export function withCardImage(content: ShareCardContent, image: CardImage | null): ShareCardContent {
  return { ...content, image }
}

export const meta = (attr: "property" | "name", key: string, value: string): string =>
  `<meta ${attr}="${key}" content="${escapeHtml(value)}">`

/** The one inline script (it sends people on), and its hash for the page's CSP. */
function redirectScript(pageUrl: string): { body: string; hash: string } {
  // JSON, with every `<` escaped, so no value can close the script.
  const body = `location.replace(${JSON.stringify(pageUrl).replace(/</g, "\\u003c")})`
  return { body, hash: createHash("sha256").update(body).digest("base64") }
}

export interface RenderedCard {
  readonly html: string
  /** The page's Content-Security-Policy: nothing but its own one script. */
  readonly csp: string
}

function mediaTags(prefix: "og:video" | "og:audio", media: CardMedia): string[] {
  return [
    meta("property", prefix, media.url),
    meta("property", `${prefix}:secure_url`, media.url),
    meta("property", `${prefix}:type`, media.type),
    ...(media.width && media.height ? [meta("property", `${prefix}:width`, String(media.width)), meta("property", `${prefix}:height`, String(media.height))] : []),
  ]
}

/**
 * The card's Open Graph and Twitter tags, in the order readers expect. Shared
 * with a workflow view link's page (lib/workflow-view/card.ts), whose page
 * around the tags differs.
 */
export function shareCardMetaTags(content: ShareCardContent, place: Pick<ShareCardPlace, "cardUrl" | "defaultImage">): string[] {
  const image = (content.image !== undefined ? content.image : content.fallbackImage) ?? place.defaultImage
  const imageUrl = image ? httpsUrl(image.url) : undefined
  const alt = content.title
  const tags: string[] = [
    meta("property", "og:title", content.title),
    meta("property", "og:description", content.description),
    ...(imageUrl && image
      ? [
          meta("property", "og:image", imageUrl),
          meta("property", "og:image:secure_url", imageUrl),
          ...(image.type ? [meta("property", "og:image:type", image.type)] : []),
          ...(image.width && image.height ? [meta("property", "og:image:width", String(image.width)), meta("property", "og:image:height", String(image.height))] : []),
          meta("property", "og:image:alt", alt),
        ]
      : []),
    meta("property", "og:type", content.video ? "video.other" : "website"),
    meta("property", "og:site_name", SITE_NAME),
    meta("property", "og:locale", OG_LOCALES[content.locale]),
    ...(httpsUrl(place.cardUrl) ? [meta("property", "og:url", place.cardUrl)] : []),
    ...(content.video ? mediaTags("og:video", content.video) : []),
    ...(content.audio ? mediaTags("og:audio", content.audio) : []),
    meta("name", "twitter:card", "summary_large_image"),
    meta("name", "twitter:title", content.title),
    meta("name", "twitter:description", content.description),
    ...(imageUrl ? [meta("name", "twitter:image", imageUrl), meta("name", "twitter:image:alt", alt)] : []),
  ]
  return tags
}

/** The card page. */
export function shareCardHtml(content: ShareCardContent, place: ShareCardPlace): RenderedCard {
  const tags = shareCardMetaTags(content, place)
  const page = escapeHtml(place.pageUrl)
  const script = redirectScript(place.pageUrl)
  const dir = RTL_LOCALES.has(content.locale) ? ' dir="rtl"' : ""
  const html = `<!DOCTYPE html>
<html lang="${HTML_LANGS[content.locale]}"${dir}>
<head>
<meta charset="utf-8">
<title>${escapeHtml(content.title)} — ${SITE_NAME}</title>
${tags.join("\n")}
${meta("name", "description", content.description)}
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0; url=${page}">
${httpsUrl(place.cardUrl) ? `<link rel="canonical" href="${escapeHtml(place.cardUrl)}">
` : ""}<script>${script.body}</script>
</head>
<body>
<p><a href="${page}">${escapeHtml(content.title)}</a></p>
</body>
</html>
`
  return { html, csp: `default-src 'none'; script-src 'sha256-${script.hash}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` }
}

/** The page of a link that is unknown, turned off, or whose item may not be shown: nothing about any content. */
export function shareCardNotFoundHtml(): RenderedCard {
  return {
    html: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Link not available — ${SITE_NAME}</title>
<meta name="robots" content="noindex">
</head>
<body>
<p>This link is not available.</p>
</body>
</html>
`,
    csp: "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  }
}

/** The origin `SHARE_SITE_ORIGIN` names: an http(s) origin, its trailing slash dropped; anything else, the default. */
export function shareSiteOriginOf(value: string | undefined, fallback = "https://nodaro.ai"): string {
  const raw = (value ?? "").trim()
  try {
    const url = new URL(raw)
    if ((url.protocol === "https:" || url.protocol === "http:") && (url.pathname === "/" || url.pathname === "") && !url.search && !url.hash && !url.username) {
      return url.origin
    }
  } catch {
    // not a URL: the default
  }
  return fallback
}
