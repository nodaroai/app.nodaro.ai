"use client"

import { ExternalLink, Eye, Heart, MessageCircle, Pencil, ThumbsUp, Trash2 } from "lucide-react"
import { normalizeSavedPostTags, socialSearchPlatform, type SavedPost } from "@nodaro/shared"
import { MetaAdMedia } from "@/components/nodes/meta-ad-media"
import { useT } from "@/lib/i18n"
import { formatDate } from "@/lib/i18n/format"
import { cn } from "@/lib/utils"
import { SOCIAL_PLATFORM_META } from "./social-platforms"
import { Metric, adDays, initialOf, socialPostLink, whoOf } from "./social-post-card"

/**
 * The still the wall shows: the copy in the person's storage, else the
 * platform's own link (which expires within days), else the author's picture.
 */
export function savedPostStill(save: SavedPost): string | null {
  return save.thumbnailUrl ?? save.post.media.thumbnailUrl ?? save.post.author.avatarUrl ?? null
}

/** Tags as typed in the edit box: comma separated (in any script), stored the server's way. */
export function parseTagInput(text: string): string[] {
  return normalizeSavedPostTags([text])
}

/** One save on the inspiration wall: the post as it was saved, the person's note and tags. */
export function SavedPostCard({
  save,
  now,
  busy,
  onEdit,
  onRemove,
  onTag,
}: {
  readonly save: SavedPost
  readonly now: number
  readonly busy?: boolean
  readonly onEdit: () => void
  readonly onRemove: () => void
  /** Show only the saves with this tag. */
  readonly onTag: (tag: string) => void
}) {
  const t = useT()
  const post = save.post
  const meta = SOCIAL_PLATFORM_META[socialSearchPlatform(save.platform)]
  const m = post.metrics
  const link = socialPostLink(post)
  const words = (post.title || post.text).replace(/\s+/g, " ").trim()
  const days = adDays(post, now)
  const portrait = post.media.aspect === "9:16"
  return (
    <article className="flex flex-col overflow-hidden rounded-xl border border-[var(--meta-ads-border)] bg-[var(--meta-ads-surface-2)]">
      <MetaAdMedia src={savedPostStill(save)} initial={initialOf(post)} className={cn("w-full", portrait ? "aspect-[3/4]" : "aspect-video")}>
        <span className="absolute start-1.5 top-1.5 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10.5px] font-bold text-white">
          {meta.icon("h-3 w-3")}
          {meta.name}
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
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] font-semibold text-[var(--meta-ads-muted)]">
          {m.views !== undefined && <Metric icon={<Eye className="h-3.5 w-3.5" />} value={m.views} label={t("social.metricViews")} />}
          {m.score !== undefined && <Metric icon={<ThumbsUp className="h-3.5 w-3.5" />} value={m.score} label={t("social.metricPoints")} />}
          {m.likes !== undefined && <Metric icon={<Heart className="h-3.5 w-3.5" />} value={m.likes} label={t("social.metricLikes")} />}
          {m.comments !== undefined && <Metric icon={<MessageCircle className="h-3.5 w-3.5" />} value={m.comments} label={t("social.metricComments")} />}
          {days !== null && <span>{days === 1 ? t("social.adRunningOne") : t("social.adRunning", { days })}</span>}
        </div>
        {save.note && (
          <p className="whitespace-pre-line rounded-md bg-background/70 px-2 py-1.5 text-[12px] leading-[1.45] text-foreground" dir="auto">
            {save.note}
          </p>
        )}
        {save.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {save.tags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => onTag(tag)}
                className="rounded-full border border-[var(--meta-ads-border)] px-2 py-0.5 text-[11px] font-semibold text-[var(--meta-ads-text-2)] hover:border-[#FF0073] hover:text-[#FF0073]"
                dir="auto"
              >
                #{tag}
              </button>
            ))}
          </div>
        )}
        <div className="mt-auto flex items-center gap-1 pt-1 text-[11.5px] font-semibold text-[var(--meta-ads-muted)]">
          <span className="me-auto" title={formatDate(Date.parse(save.createdAt), { dateStyle: "medium" })}>
            {t("inspiration.savedOn", { date: formatDate(Date.parse(save.createdAt), { month: "short", day: "numeric" }) })}
          </span>
          {link && (
            <a href={link} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 px-1 text-[#FF0073] hover:underline">
              {t("social.openPost")} <ExternalLink className="h-3 w-3" />
            </a>
          )}
          <button
            type="button"
            onClick={onEdit}
            disabled={busy}
            aria-label={t("inspiration.edit")}
            title={t("inspiration.edit")}
            className="rounded-md p-1 hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onRemove}
            disabled={busy}
            aria-label={t("inspiration.remove")}
            title={t("inspiration.remove")}
            className="rounded-md p-1 hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </article>
  )
}

