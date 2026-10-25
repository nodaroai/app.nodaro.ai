import type { SiteWorldId } from "./types"

/**
 * Where the shared header's links go from THIS build — the one module that
 * reads the origins (build-time, like every VITE_*):
 *
 *   - VITE_HOME_URL   — the wordmark's target (the home page);
 *   - VITE_TOOLS_URL  — the origin serving the five simple worlds
 *                       (`/image`, `/video`, `/music`, `/trends`, `/ads`);
 *   - VITE_STUDIO_URL — Studio.
 *
 * Unset, the header keeps its own canonical targets (it ships them), so a
 * production build needs none of these; a preview points each at its matching
 * preview host. The App is the world on screen: its tab is this page's own
 * `/projects` (no redirect through `/`), so a preview stays on itself.
 */

export interface SiteEnv {
  readonly home?: string
  readonly tools?: string
  readonly studio?: string
}

type RawEnv = Readonly<Record<string, string | undefined>>

/** An http(s) origin-like base, trimmed and without trailing slashes; anything else → undefined. */
function base(value: string | undefined): string | undefined {
  const trimmed = value?.trim().replace(/\/+$/, "")
  if (!trimmed) return undefined
  try {
    const url = new URL(trimmed)
    return url.protocol === "https:" || url.protocol === "http:" ? trimmed : undefined
  } catch {
    return undefined
  }
}

/** This build's values, each read by name (Vite inlines them; the Dockerfile sync test finds them so). */
const BUILD_ENV: RawEnv = {
  VITE_HOME_URL: import.meta.env.VITE_HOME_URL,
  VITE_TOOLS_URL: import.meta.env.VITE_TOOLS_URL,
  VITE_STUDIO_URL: import.meta.env.VITE_STUDIO_URL,
}

export function readSiteEnv(env: RawEnv = BUILD_ENV): SiteEnv {
  const entries = [
    ["home", base(env.VITE_HOME_URL)],
    ["tools", base(env.VITE_TOOLS_URL)],
    ["studio", base(env.VITE_STUDIO_URL)],
  ] as const
  return Object.fromEntries(entries.filter(([, value]) => value !== undefined)) as SiteEnv
}

const SIMPLE_WORLDS = ["image", "video", "music", "trends", "ads"] as const

/** The header's world links for a page on `here` (an origin). */
export function worldHrefsFor(here: string, site: SiteEnv): Partial<Record<SiteWorldId, string>> {
  const simple = site.tools ? Object.fromEntries(SIMPLE_WORLDS.map((world) => [world, `${site.tools}/${world}`])) : {}
  const studio = site.studio ? { studio: `${site.studio}/` } : {}
  return { ...simple, ...studio, app: `${here.replace(/\/+$/, "")}/projects` }
}

/** The wordmark's target, or undefined for the header's own default. */
export function headerHomeUrl(site: SiteEnv): string | undefined {
  return site.home
}
