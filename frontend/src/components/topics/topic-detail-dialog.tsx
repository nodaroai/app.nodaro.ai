"use client"

import { useMemo } from "react"
import { Loader2 } from "lucide-react"
import type { TopicScan, TrackedTopic } from "@nodaro/shared/social"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { SaveControls } from "@/components/competitors/action-card-view"
import { useSaveControls } from "@/components/competitors/use-save-controls"
import { useTopicDetail } from "@/hooks/queries/use-topics-queries"
import { useT } from "@/lib/i18n"
import { formatDate } from "@/lib/i18n/format"
import { TopicCardsSection, TopicPostsSection, TopicSection } from "./topic-detail-sections"
import { TopicHistoryTable } from "./topic-history-table"
import { asAboutPosts, postsByReach } from "./topic-posts"
import { TopicScanButton } from "./topic-row"

/** The window's head: the topic's name, its latest scan, its term when it differs, and the scan button. */
function TopicDetailHeader({
  topic,
  scan,
  busy,
  blockedWhy,
  onScan,
}: {
  readonly topic: TrackedTopic | null
  readonly scan: TopicScan | null
  readonly busy: boolean
  readonly blockedWhy: string | null
  readonly onScan: (topic: TrackedTopic) => void
}) {
  const t = useT()
  const found = scan ? (scan.counts.posts === 1 ? t("topics.postsFoundOne") : t("topics.postsFound", { n: scan.counts.posts })) : ""
  return (
    <DialogHeader className="flex-row flex-wrap items-start justify-between gap-3 border-b border-border px-6 pb-4 pt-6 text-start">
      <div className="flex min-w-0 flex-col gap-1">
        <DialogTitle className="truncate text-[20px]" dir="auto">
          {topic?.name ?? ""}
        </DialogTitle>
        <DialogDescription className="text-[14px]">
          {scan ? t("topics.scanLine", { date: formatDate(Date.parse(scan.at), { month: "short", day: "numeric" }), posts: found }) : ""}
        </DialogDescription>
        {topic && topic.term !== topic.name && (
          <span dir="auto" className="self-start rounded-full bg-muted px-2 py-0.5 text-[12px] font-semibold text-foreground/80">
            {topic.term}
          </span>
        )}
      </div>
      {topic && (
        <div className="me-8 shrink-0">
          <TopicScanButton topic={topic} busy={busy} blockedWhy={blockedWhy} onScan={() => onScan(topic)} />
        </div>
      )}
    </DialogHeader>
  )
}

/** What the topic's latest scan found: its cards and its posts; or that it could not be read, or has no scan yet. */
function LatestScanSections({
  topic,
  scan,
  failed,
  save,
}: {
  readonly topic: TrackedTopic | null
  readonly scan: TopicScan | null
  /** The topic could not be read. */
  readonly failed: boolean
  readonly save: SaveControls
}) {
  const t = useT()
  const posts = useMemo(() => postsByReach(scan?.posts ?? []), [scan])
  const byId = useMemo(() => asAboutPosts(scan?.posts ?? []), [scan])
  if (failed) return <p className="py-12 text-center text-sm text-destructive">{t("apiErr.loadTopic")}</p>
  if (!scan) return <p className="py-12 text-center text-sm text-muted-foreground">{t("topics.neverScanned")}</p>
  return (
    <>
      <TopicCardsSection name={topic?.name ?? null} cards={scan.cards} byId={byId} save={save} />
      {/* Keyed by the topic: another topic starts with its first posts, nothing open, a fresh clock. */}
      <TopicPostsSection key={topic?.id} listId={`topic-posts-${topic?.id ?? ""}`} posts={posts} byId={byId} save={save} />
    </>
  )
}

/** One topic: its cards, the posts its latest scan kept (most reached first), and its scans over time. */
export function TopicDetailDialog({
  topic,
  busy,
  blockedWhy,
  onScan,
  onOpenChange,
}: {
  /** The topic shown; null keeps the window closed. */
  readonly topic: TrackedTopic | null
  readonly busy: boolean
  /** Why the plan does not let this topic scan now; null when it does. */
  readonly blockedWhy: string | null
  readonly onScan: (topic: TrackedTopic) => void
  readonly onOpenChange: (open: boolean) => void
}) {
  const t = useT()
  const detail = useTopicDetail(topic?.id ?? null)
  const shown = detail.data ?? topic
  const scan = detail.data?.latestScan ?? null
  const postIds = useMemo(() => (scan?.posts ?? []).map((p) => p.id), [scan])
  // Saved to Inspiration under the Competitors source: a topic is followed on the same page family.
  const save = useSaveControls(postIds, "competitors")

  return (
    <Dialog open={topic !== null} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-0 p-0 sm:max-w-[1000px]">
        <TopicDetailHeader topic={shown} scan={scan} busy={busy} blockedWhy={blockedWhy} onScan={onScan} />
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 pb-7 pt-5">
          {detail.isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <LatestScanSections topic={shown} scan={scan} failed={detail.isError && !detail.data} save={save} />
          )}
          {topic && (
            <TopicSection title={t("competitors.postsPerScan")}>
              <TopicHistoryTable topicId={topic.id} />
            </TopicSection>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
