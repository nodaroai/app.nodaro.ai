/**
 * A workflow view link's preview card: the HTML the link's own address
 * answers to a link-preview reader or a search engine (`GET /og/view/:token`,
 * which the bundled proxy serves to their user agents for `/view/<token>`;
 * people get the canvas page).
 *
 * The tags are the share card's (lib/share-links/card.ts): "<name> ·
 * Workflow", how many steps it shows in the language the link was turned on
 * in, and its own 1200 × 630 picture — a grid of the canvas's first results.
 * The picture is drawn ONLY from the public projection (project.ts), so a
 * card never shows what the canvas would not.
 *
 * Unlike a share card the page sends nobody on: only readers are given it,
 * and a redirect would lead a crawler back to this same page. It carries a
 * short text of the canvas — its notes and prompts — for a search engine to
 * read, and the robots rule the owner chose (`indexable`).
 */
import { escapeHtml, clip, meta, shareCardMetaTags, type CardImage, type ShareCardContent } from "../share-links/card.js"
import { HTML_LANGS, RTL_LOCALES } from "../share-links/card-locale.js"
import { GRID_MAX } from "../share-links/card-image/plan.js"
import type { ViewNode } from "./project.js"

export interface ViewCardPlace {
  /** The view's address: `og:url` and canonical. */
  readonly cardUrl: string
  readonly defaultImage: CardImage | null
  readonly indexable: boolean
}

export interface RenderedViewCard {
  readonly html: string
  readonly csp: string
}

/** The most words of the canvas the page carries. */
const TEXT_MAX_ITEMS = 40
const TEXT_ITEM_MAX = 500

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const IMAGE_RE = /\.(png|jpe?g|webp|gif)(?:[?#]|$)/i

function positionOf(node: ViewNode): { x: number; y: number } {
  const p = isRecord(node.position) ? node.position : {}
  return { x: typeof p.x === "number" ? p.x : 0, y: typeof p.y === "number" ? p.y : 0 }
}

/** Reading order on the canvas: top to bottom, then left to right. */
function inReadingOrder(nodes: readonly ViewNode[]): ViewNode[] {
  return [...nodes].sort((a, b) => {
    const pa = positionOf(a)
    const pb = positionOf(b)
    return pa.y - pb.y || pa.x - pb.x
  })
}

/** The picture a node shows: its active result's picture, else that result's thumbnail. */
function nodePicture(node: ViewNode): string | null {
  const data = isRecord(node.data) ? node.data : {}
  const results = Array.isArray(data.generatedResults) ? data.generatedResults.filter(isRecord) : []
  const index = typeof data.activeResultIndex === "number" ? data.activeResultIndex : 0
  const active = results[index] ?? results[0]
  const candidates = [
    active?.url,
    active?.thumbnailUrl,
    data.generatedImageUrl,
    data.thumbnailUrl,
  ]
  const found = candidates.find((u): u is string => typeof u === "string" && IMAGE_RE.test(u))
  return found ?? null
}

/** The card grid's pictures: the canvas's made results first (uploads after), in reading order. */
export function viewCardPictures(nodes: readonly ViewNode[]): string[] {
  const ordered = inReadingOrder(nodes)
  const made = ordered.filter((n) => !(n.type ?? "").startsWith("upload-"))
  const uploads = ordered.filter((n) => (n.type ?? "").startsWith("upload-"))
  const urls = [...made, ...uploads].map(nodePicture).filter((u): u is string => u !== null)
  return [...new Set(urls)].slice(0, GRID_MAX)
}

/** The steps a canvas shows: every node but its notes. */
export function viewStepCount(nodes: readonly ViewNode[]): number {
  return nodes.filter((n) => n.type !== "sticky-note").length
}

/** The words of the canvas a search engine reads: each node's name, note and prompt, in reading order. */
export function viewCardText(nodes: readonly ViewNode[]): string[] {
  const items: string[] = []
  for (const node of inReadingOrder(nodes)) {
    const data = isRecord(node.data) ? node.data : {}
    for (const key of ["label", "title", "text", "prompt", "scenePrompt"]) {
      const value = data[key]
      if (typeof value === "string" && value.trim()) items.push(clip(value, TEXT_ITEM_MAX))
    }
    if (items.length >= TEXT_MAX_ITEMS) break
  }
  return [...new Set(items)].slice(0, TEXT_MAX_ITEMS)
}

const CSP = "default-src 'none'; img-src https:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

/** The card page of a live view link. */
export function viewCardHtml(content: ShareCardContent, place: ViewCardPlace, text: readonly string[]): RenderedViewCard {
  const tags = shareCardMetaTags(content, place)
  const dir = RTL_LOCALES.has(content.locale) ? ' dir="rtl"' : ""
  const link = escapeHtml(place.cardUrl)
  const html = `<!DOCTYPE html>
<html lang="${HTML_LANGS[content.locale]}"${dir}>
<head>
<meta charset="utf-8">
<title>${escapeHtml(content.title)} — Nodaro</title>
${tags.join("\n")}
${meta("name", "description", content.description)}
<meta name="robots" content="${place.indexable ? "index, follow" : "noindex"}">
<link rel="canonical" href="${link}">
</head>
<body>
<h1><a href="${link}">${escapeHtml(content.title)}</a></h1>
<p>${escapeHtml(content.description)}</p>
${text.length > 0 ? `<ul>\n${text.map((t) => `<li>${escapeHtml(t)}</li>`).join("\n")}\n</ul>\n` : ""}</body>
</html>
`
  return { html, csp: CSP }
}

/** The page of a link that is unknown, revoked, or not live in this database: nothing about any workflow. */
export function viewCardNotFoundHtml(): RenderedViewCard {
  return {
    html: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Link not available — Nodaro</title>
<meta name="robots" content="noindex">
</head>
<body>
<p>This link is not available.</p>
</body>
</html>
`,
    csp: CSP,
  }
}
