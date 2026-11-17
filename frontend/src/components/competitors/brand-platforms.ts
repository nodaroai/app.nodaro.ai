import type { ActionCard, CompetitorDetail, CompetitorPlatformTally, CompetitorPost, SocialPlatform, SocialPost, TrackedCompetitor } from "@nodaro/shared/social"
import { MATRIX_PLATFORMS } from "./platform-matrix"

/**
 * The brand window's view of one brand's latest scan, platform by platform.
 * Pure, so the window and its tests share it.
 */

/**
 * The scan's tallies in the page's platform order, on the platforms the page
 * can show (a platform the server knows and this page does not yet is left
 * out, never drawn without a name). A server older than the tallies sends
 * none: then each platform the scan has posts on is counted from its posts,
 * with nothing known about its searches.
 */
export function brandTallies(detail: Pick<CompetitorDetail, "platforms" | "latestScan">): CompetitorPlatformTally[] {
  const known = detail.platforms
  return MATRIX_PLATFORMS.flatMap((platform): CompetitorPlatformTally[] => {
    if (known) return known.filter((p) => p.platform === platform).slice(0, 1)
    const posts = (detail.latestScan?.posts ?? []).filter((p) => p.platform === platform)
    const own = posts.filter((p) => p.role === "own").length
    const about = posts.filter((p) => p.role === "about").length
    return own + about > 0 ? [{ platform, own, about, searched: [], failed: null, usual: null, unit: null, top: null }] : []
  })
}

/** Every search the scan ran there failed. */
export function allFailed(tally: CompetitorPlatformTally): boolean {
  return tally.searched.length > 0 && tally.searched.every((kind) => (tally.failed ?? []).includes(kind))
}

/** What the scan reads there: the brand's account (own posts), its name (posts about it). */
export function readsOf(tally: CompetitorPlatformTally): { readonly own: boolean; readonly about: boolean } {
  return { own: tally.searched.includes("own") || tally.own > 0, about: tally.searched.includes("about") || tally.about > 0 }
}

/** A post's reach, for ordering a grid: views, else points, else likes. */
export function reachOf(post: Pick<SocialPost, "metrics">): number {
  return post.metrics.views ?? post.metrics.score ?? post.metrics.likes ?? 0
}

/**
 * The terms the brand's searches for posts about it use, as the next scan
 * runs them: the plan's when the server names them (only the ones the plan
 * allows), else the brand's own. Empty when the brand has none: its name is
 * searched.
 */
export function aboutTermsOf(c: Pick<TrackedCompetitor, "searchPlan" | "searchTerms">): string[] {
  const own = c.searchTerms ?? []
  if (own.length === 0) return []
  const planned = (c.searchPlan ?? []).flatMap((s) => (s.kind === "about" && s.term ? [s.term] : []))
  return [...new Set(planned.length > 0 ? planned : own)]
}

/** The scan's posts on a platform with a role, most reached first. */
export function postsOn(detail: Pick<CompetitorDetail, "latestScan">, platform: SocialPlatform, role: "own" | "about"): CompetitorPost[] {
  return (detail.latestScan?.posts ?? []).filter((p) => p.platform === platform && p.role === role).sort((a, b) => reachOf(b) - reachOf(a))
}

/**
 * The brand's cards about what people say on a platform: complaints and
 * mentions with a post there, a post about it spreading there.
 */
export function aboutCardsOn(cards: readonly ActionCard[], posts: Readonly<Record<string, CompetitorPost>>, subjectId: string, platform: SocialPlatform): ActionCard[] {
  return cards.filter((card) => {
    if (card.subjectId !== subjectId) return false
    if (card.kind === "spreading") return card.params.platform === platform
    if (card.kind === "complaints" || card.kind === "mentions_up") return card.evidence.some((id) => posts[id]?.platform === platform)
    return false
  })
}
