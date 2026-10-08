import { extname } from "node:path"

/**
 * Where past builds' styling files live in storage, and which files those
 * are. No imports beyond `node:path`: the storage layer's delete paths read
 * the prefix (they skip it), and the archive itself reads the storage layer.
 */
export const SITE_ASSET_ARCHIVE_PREFIX = "site-assets/"

/**
 * The files kept, by extension, with the type each is served as: what a page
 * is drawn with. Scripts are left out on purpose — a tab that misses a
 * script chunk after a deploy must keep reloading into the new build, as it
 * always has, and a session replay never runs one.
 */
export const SITE_ASSET_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
}

/** A name as Vite writes it under /assets: one path segment of letters, digits, dots, dashes and underscores. */
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/

/** The type a kept file is served as, or null for a name the archive never holds. */
export function siteAssetType(name: string): string | null {
  if (!NAME.test(name) || name.includes("..")) return null
  return SITE_ASSET_TYPES[extname(name).toLowerCase()] ?? null
}

/** The storage key of `/assets/<name>` — the URL's own path under the prefix. */
export const siteAssetKey = (name: string): string => `${SITE_ASSET_ARCHIVE_PREFIX}assets/${name}`
