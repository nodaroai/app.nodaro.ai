import { useCallback, useEffect, useState } from "react"
import { useUserLocale } from "@/lib/locale-store"
import { surfacePlatformLinks } from "@/lib/surface-selectors"
import { NODE_DOCS_ALIASES, NODE_DOCS_SECTIONS } from "./node-docs-map.generated"

/**
 * Links from the editor to a node's page in the public docs.
 *
 * Every link is built from the node type alone. `/docs/node/{type}` is a
 * redirect on the docs site: it lands on the node's page wherever that page
 * lives, and an unknown type (a node with no page yet) lands on the Node
 * Reference. So a page can move without breaking the app. Never link to a page
 * URL from the snapshot.
 *
 * A deep link (`#settings`, `#models`, a popover chip) is shown only when the
 * node's page has that section: `node-docs-map.generated.ts`, built from the
 * docs site's snapshot by `npm -w frontend run gen:node-docs`.
 */

export const NODE_DOCS_ORIGIN = "https://nodaro.ai"

/**
 * Whether the interface shows docs links at all. They are platform links, so a
 * deployment that hides those (a white-label surface) hides these too. Every
 * component that renders a docs link checks it; a test holds them to that.
 */
export function nodeDocsLinksShown(): boolean {
  return surfacePlatformLinks()
}

/** The fixed section ids of a node page. They stay the same after a page is translated. */
export const NODE_DOCS_SECTION_IDS = [
  "when-to-use",
  "quick-start",
  "inputs",
  "outputs",
  "settings",
  "models",
  "credits",
  "tips",
  "troubleshooting",
  "api",
  "limits",
  "faq",
] as const

export type NodeDocsSection = (typeof NODE_DOCS_SECTION_IDS)[number]

/**
 * The link to a node's docs page. `ref=app` is always added, so visits from the
 * app can be counted; `lang` is the interface language (a language the docs
 * have not published yet falls back to English on the site).
 */
export function docsUrlForNode(type: string, opts: { section?: NodeDocsSection; lang?: string } = {}): string {
  const query = new URLSearchParams()
  if (opts.lang) query.set("lang", opts.lang)
  query.set("ref", "app")
  const hash = opts.section ? `#${opts.section}` : ""
  return `${NODE_DOCS_ORIGIN}/docs/node/${encodeURIComponent(type)}?${query.toString()}${hash}`
}

/**
 * The link to any other page of the public docs, by its path under `/docs/`
 * (`"mcp"`, `"mcp/troubleshooting"`, `"developers/api"`). Same origin, `ref`
 * and language rules as a node page; the same `nodeDocsLinksShown()` gate.
 */
export function docsUrlForPage(path: string, opts: { lang?: string } = {}): string {
  const query = new URLSearchParams()
  if (opts.lang) query.set("lang", opts.lang)
  query.set("ref", "app")
  const clean = path.replace(/^\/+|\/+$/g, "")
  return `${NODE_DOCS_ORIGIN}/docs${clean ? `/${clean}` : ""}?${query.toString()}`
}

/** `docsUrlForPage` with the interface language bound. */
export function useDocsPageUrl(): (path: string) => string {
  const lang = useUserLocale()
  return useCallback((path: string) => docsUrlForPage(path, { lang }), [lang])
}

/** The sections the node's page has, in page order. Empty for a type with no page. */
export function nodeDocsSections(type: string): readonly NodeDocsSection[] {
  return NODE_DOCS_SECTIONS[NODE_DOCS_ALIASES[type] ?? type] ?? []
}

export function nodeDocsHasSection(type: string, section: NodeDocsSection): boolean {
  return nodeDocsSections(type).includes(section)
}

/** `docsUrlForNode` with the interface language bound: every link from the interface carries it. */
export function useNodeDocsUrl(): (type: string, section?: NodeDocsSection) => string {
  const lang = useUserLocale()
  return useCallback((type: string, section?: NodeDocsSection) => docsUrlForNode(type, { section, lang }), [lang])
}

/** The language whose summary every page has: the fallback for any other. */
export const NODE_DOCS_FALLBACK_LANGUAGE = "en"

type Summaries = Readonly<Record<string, string>>

/** One chunk per language the docs translate (`summaries/<lang>.generated.ts`), keyed by lowercase language. */
const SUMMARY_CHUNKS: ReadonlyMap<string, () => Promise<{ NODE_DOCS_SUMMARIES: Summaries }>> = new Map(
  Object.entries(import.meta.glob<{ NODE_DOCS_SUMMARIES: Summaries }>("./summaries/*.generated.ts")).map(
    ([path, load]) => [path.slice("./summaries/".length, -".generated.ts".length).toLowerCase(), load],
  ),
)
const loadedSummaries = new Map<string, Summaries>()
const loadingSummaries = new Map<string, Promise<void>>()

function loadSummaries(lang: string): Promise<void> {
  const load = SUMMARY_CHUNKS.get(lang)
  if (!load || loadedSummaries.has(lang)) return Promise.resolve()
  let pending = loadingSummaries.get(lang)
  if (!pending) {
    pending = load()
      .then((m) => {
        loadedSummaries.set(lang, m.NODE_DOCS_SUMMARIES)
      })
      .finally(() => loadingSummaries.delete(lang))
    loadingSummaries.set(lang, pending)
  }
  return pending
}

/**
 * A page's summary in `lang` when the page is translated into it, otherwise
 * in English. Language ids match in any letter case (`pt-BR`, `pt-br`).
 */
export function nodeDocsSummaryFrom(byLang: ReadonlyMap<string, Summaries>, lang: string, type: string): string | undefined {
  const key = NODE_DOCS_ALIASES[type] ?? type
  return byLang.get(lang.toLowerCase())?.[key] ?? byLang.get(NODE_DOCS_FALLBACK_LANGUAGE)?.[key]
}

/**
 * The page's one-line summary in the interface language, or in English when
 * the docs have not translated that page. Loaded on first use (separate chunks
 * the editor does not carry until a docs popover opens). Undefined until they
 * arrive, and for a type with no page.
 */
export function useNodeDocsSummary(type: string, enabled: boolean): string | undefined {
  const lang = useUserLocale().toLowerCase()
  const [, setVersion] = useState(0)
  const needed = [...new Set([lang, NODE_DOCS_FALLBACK_LANGUAGE])].filter((l) => SUMMARY_CHUNKS.has(l))
  const missing = needed.filter((l) => !loadedSummaries.has(l)).join(",")

  useEffect(() => {
    if (!enabled || !missing) return
    let live = true
    Promise.all(missing.split(",").map(loadSummaries))
      .then(() => {
        if (live) setVersion((v) => v + 1)
      })
      .catch(() => {
        // A failed chunk load only costs the summary; the popover still links.
      })
    return () => {
      live = false
    }
  }, [enabled, missing])

  return enabled ? nodeDocsSummaryFrom(loadedSummaries, lang, type) : undefined
}
