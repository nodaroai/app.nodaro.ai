// A post's picture and player. The platform's own still is a signed link that
// expires within days, so a still that fails to load falls back to one that
// does not (YouTube's public thumbnail), and then to a plain card. The player
// is the platform's own (`embedUrl`), asked to start on its own where the
// platform allows it.

import { useState } from "react"
import type { TrendCandidatePlatform, TrendCandidatePost } from "@nodaro/sdk/trend-radar"
import { Play } from "lucide-react"
import { cn } from "@/lib/utils"
import { platformName } from "./format"

const YOUTUBE_EMBED = /^https:\/\/www\.youtube\.com\/embed\/([A-Za-z0-9_-]{6,20})$/
const TIKTOK_EMBED = /^https:\/\/www\.tiktok\.com\/embed\/v2\/(\d{5,25})$/

function youtubeId(post: TrendCandidatePost): string | null {
  return post.embedUrl ? (YOUTUBE_EMBED.exec(post.embedUrl)?.[1] ?? null) : null
}

/** The stills to try, in order: the platform's own, then one that does not expire. */
export function stillCandidates(post: TrendCandidatePost | null): string[] {
  if (!post) return []
  const list: string[] = []
  if (post.stillUrl && /^https:\/\//i.test(post.stillUrl)) list.push(post.stillUrl)
  const yt = youtubeId(post)
  if (yt) list.push(`https://i.ytimg.com/vi/${yt}/hqdefault.jpg`)
  return list
}

/**
 * The player's address. TikTok's newer player and YouTube start on their own
 * and loop; Instagram's embed has no such switch and is used as it is.
 */
export function playerUrl(post: TrendCandidatePost): string | null {
  const embed = post.embedUrl
  if (!embed) return null
  const tt = TIKTOK_EMBED.exec(embed)
  if (tt) return `https://www.tiktok.com/player/v1/${tt[1]}?autoplay=1&loop=1&rel=0&description=1&music_info=1`
  const yt = YOUTUBE_EMBED.exec(embed)
  if (yt) return `${embed}?autoplay=1&loop=1&playlist=${yt[1]}&rel=0&playsinline=1`
  return embed
}

export const PLATFORM_CHIP: Record<TrendCandidatePlatform, { short: string; className: string }> = {
  tiktok: { short: "TikTok", className: "bg-black text-white" },
  instagram: { short: "Instagram", className: "bg-gradient-to-r from-[#f58529] via-[#dd2a7b] to-[#8134af] text-white" },
  youtube: { short: "YouTube", className: "bg-[#ff0000] text-white" },
}

export function PlatformChip({ platform, className }: { platform: TrendCandidatePlatform; className?: string }) {
  const chip = PLATFORM_CHIP[platform]
  return (
    <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold leading-none", chip.className, className)} title={platformName(platform)}>
      {chip.short}
    </span>
  )
}

/** The post's still, falling back down `stillCandidates`, then to a plain card naming the platform. */
export function PostStill({ post, alt, className }: { post: TrendCandidatePost | null; alt: string; className?: string }) {
  const candidates = stillCandidates(post)
  const [failed, setFailed] = useState(0)
  const src = candidates[failed]
  if (!src) {
    return (
      <div className={cn("flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-b from-muted to-muted/40 text-muted-foreground", className)}>
        <Play className="h-8 w-8 opacity-60" aria-hidden="true" />
        <span className="text-xs">{post ? platformName(post.platform) : "No post yet"}</span>
      </div>
    )
  }
  return (
    <img
      key={src}
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed((n) => n + 1)}
      className={cn("h-full w-full object-cover", className)}
    />
  )
}

/** The platform's player for one post, or the still with a link out when it has none. */
export function PostPlayer({ post, title }: { post: TrendCandidatePost; title: string }) {
  const src = playerUrl(post)
  if (!src) {
    return (
      <div className="relative h-full w-full">
        <PostStill post={post} alt={title} />
        <span className="absolute inset-x-0 bottom-3 text-center text-xs text-white drop-shadow">This post has no player; open it on {platformName(post.platform)}.</span>
      </div>
    )
  }
  return (
    <iframe
      key={src}
      src={src}
      title={title}
      className="h-full w-full bg-black"
      sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"
      allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
      referrerPolicy="no-referrer"
    />
  )
}
