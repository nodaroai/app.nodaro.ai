"use client"

import type { MouseEvent } from "react"
import type { SocialPost } from "@nodaro/shared"
import { MetaAdMedia } from "@/components/nodes/meta-ad-media"
import { useT } from "@/lib/i18n"
import { whoOf } from "./social-post-card"

const stop = (e: MouseEvent) => e.stopPropagation()

/**
 * One post on the Social Search node: its still, or (a text post, like most
 * of Reddit) its first words and who wrote it. A click opens the whole post.
 */
export function SocialPostTile({ post, onRead }: { readonly post: SocialPost; readonly onRead: (post: SocialPost) => void }) {
  const t = useT()
  const still = post.media.thumbnailUrl ?? post.author.avatarUrl ?? null
  const words = (post.title || post.text).replace(/\s+/g, " ").trim()
  return (
    <button
      type="button"
      onClick={(e) => {
        stop(e)
        onRead(post)
      }}
      onMouseDown={stop}
      aria-label={`${t("social.readPost")}: ${whoOf(post)}`}
      title={t("social.readPost")}
      className="nodrag block w-full rounded-lg text-start outline-none focus-visible:ring-2 focus-visible:ring-[#FF0073]"
    >
      {still || !words ? (
        <MetaAdMedia src={still} initial={(post.author.handle || post.author.name || "?").charAt(0).toUpperCase()} className="aspect-[3/4] w-full rounded-lg" />
      ) : (
        <span className="flex aspect-[3/4] w-full flex-col justify-between gap-1 overflow-hidden rounded-lg border border-[var(--meta-ads-border)] bg-[var(--meta-ads-surface-3)] p-2">
          <span className="line-clamp-6 text-[11px] font-semibold leading-snug text-[var(--meta-ads-text)]" dir="auto">
            {words}
          </span>
          <span className="truncate text-[10px] font-bold text-[var(--meta-ads-muted)]" dir="auto">
            {whoOf(post)}
          </span>
        </span>
      )}
    </button>
  )
}
