import { isNotFound, linkFace } from "./link-face"
import type { LinkAnswer } from "./types"

/** The sites a set of links leads to, and how each site's pages answered, for the worlds figure. */

export type HostTone = "ok" | "bad" | "unchecked"

export const HOST_LOOK: Record<HostTone, { frame: string; said: string }> = {
  ok: { frame: "border-emerald-600/60 bg-emerald-500/10", said: "Every page here answers" },
  bad: { frame: "border-destructive/60 bg-destructive/10", said: "Pages not found here" },
  unchecked: { frame: "border-amber-600/60 bg-amber-500/10", said: "Some pages could not be checked" },
}

/** The links grouped by the site their address leads to, in the order given. */
export function byHost<T extends { readonly href: string }>(links: readonly T[]): { host: string; links: T[] }[] {
  const hosts = new Map<string, T[]>()
  for (const link of links) {
    const host = new URL(link.href).host
    hosts.set(host, [...(hosts.get(host) ?? []), link])
  }
  return [...hosts].map(([host, rows]) => ({ host, links: rows }))
}

export function hostTone(links: readonly { readonly answer: LinkAnswer }[]): HostTone {
  if (links.some((link) => isNotFound(link.answer))) return "bad"
  return links.every((link) => linkFace(link.answer).tone === "newest") ? "ok" : "unchecked"
}

/** An address's path as the figure shows it; the site's own root shows as "/". */
export const pathOf = (href: string) => new URL(href).pathname
