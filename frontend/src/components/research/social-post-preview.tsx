"use client"

import { Copy, ExternalLink, Eye, Heart, MessageCircle, ThumbsUp } from "lucide-react"
import { SOCIAL_PLATFORMS, type SocialPlatform, type SocialPost } from "@nodaro/shared"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { MetaAdMedia } from "@/components/nodes/meta-ad-media"
import { useT } from "@/lib/i18n"
import { formatDate } from "@/lib/i18n/format"
import { copyToClipboard } from "@/lib/utils"
import { SOCIAL_PLATFORM_META } from "./social-platforms"
import { Metric, initialOf, socialPostLink, whoOf } from "./social-post-card"

function platformName(platform: string): string {
  return (SOCIAL_PLATFORMS as readonly string[]).includes(platform) ? SOCIAL_PLATFORM_META[platform as SocialPlatform].name : platform
}

/**
 * One post, whole: who posted it and when, its still, every word, its
 * numbers, and its link, shown as text to open or copy. Opened from a post
 * tile on the Social Search node and from "Read" on a picker card.
 */
export function SocialPostPreview({
  post,
  onOpenChange,
}: {
  /** The post to show; null keeps the window closed. */
  readonly post: SocialPost | null
  readonly onOpenChange: (open: boolean) => void
}) {
  const t = useT()
  const link = post ? socialPostLink(post) : null
  const still = post?.media.thumbnailUrl ?? null
  const m = post?.metrics
  const date = post?.publishedAt && !Number.isNaN(Date.parse(post.publishedAt)) ? formatDate(Date.parse(post.publishedAt), { year: "numeric", month: "short", day: "numeric" }) : ""

  return (
    <Dialog open={post !== null} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-3 sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle dir="auto">{post ? whoOf(post) : ""}</DialogTitle>
          <DialogDescription>{post ? [platformName(post.platform), post.container, date].filter(Boolean).join(" · ") : ""}</DialogDescription>
        </DialogHeader>
        {post && (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pe-1">
            {still && (
              <MetaAdMedia
                src={still}
                initial={initialOf(post)}
                className={post.media.aspect === "9:16" ? "mx-auto aspect-[9/16] max-h-[44vh] rounded-lg" : "aspect-video w-full rounded-lg"}
              />
            )}
            {post.title && (
              <h3 className="text-[15px] font-bold leading-snug" dir="auto">
                {post.title}
              </h3>
            )}
            {post.text && (
              <p className="whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-[var(--meta-ads-text-2)]" dir="auto">
                {post.text}
              </p>
            )}
            {m && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] font-semibold text-muted-foreground">
                {m.views !== undefined && <Metric icon={<Eye className="h-3.5 w-3.5" />} value={m.views} label={t("social.metricViews")} />}
                {m.score !== undefined && <Metric icon={<ThumbsUp className="h-3.5 w-3.5" />} value={m.score} label={t("social.metricPoints")} />}
                {m.likes !== undefined && <Metric icon={<Heart className="h-3.5 w-3.5" />} value={m.likes} label={t("social.metricLikes")} />}
                {m.comments !== undefined && <Metric icon={<MessageCircle className="h-3.5 w-3.5" />} value={m.comments} label={t("social.metricComments")} />}
              </div>
            )}
          </div>
        )}
        {link && (
          <div className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-center">
            <span className="min-w-0 flex-1 select-all break-all text-[12px] text-muted-foreground" dir="ltr">
              {link}
            </span>
            <div className="flex shrink-0 gap-2">
              <Button variant="outline" size="sm" onClick={() => copyToClipboard(link, t("node.urlCopied"))}>
                <Copy className="me-1 h-3.5 w-3.5" />
                {t("cfgshared.copyUrl")}
              </Button>
              <Button size="sm" asChild>
                <a href={link} target="_blank" rel="noopener noreferrer">
                  {t("social.openPost")}
                  <ExternalLink className="ms-1 h-3.5 w-3.5" />
                </a>
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
