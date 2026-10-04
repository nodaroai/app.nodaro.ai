"use client"

import { useEffect, useMemo, useState } from "react"
import { Loader2 } from "lucide-react"
import type { CompetitorPost } from "@nodaro/shared"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { SocialPostCard } from "@/components/research/social-post-card"
import { useCompetitorDetail } from "@/hooks/queries/use-competitors-queries"
import { useT } from "@/lib/i18n"
import { formatDate } from "@/lib/i18n/format"
import { cn } from "@/lib/utils"
import { useSaveControls } from "./use-save-controls"
import { CompetitorLessons } from "./competitor-lessons"

export type CompetitorDialogTab = "own" | "about" | "lessons"

/** The posts a brand's last scan found (theirs, and the ones about them), and what works for it. */
export function CompetitorPostsDialog({
  competitorId,
  initialTab = "own",
  onOpenChange,
}: {
  /** The brand to show; null keeps the dialog closed. */
  readonly competitorId: string | null
  /** The tab it opens on. */
  readonly initialTab?: CompetitorDialogTab
  readonly onOpenChange: (open: boolean) => void
}) {
  const t = useT()
  const detail = useCompetitorDetail(competitorId)
  const [tab, setTab] = useState<CompetitorDialogTab>(initialTab)
  // Each opening starts on the tab it was opened for.
  useEffect(() => {
    if (competitorId) setTab(initialTab)
  }, [competitorId, initialTab])
  const [now] = useState(() => Date.now())
  const scan = detail.data?.latestScan ?? null
  const posts = useMemo(() => (scan?.posts ?? []).filter((p: CompetitorPost) => p.role === tab), [scan, tab])
  const postIds = useMemo(() => (scan?.posts ?? []).map((p) => p.id), [scan])
  const save = useSaveControls(postIds, "competitors")

  return (
    <Dialog open={competitorId !== null} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-3 sm:max-w-[1040px]">
        <DialogHeader>
          <DialogTitle dir="auto">{detail.data?.brand ?? ""}</DialogTitle>
          <DialogDescription>
            {scan ? t("competitors.postsHint", { date: formatDate(Date.parse(scan.at), { month: "short", day: "numeric" }) }) : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-1 self-start rounded-lg border p-0.5 text-[12px] font-bold">
          {(["own", "about", "lessons"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn("rounded-md px-2.5 py-1.5", key === tab ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {key === "own"
                ? t("competitors.tabOwn", { n: scan?.counts.own ?? 0 })
                : key === "about"
                  ? t("competitors.tabAbout", { n: scan?.counts.about ?? 0 })
                  : t(detail.data?.isOwn ? "competitors.tabLessonsOwn" : "competitors.tabLessons")}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === "lessons" && competitorId ? (
            <CompetitorLessons competitorId={competitorId} isOwn={detail.data?.isOwn === true} />
          ) : detail.isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : detail.error ? (
            <p className="py-12 text-center text-sm text-destructive">{t("apiErr.loadCompetitorPosts")}</p>
          ) : posts.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">{t("competitors.noPosts")}</p>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
              {posts.map((post) => (
                <SocialPostCard
                  key={post.id}
                  post={post}
                  now={now}
                  saved={save.isSaved(post.id)}
                  saveBusy={save.isBusy(post.id)}
                  onToggleSave={() => save.toggle(post)}
                />
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
