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

/**
 * The summaries exist in English only, so they are shown only to an English
 * interface; another language shows the node's name and sections without one.
 */
export const NODE_DOCS_SUMMARY_LANGUAGE = "en"

type Summaries = Readonly<Record<string, string>>
let summaries: Summaries | null = null
let loading: Promise<Summaries> | null = null

function loadSummaries(): Promise<Summaries> {
  loading ??= import("./node-docs-summaries.generated").then((m) => {
    summaries = m.NODE_DOCS_SUMMARIES
    return summaries
  })
  return loading
}

/**
 * The page's one-line summary, loaded on first use (a separate chunk the editor
 * does not carry until a docs popover opens). Undefined until it arrives, in
 * any language but English, and for a type with no page.
 */
export function useNodeDocsSummary(type: string, enabled: boolean): string | undefined {
  const english = useUserLocale() === NODE_DOCS_SUMMARY_LANGUAGE
  const [loaded, setLoaded] = useState<Summaries | null>(summaries)
  const wanted = enabled && english

  useEffect(() => {
    if (!wanted || loaded) return
    let live = true
    loadSummaries()
      .then((s) => {
        if (live) setLoaded(s)
      })
      .catch(() => {
        // A failed chunk load only costs the summary; the popover still links.
        loading = null
      })
    return () => {
      live = false
    }
  }, [wanted, loaded])

  return wanted ? loaded?.[NODE_DOCS_ALIASES[type] ?? type] : undefined
}
