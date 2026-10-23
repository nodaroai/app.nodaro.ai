import { useEffect } from "react"
import { useT, type MessageKey } from "@/lib/i18n"
import { surfaceBrandName } from "@/lib/surface-selectors"
import { isEditorPath } from "@/layouts/dashboard-paths"

/**
 * Every signed-in page names itself in the browser tab and to a screen reader
 * (WCAG 2.4.2 Page Titled): "<page> | <brand>". The page is the sidebar entry
 * the address falls under (the longest matching href, by whole segments), so a
 * new page that has a sidebar entry is titled with no extra step; the editor
 * is its own. A page with no entry keeps the brand alone.
 */

export interface TitledEntry {
  readonly href: string
  readonly label: MessageKey
}

function underHref(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href.endsWith("/") ? href : `${href}/`)
}

/** The dictionary key naming the page at `pathname`, or null when no entry covers it. */
export function pageTitleKey(pathname: string, entries: readonly TitledEntry[]): MessageKey | null {
  if (isEditorPath(pathname)) return "page.editor"
  let best: TitledEntry | null = null
  for (const entry of entries) {
    if (underHref(pathname, entry.href) && (!best || entry.href.length > best.href.length)) best = entry
  }
  return best?.label ?? null
}

export function usePageTitle(pathname: string, entries: readonly TitledEntry[]): void {
  const t = useT()
  const key = pageTitleKey(pathname, entries)
  useDocumentTitle(key ? t(key) : null)
}

/**
 * Names a page outside the sidebar (sign-in, the gallery, a published app):
 * "<page> | <brand>", or the brand alone while `page` is null.
 */
export function useDocumentTitle(page: string | null): void {
  useEffect(() => {
    const brand = surfaceBrandName()
    document.title = page ? `${page} | ${brand}` : brand
    // Leaving the signed-in area (sign-in, a published app, admin) must not
    // keep this page's name: the brand alone is what those pages had before.
    return () => {
      document.title = brand
    }
  }, [page])
}
