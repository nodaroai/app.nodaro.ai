import type { SiteWorldId } from "./types"

/**
 * Where each world lives on a white-label site: the same site, by path, never
 * a build's origins (`VITE_*` name Nodaro's hosts). The worlds app's own
 * addresses, Voice Changer's mount and this app's projects — the addresses the
 * worlds app's own white-label header links, so both headers on such a site
 * lead to the same pages. Explore has none (it is Nodaro's own showcase) and
 * neither has Studio (not served there): the header draws a world only with
 * an address, so it draws neither.
 */
export const WHITE_LABEL_WORLD_PATHS: Readonly<Partial<Record<SiteWorldId, `/${string}`>>> = Object.freeze({
  image: "/image",
  video: "/video",
  music: "/music",
  trends: "/trends",
  motion: "/video/nodaro-motion",
  voice: "/voice-changer",
  app: "/projects",
})
