/**
 * Links to nodaro.ai/mcp, the page that connects an outside AI client (Claude
 * Code, Claude, ChatGPT, …) to Nodaro. Each client is a tab with its own
 * anchor, `#client-<slug>`. The page takes the interface language as `?lang=`
 * and moves to its translation when there is one (ja, pt-BR), keeping the
 * anchor; any other language stays on the English page.
 *
 * Platform links: a deployment that hides those (a white-label surface) hides
 * these too — every component that renders one checks `mcpLinksShown()`.
 */
import { NODE_DOCS_ORIGIN } from "@/lib/node-docs/node-docs"
import { surfacePlatformLinks } from "@/lib/surface-selectors"

export type McpClientSlug = "claude-code" | "claude" | "chatgpt"

export function mcpClientUrl(slug: McpClientSlug, opts: { lang?: string } = {}): string {
  const query = new URLSearchParams()
  if (opts.lang) query.set("lang", opts.lang)
  query.set("ref", "app")
  return `${NODE_DOCS_ORIGIN}/mcp?${query.toString()}#client-${slug}`
}

export function mcpLinksShown(): boolean {
  return surfacePlatformLinks()
}
