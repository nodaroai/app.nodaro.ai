/** Escape a value for a double-quoted HTML attribute. */
export function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

/**
 * A width or height as the owner typed it, made safe for the attribute: a
 * number of pixels (`600`) or a percentage (`100%`). Anything else falls back.
 */
export function embedDimension(raw: string, fallback: string): string {
  const value = raw.trim()
  return /^\d{1,5}%?$/.test(value) ? value : fallback
}

export const DEFAULT_EMBED_WIDTH = "100%"
export const DEFAULT_EMBED_HEIGHT = "600"

/** The `<iframe>` snippet that shows a workflow's view on another site. */
export function workflowEmbedCode(args: {
  readonly embedUrl: string
  readonly width: string
  readonly height: string
  readonly title: string
}): string {
  const width = embedDimension(args.width, DEFAULT_EMBED_WIDTH)
  const height = embedDimension(args.height, DEFAULT_EMBED_HEIGHT)
  return `<iframe src="${escapeHtmlAttribute(args.embedUrl)}" width="${width}" height="${height}" style="border:0" loading="lazy" allowfullscreen title="${escapeHtmlAttribute(args.title)}"></iframe>`
}
