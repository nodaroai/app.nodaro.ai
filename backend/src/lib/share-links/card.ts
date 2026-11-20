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
 * the result's name (else the start of its prompt), the prompt as its
 * description, the result itself as the picture (a video's poster and the
 * video; a sound's cover, else the default picture). A trend run is named by
 * its trend, never a prompt. Every value is escaped, and only https addresses
 * are written.
 *
 * Pure: the route hands in the addresses (card, page, default picture).
 */
import { createHash } from "node:crypto"
import { isShareableAddress } from "./settings.js"
import type { SharedJob } from "./types.js"

export interface CardImage {
  readonly url: string
  readonly width?: number
  readonly height?: number
}

export interface ShareCardContent {
  readonly title: string
  readonly description: string | null
  readonly image: CardImage | null
  readonly video?: { readonly url: string; readonly type: string; readonly width?: number; readonly height?: number }
}

/** The page's addresses, handed in by the route. */
export interface ShareCardPlace {
  /** The address people share: the card's `og:url` and canonical. */
  readonly cardUrl: string
  /** Where people are sent: the share page (never the card's own address). */
  readonly pageUrl: string
  /** The picture of a card with none of its own (the brand's). */
  readonly defaultImage: CardImage | null
}

const SITE_NAME = "Nodaro"
const TITLE_MAX = 70
const DESCRIPTION_MAX = 200

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

const VIDEO_TYPES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\.webm(?:[?#]|$)/i, "video/webm"],
  [/\.(mov|qt)(?:[?#]|$)/i, "video/quicktime"],
]

function videoTypeOf(url: string): string {
  return VIDEO_TYPES.find(([re]) => re.test(url))?.[1] ?? "video/mp4"
}

/**
 * A shared result's card. `output` is the job's own `output_data` (already
 * redacted), read for the poster and the cover a link's projection does not
 * carry; `refuse` drops an address the caller found restricted.
 */
export function jobCardContent(job: SharedJob, output: unknown, refuse?: (url: string) => boolean): ShareCardContent {
  const out = record(output)
  // What a person reads: the pills' names in place of the reference tokens.
  const prompt = job.trend ? null : (job.displayPrompt ?? job.prompt)
  const title = job.title ?? (job.trend ? job.trend.name : prompt ? clip(prompt, TITLE_MAX) : "A result shared on Nodaro")
  const description = job.trend
    ? `Made with the ${job.trend.name} trend on Nodaro.`
    : prompt
      ? clip(prompt, DESCRIPTION_MAX)
      : null
  const size = job.width !== undefined && job.height !== undefined ? { width: job.width, height: job.height } : {}
  if (job.mediaKind === "image") {
    const url = httpsUrl(job.outputUrl, refuse)
    return { title, description, image: url ? { url, ...size } : null }
  }
  if (job.mediaKind === "video") {
    const poster = httpsUrl(out.thumbnailUrl, refuse) ?? httpsUrl(out.posterUrl, refuse)
    const url = httpsUrl(job.outputUrl, refuse)
    return {
      title,
      description,
      image: poster ? { url: poster } : null,
      ...(url ? { video: { url, type: videoTypeOf(url), ...size } } : {}),
    }
  }
  // A sound: its cover (a Suno track carries one), else the default picture.
  const cover =
    httpsUrl(out.coverUrl, refuse) ?? httpsUrl(out.imageUrl, refuse) ?? httpsUrl(out.sunoImageUrl, refuse) ?? httpsUrl(out.thumbnailUrl, refuse)
  return { title, description, image: cover ? { url: cover } : null }
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** A shared session's card: its title and its first shown result's picture. */
export function sessionCardContent(title: string | null, itemCount: number, coverUrl: string | null): ShareCardContent {
  const cover = httpsUrl(coverUrl)
  return {
    title: title ? clip(title, TITLE_MAX) : "A session shared on Nodaro",
    description: `${plural(itemCount, "result", "results")} on Nodaro.`,
    image: cover ? { url: cover } : null,
  }
}

/** A shared project's card: its name and its first session's picture. */
export function projectCardContent(name: string, sessionCount: number, coverUrl: string | null): ShareCardContent {
  const cover = httpsUrl(coverUrl)
  return {
    title: clip(name, TITLE_MAX) || "A project shared on Nodaro",
    description: `${plural(sessionCount, "session", "sessions")} on Nodaro.`,
    image: cover ? { url: cover } : null,
  }
}

const meta = (attr: "property" | "name", key: string, value: string): string =>
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

/** The card page. */
export function shareCardHtml(content: ShareCardContent, place: ShareCardPlace): RenderedCard {
  const image = content.image ?? place.defaultImage
  const imageUrl = image ? httpsUrl(image.url) : undefined
  const tags: string[] = [
    meta("property", "og:type", content.video ? "video.other" : "website"),
    meta("property", "og:site_name", SITE_NAME),
    meta("property", "og:title", content.title),
    ...(content.description ? [meta("property", "og:description", content.description)] : []),
    ...(httpsUrl(place.cardUrl) ? [meta("property", "og:url", place.cardUrl)] : []),
    ...(imageUrl && image
      ? [
          meta("property", "og:image", imageUrl),
          meta("property", "og:image:secure_url", imageUrl),
          ...(image.width && image.height ? [meta("property", "og:image:width", String(image.width)), meta("property", "og:image:height", String(image.height))] : []),
        ]
      : []),
    ...(content.video
      ? [
          meta("property", "og:video", content.video.url),
          meta("property", "og:video:secure_url", content.video.url),
          meta("property", "og:video:type", content.video.type),
          ...(content.video.width && content.video.height
            ? [meta("property", "og:video:width", String(content.video.width)), meta("property", "og:video:height", String(content.video.height))]
            : []),
        ]
      : []),
    meta("name", "twitter:card", "summary_large_image"),
    meta("name", "twitter:title", content.title),
    ...(content.description ? [meta("name", "twitter:description", content.description)] : []),
    ...(imageUrl ? [meta("name", "twitter:image", imageUrl)] : []),
  ]
  const page = escapeHtml(place.pageUrl)
  const script = redirectScript(place.pageUrl)
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(content.title)} — ${SITE_NAME}</title>
<meta name="robots" content="noindex">
${content.description ? `${meta("name", "description", content.description)}\n` : ""}${tags.join("\n")}
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
