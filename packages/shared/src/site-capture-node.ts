/**
 * Site Capture node — the wire contract both engines read.
 *
 * The node runs `POST /v1/site-capture` (a web page captured the way a phone
 * shows it: a full-page image, up to 8 section stills in page order, a section
 * map and the page's exact figures) and polls its job. What it hands on is read
 * from that job's output here, once, so the editor and a server run cannot
 * disagree:
 *   - `image`: the stills, in page order. The first still is the pip's single
 *     value; every still is its list (an "each" wire runs once per still, a
 *     Bundle wire takes them all). The full-page image is never one of them.
 *   - `json`: the capture's output as the route returns it.
 */

export const SITE_CAPTURE_NODE_TYPE = "site-capture" as const

/** The stills a capture may return — the route's `maxStills` bounds. */
export const SITE_CAPTURE_STILLS = { min: 3, max: 8, default: 8 } as const

/** A node's `maxStills`, clamped to the route's bounds; anything else is the default. */
export function siteCaptureMaxStills(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return SITE_CAPTURE_STILLS.default
  return Math.min(SITE_CAPTURE_STILLS.max, Math.max(SITE_CAPTURE_STILLS.min, Math.round(value)))
}

/**
 * The page a run captures: the address typed on the node, else the first web
 * address in the text wired into it (a Text node, a list item), else that
 * text's first word, which the route normalises ("example.com") or refuses.
 */
export function siteCapturePageUrl(typed: unknown, upstream?: string | null): string {
  const own = typeof typed === "string" ? typed.trim() : ""
  if (own.length > 0) return own
  const text = typeof upstream === "string" ? upstream.trim() : ""
  if (text.length === 0) return ""
  const link = text.match(/https?:\/\/[^\s<>"'`]+/i)
  if (link) return link[0].replace(/[),.;:!?]+$/, "")
  return text.split(/\s+/)[0] ?? ""
}

/** One still of a capture, as its output lists it. */
export interface SiteCaptureStill {
  readonly url: string
  readonly index: number
  readonly label: string
  readonly category: string
}

/** The stills of a capture's output, in page order; none when it holds none. */
export function siteCaptureStills(output: unknown): SiteCaptureStill[] {
  if (!output || typeof output !== "object" || Array.isArray(output)) return []
  const raw = (output as { stills?: unknown }).stills
  if (!Array.isArray(raw)) return []
  return raw
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object" && typeof (s as { url?: unknown }).url === "string" && (s as { url: string }).url.length > 0)
    .map((s, i) => ({
      url: s.url as string,
      index: typeof s.index === "number" ? s.index : i,
      label: typeof s.label === "string" ? s.label : "",
      category: typeof s.category === "string" ? s.category : "other",
    }))
    .sort((a, b) => a.index - b.index)
}

/** The still URLs of a capture's output, in page order. */
export function siteCaptureStillUrls(output: unknown): string[] {
  return siteCaptureStills(output).map((s) => s.url)
}

/**
 * What a capture hands on: `json` (the output itself), `imageUrl` (the first
 * still) and `listResults` (every still, in page order). Nothing for an output
 * that is not an object.
 */
export function siteCaptureNodeOutputs(output: unknown): { json?: Record<string, unknown>; imageUrl?: string; listResults?: string[] } {
  if (!output || typeof output !== "object" || Array.isArray(output)) return {}
  const urls = siteCaptureStillUrls(output)
  return {
    json: output as Record<string, unknown>,
    ...(urls.length > 0 ? { imageUrl: urls[0], listResults: urls } : {}),
  }
}
