"use client"

import type { KeyboardEvent, MouseEvent, ReactNode } from "react"
import { Check, ExternalLink, Eye, Heart, MessageCircle, Play, ThumbsUp } from "lucide-react"
import type { SocialPost } from "@nodaro/shared"
import { MetaAdMedia } from "@/components/nodes/meta-ad-media"
import { useT } from "@/lib/i18n"
import { formatDate, formatNumber } from "@/lib/i18n/format"
import { cn } from "@/lib/utils"

const stop = (e: MouseEvent | KeyboardEvent) => e.stopPropagation()

/** The post's page, only when it is http(s): post data is untrusted input. */
export function socialPostLink(post: SocialPost): string | null {
  try {
    const u = new URL(post.url)
    return u.protocol === "http:" || u.protocol === "https:" ? post.url : null
  } catch {
    return null
  }
}

function initialOf(post: SocialPost): string {
  const who = (post.author.handle || post.author.name || post.container || "?").replace(/^@/, "").trim()
  return who ? who.charAt(0).toUpperCase() : "?"
}

function whoOf(post: SocialPost): string {
  if (post.author.handle) return `@${post.author.handle.replace(/^@/, "")}`
  return post.author.name || post.container || ""
}

function adDays(post: SocialPost, now: number): number | null {
  if (post.platform !== "meta_ads" || !post.publishedAt) return null
  const start = Date.parse(post.publishedAt)
  if (Number.isNaN(start)) return null
  const ended = typeof post.extra.endedAt === "string" && post.extra.active !== true ? Date.parse(post.extra.endedAt) : NaN
  return Math.max(0, Math.round(((Number.isNaN(ended) ? now : ended) - start) / 86_400_000))
}

function Metric({ icon, value, label }: { readonly icon: ReactNode; readonly value: number; readonly label: string }) {
  return (
    <span className="flex items-center gap-1" title={label}>
      <span className="sr-only">{label}</span>
      {icon}
      {formatNumber(value)}
    </span>
  )
}

/**
 * One post in the picker grid: its still, who posted it, when, its numbers,
 * the first words — and a pick toggle. Clicking anywhere on the card toggles
 * the pick; the link opens the post in a new tab without toggling.
 */
export function SocialPostCard({
  post,
  picked,
  order,
  onToggle,
  now,
}: {
  readonly post: SocialPost
  readonly picked: boolean
  /** 1-based position among the picks, shown on the badge. */
  readonly order?: number
  readonly onToggle: () => void
  readonly now: number
}) {
  const t = useT()
  const m = post.metrics
  const link = socialPostLink(post)
  const words = (post.title || post.text).replace(/\s+/g, " ").trim()
  const days = adDays(post, now)
  const variants = typeof post.extra.variants === "number" ? post.extra.variants : 1
  const portrait = post.media.aspect === "9:16"
  return (
    <div
      role="checkbox"
      aria-checked={picked}
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault()
          onToggle()
        }
      }}
      className={cn(
        "group flex cursor-pointer flex-col overflow-hidden rounded-xl border bg-[var(--meta-ads-surface-2)] text-start outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-[#FF0073]",
        picked ? "border-[#FF0073] ring-1 ring-[#FF0073]" : "border-[var(--meta-ads-border)] hover:border-[var(--meta-ads-accent-border)]",
      )}
    >
      <MetaAdMedia
        src={post.media.thumbnailUrl ?? post.author.avatarUrl ?? null}
        initial={initialOf(post)}
        className={cn("w-full", portrait ? "aspect-[3/4]" : "aspect-video")}
      >
        {post.media.kind === "video" && (
          <span className="absolute bottom-1.5 start-1.5 flex items-center gap-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[10.5px] font-bold text-white">
            <Play className="h-3 w-3" />
            {typeof post.media.durationSec === "number" ? `${Math.round(post.media.durationSec)}s` : ""}
          </span>
        )}
        <span
          className={cn(
            "absolute end-1.5 top-1.5 flex h-6 min-w-6 items-center justify-center rounded-full border text-[11px] font-extrabold transition-colors",
            picked ? "border-[#FF0073] bg-[#FF0073] px-1.5 text-white" : "border-white/80 bg-black/30 text-transparent group-hover:text-white/80",
          )}
          aria-hidden
        >
          {picked && order ? order : <Check className="h-3.5 w-3.5" />}
        </span>
      </MetaAdMedia>
      <div className="flex flex-1 flex-col gap-1.5 p-2.5">
        <div className="flex items-center justify-between gap-2 text-[12px] font-bold text-[var(--meta-ads-text)]">
          <span className="truncate">{whoOf(post)}</span>
          {post.publishedAt && (
            <span className="shrink-0 text-[11px] font-semibold text-[var(--meta-ads-muted)]">
              {formatDate(Date.parse(post.publishedAt), { month: "short", day: "numeric" })}
            </span>
          )}
        </div>
        {words && <p className="line-clamp-3 text-[12px] leading-[1.45] text-[var(--meta-ads-text-2)]" dir="auto">{words}</p>}
        <div className="mt-auto flex flex-wrap items-center gap-x-2.5 gap-y-1 pt-1 text-[11.5px] font-semibold text-[var(--meta-ads-muted)]">
          {m.views !== undefined && <Metric icon={<Eye className="h-3.5 w-3.5" />} value={m.views} label={t("social.metricViews")} />}
          {m.score !== undefined && <Metric icon={<ThumbsUp className="h-3.5 w-3.5" />} value={m.score} label={t("social.metricPoints")} />}
          {m.likes !== undefined && <Metric icon={<Heart className="h-3.5 w-3.5" />} value={m.likes} label={t("social.metricLikes")} />}
          {m.comments !== undefined && <Metric icon={<MessageCircle className="h-3.5 w-3.5" />} value={m.comments} label={t("social.metricComments")} />}
          {days !== null && <span>{days === 1 ? t("social.adRunningOne") : t("social.adRunning", { days })}</span>}
          {variants > 1 && <span>{t("social.adVersions", { n: variants })}</span>}
          {link && (
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              onClick={stop}
              onKeyDown={stop}
              className="ms-auto flex items-center gap-1 text-[#FF0073] hover:underline"
            >
              {t("social.openPost")} <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
