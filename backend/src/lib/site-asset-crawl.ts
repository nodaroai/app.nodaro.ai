/**
 * The build files a live page names — for `scripts/backfill-site-assets.ts`,
 * which copies a site's current styling files into the archive of past
 * builds. Pure text matching over what a browser reads: the HTML shell, the
 * script chunks (Vite's `__vite__mapDeps` lists the stylesheets a lazily
 * loaded chunk needs), and the stylesheets (their fonts and images).
 */

/** `/assets/<name>` and `assets/<name>`, as HTML, scripts and stylesheets write them. */
const UNDER_ASSETS = /(?:^|[^A-Za-z0-9._-])assets\/([A-Za-z0-9][A-Za-z0-9._-]*)/g

/** A stylesheet's `url(name)` / `url(./name)`: a file beside it, under /assets too. */
const BESIDE_STYLESHEET = /url\(\s*['"]?(?:\.\/)?([A-Za-z0-9][A-Za-z0-9._-]*\.[A-Za-z0-9]+)['"]?\s*\)/g

/** Every /assets file name the text mentions, once each, in order of first mention. */
export function assetNamesIn(text: string, kind: "page" | "script" | "stylesheet"): string[] {
  const names = [...text.matchAll(UNDER_ASSETS)].map((match) => match[1]!)
  if (kind === "stylesheet") names.push(...[...text.matchAll(BESIDE_STYLESHEET)].map((match) => match[1]!))
  return [...new Set(names)]
}

/** True when a body is a page rather than the file asked for — what a missing file used to answer with. */
export function looksLikeHtml(contentType: string, head: string): boolean {
  return /html/i.test(contentType) || /^\s*<(!doctype|html)/i.test(head)
}
