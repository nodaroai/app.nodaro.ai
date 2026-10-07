"use client"

import { Fragment, useState, type MouseEvent, type ReactNode } from "react"
import { ChevronLeft, ChevronRight, ExternalLink, Eye, Play } from "lucide-react"
import { useT } from "@/lib/i18n"
import { getVideoProxyUrl } from "@/lib/api"
import { cn } from "@/lib/utils"
import { InspectorShell } from "@/components/inspector/inspector-shell"
import { MetaAdMedia } from "../meta-ad-media"
import type { FeedPost } from "./feed-post"

/**
 * The shared post feed card — the Instagram / Meta Ads card shape, used by
 * every node that reads a list of posts (Telegram Channel Feed, Read
 * Collection, …): the current post featured (picture or video, heading, text,
 * date, a link to the original post), arrows and a thumbnail strip over the
 * rest, and "View all" opening every post in the shared inspector. Each node
 * maps its own data to `FeedPost`; nothing here knows a source shape.
 */

export const POST_FEED_MAX_THUMBS = 10

const stop = (e: MouseEvent) => e.stopPropagation()

/** The muted line's parts, each isolated (an "@handle" keeps its "@" in front right to left), joined by a dot. */
function MetaLine({ parts }: { readonly parts: readonly string[] }) {
  return (
    <>
      {parts.filter(Boolean).map((part, i) => (
        <Fragment key={i}>
          {i > 0 && " · "}
          <bdi>{part}</bdi>
        </Fragment>
      ))}
    </>
  )
}

function FeaturedVideo({ src, poster, onFail }: { readonly src: string; readonly poster: string | null; readonly onFail: () => void }) {
  return (
    <video
      src={getVideoProxyUrl(src)}
      poster={poster ?? undefined}
      controls
      autoPlay
      playsInline
      preload="metadata"
      className="nodrag nopan absolute inset-0 h-full w-full bg-black object-contain"
      onMouseDown={stop}
      onClick={stop}
      onError={onFail}
    />
  )
}

/** "Open in <site>" — only for an http(s) link; a post without one shows no link. */
export function OpenPostLink({ post, className }: { readonly post: FeedPost; readonly className?: string }) {
  const t = useT()
  if (!post.openUrl) return null
  return (
    <a
      href={post.openUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={stop}
      onMouseDown={stop}
      className={cn("flex min-w-0 max-w-[60%] shrink-0 items-center gap-1 text-[#FF0073] hover:underline", className)}
    >
      <span className="truncate">{t("post.openIn", { site: post.site })}</span>
      <ExternalLink className="h-3 w-3 shrink-0" />
    </a>
  )
}

/**
 * The featured picture, or the video once played. Mounted per post (keyed by
 * the caller), so moving to another post never carries a playing video along.
 * A video whose file does not load falls back to "Watch in <site>".
 */
function FeaturedMedia({ post }: { readonly post: FeedPost }) {
  const t = useT()
  const [playing, setPlaying] = useState(false)
  const [unplayable, setUnplayable] = useState(false)
  const { previewUrl } = post
  const file = post.video?.url && !unplayable ? post.video.url : null
  return (
    <div className="relative aspect-[16/10] w-full overflow-hidden rounded-xl">
      {playing && file ? (
        <FeaturedVideo src={file} poster={previewUrl} onFail={() => { setPlaying(false); setUnplayable(true) }} />
      ) : (
        <>
          <MetaAdMedia src={previewUrl} initial={post.initial} className="h-full w-full" />
          {file ? (
            <button
              type="button"
              onClick={(e) => { stop(e); setPlaying(true) }}
              onMouseDown={stop}
              aria-label={t("cfgext.metaAdsPlayVideo")}
              className="absolute inset-0 flex items-center justify-center bg-black/25 transition-colors hover:bg-black/40"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-black"><Play className="h-5 w-5 translate-x-0.5" /></span>
            </button>
          ) : post.video && post.openUrl ? (
            // A video with no file to play here (none given, or it did not load) plays on the post's own page.
            <a
              href={post.openUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={stop}
              onMouseDown={stop}
              className="absolute inset-0 flex items-center justify-center bg-black/25 transition-colors hover:bg-black/40"
            >
              <span className="rounded-full bg-white/90 px-3 py-1.5 text-[12px] font-bold text-black">{t("post.watchIn", { site: post.site })}</span>
            </a>
          ) : null}
        </>
      )}
    </div>
  )
}

function Stat({ children }: { readonly children: ReactNode }) {
  return (
    <span className="flex shrink-0 items-center gap-1 text-[var(--meta-ads-muted)]">
      <Eye className="h-3.5 w-3.5" />
      {children}
    </span>
  )
}

/** The featured post: media, heading and count, text, then the date line with the link. */
export function FeaturedPost({ post }: { readonly post: FeedPost }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-2xl border border-[var(--meta-ads-border)] bg-[var(--meta-ads-surface-2)] p-3">
      {(post.previewUrl || post.video) && <FeaturedMedia key={post.key} post={post} />}
      {(post.heading || post.stat) && (
        <div className="flex items-center justify-between gap-2 text-[12.5px] font-bold text-[var(--meta-ads-text)]">
          <span className="truncate" dir={post.headingDir}>{post.heading}</span>
          {post.stat && <Stat>{post.stat}</Stat>}
        </div>
      )}
      {post.text && (
        <p dir="auto" className="line-clamp-6 whitespace-pre-wrap text-[12.5px] leading-[1.5] text-[var(--meta-ads-text-2)]">{post.text}</p>
      )}
      <div className="flex items-center justify-between gap-2 text-[11.5px] font-semibold text-[var(--meta-ads-muted)]">
        <span className="min-w-0 truncate"><MetaLine parts={post.meta} /></span>
        <OpenPostLink post={post} />
      </div>
    </div>
  )
}

/** Up to ten thumbnails; the featured one is ringed. */
export function ThumbStrip({ posts, featured, onPick }: {
  readonly posts: ReadonlyArray<FeedPost>
  readonly featured: number
  readonly onPick: (i: number) => void
}) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-0.5">
      {posts.slice(0, POST_FEED_MAX_THUMBS).map((post, i) => (
        <button
          key={post.key}
          type="button"
          onClick={(e) => { stop(e); onPick(i) }}
          onMouseDown={stop}
          aria-current={i === featured || undefined}
          className={cn("h-[44px] w-[44px] shrink-0 overflow-hidden rounded-lg transition-all", i === featured ? "ring-2 ring-[#FF0073]" : "opacity-70 hover:opacity-100")}
        >
          <MetaAdMedia src={post.previewUrl} initial={post.initial} className="h-full w-full" initialClassName="text-[13px]" />
        </button>
      ))}
    </div>
  )
}

/** One post in the "all posts" inspector: picture, label and date, the link, heading, text, count. */
export function PostRow({ post }: { readonly post: FeedPost }) {
  return (
    <div className="flex gap-3 rounded-xl border border-border p-3">
      <MetaAdMedia src={post.previewUrl} initial={post.initial} className="h-16 w-16 shrink-0 rounded-lg" initialClassName="text-[15px]" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center justify-between gap-2 text-[11.5px] font-semibold text-muted-foreground">
          <span className="min-w-0 truncate">
            {post.rowLabel && <bdi dir="ltr">{post.rowLabel}</bdi>}
            {post.rowLabel && post.meta.some(Boolean) ? " · " : ""}
            <MetaLine parts={post.meta} />
          </span>
          <OpenPostLink post={post} />
        </div>
        {!post.rowLabel && post.heading && <p dir={post.headingDir} className="text-sm font-semibold leading-snug">{post.heading}</p>}
        {post.text && <p dir="auto" className="whitespace-pre-wrap text-sm leading-relaxed">{post.text}</p>}
        {post.stat && <div className="text-[11px] text-muted-foreground">{post.stat}</div>}
      </div>
    </div>
  )
}

/**
 * The card's body once a run has posts: the featured post, the pager and
 * "View all", the thumbnail strip. The featured index belongs to one run: a
 * new run (another first post, another count) leads with its first post again,
 * in the same render — never a frame of the old index on the new posts.
 */
export function PostFeedBody({ posts, onViewAll }: { readonly posts: ReadonlyArray<FeedPost>; readonly onViewAll: () => void }) {
  const t = useT()
  const run = `${posts[0]?.key ?? ""}:${posts.length}`
  const [pick, setPick] = useState({ run, index: 0 })
  const index = pick.run === run ? Math.min(pick.index, Math.max(0, posts.length - 1)) : 0
  const post = posts[index]
  if (!post) return null
  const show = (i: number) => setPick({ run, index: i })
  const step = (delta: number) => show((index + delta + posts.length) % posts.length)
  return (
    <div className="flex flex-col gap-3">
      <FeaturedPost post={post} />
      <div className="flex items-center gap-2">
        {posts.length > 1 && (
          <>
            <button type="button" onClick={(e) => { stop(e); step(-1) }} onMouseDown={stop} aria-label={t("cfgext.igPrevPost")} className="rounded-full border border-[var(--meta-ads-border)] p-1 text-[var(--meta-ads-muted)] hover:text-[var(--meta-ads-text)]"><ChevronLeft className="h-4 w-4" /></button>
            <span className="text-[11.5px] font-semibold tabular-nums text-[var(--meta-ads-muted)]">{index + 1} / {posts.length}</span>
            <button type="button" onClick={(e) => { stop(e); step(1) }} onMouseDown={stop} aria-label={t("cfgext.igNextPost")} className="rounded-full border border-[var(--meta-ads-border)] p-1 text-[var(--meta-ads-muted)] hover:text-[var(--meta-ads-text)]"><ChevronRight className="h-4 w-4" /></button>
          </>
        )}
        <button type="button" onClick={(e) => { stop(e); onViewAll() }} onMouseDown={stop} className="ms-auto text-[11.5px] font-bold text-[#FF0073] hover:underline">{t("node.viewAllN", { n: posts.length })}</button>
      </div>
      {posts.length > 1 && <ThumbStrip posts={posts} featured={index} onPick={show} />}
    </div>
  )
}

/** Every post of the last run in the shared inspector, with "Copy JSON" of the node's raw output. */
export function PostFeedDialog({ open, onClose, title, icon, meta, copyValue, posts }: {
  readonly open: boolean
  readonly onClose: () => void
  readonly title: ReactNode
  readonly icon?: ReactNode
  readonly meta?: ReactNode
  readonly copyValue?: unknown
  readonly posts: ReadonlyArray<FeedPost>
}) {
  return (
    <InspectorShell open={open} onClose={onClose} title={title} icon={icon} meta={meta} copyValue={copyValue}>
      {posts.map((post) => <PostRow key={post.key} post={post} />)}
    </InspectorShell>
  )
}
