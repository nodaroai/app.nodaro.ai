import type { SiteWorldId } from "./types"

/**
 * Where the shared header's links go from a build, given its origins
 * (build-time, like every VITE_*):
 *
 *   - VITE_HOME_URL   — the wordmark's target (the home page);
 *   - VITE_TOOLS_URL  — the origin serving Explore and the simple worlds
 *                       (`/explore`, `/image`, `/video`, `/music`, `/trends`,
 *                       Nodaro Motion `/video/cast-swap`, Voice Changer
 *                       `/voice-changer`);
 *   - VITE_STUDIO_URL — Studio.
 *
 * Unset, the header keeps its own canonical targets (it ships them), so a
 * production build needs none of these; a preview points each at its matching
 * preview host. The App is the world on screen: its tab is this page's own
 * `/projects` (no redirect through `/`), so a preview stays on itself.
 *
 * No `import.meta.env` here: the build itself (`header-module-plugin.ts`)
 * runs this too, to publish where the links go (`siteWorldsFile`); the page
 * passes its build's values (`app-header.tsx`).
 */

export interface SiteEnv {
  readonly home?: string
  readonly tools?: string
  readonly studio?: string
}

export type RawEnv = Readonly<Record<string, string | undefined>>

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

export function readSiteEnv(env: RawEnv): SiteEnv {
  const entries = [
    ["home", base(env.VITE_HOME_URL)],
    ["tools", base(env.VITE_TOOLS_URL)],
    ["studio", base(env.VITE_STUDIO_URL)],
  ] as const
  return Object.fromEntries(entries.filter(([, value]) => value !== undefined)) as SiteEnv
}

/** The worlds the tools origin serves, at the paths the header's canonical links use (Ads is no longer drawn). */
const SIMPLE_WORLDS = [
  ["explore", "/explore"],
  ["image", "/image"],
  ["video", "/video"],
  ["music", "/music"],
  ["trends", "/trends"],
  ["motion", "/video/cast-swap"],
  ["voice", "/voice-changer"],
] as const

/** The header's world links for a page on `here` (an origin; `""`: the page's own, as paths). */
export function worldHrefsFor(here: string, site: SiteEnv): Partial<Record<SiteWorldId, string>> {
  const simple = site.tools ? Object.fromEntries(SIMPLE_WORLDS.map(([world, path]) => [world, `${site.tools}${path}`])) : {}
  const studio = site.studio ? { studio: `${site.studio}/` } : {}
  return { ...simple, ...studio, app: `${here.replace(/\/+$/, "")}/projects` }
}

/**
 * What the built site publishes at `/shell-worlds.json` (read by the admin's
 * Header versions page): where its worlds row leads — the same links the
 * header gets, the App's as a path on the site itself — and whether the row
 * is shown at all (`shown`: the build carries the header; the App never hides
 * the row). Like `/shell-version.json`'s `header`, that is the build's
 * answer: a page can still leave the header out at run time
 * (`sharedHeaderActive()`).
 */
export function siteWorldsFile(site: SiteEnv, shown: boolean): string {
  return `${JSON.stringify({ worldsRow: shown, worldHrefs: shown ? worldHrefsFor("", site) : {} }, null, 2)}\n`
}

/** The wordmark's target, or undefined for the header's own default. */
export function headerHomeUrl(site: SiteEnv): string | undefined {
  return site.home
}
