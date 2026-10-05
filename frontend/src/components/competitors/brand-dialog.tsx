"use client"

import { useEffect, useMemo, useState } from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"
import { Loader2, Pencil, Radar } from "lucide-react"
import type { ActionCard, CompetitorPost, SocialPlatform, TrackedCompetitor } from "@nodaro/shared"
import { Button } from "@/components/ui/button"
import { CreditCost } from "@/components/ui/credit-cost"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useCardMarks, useCompetitorDetail } from "@/hooks/queries/use-competitors-queries"
import { useT } from "@/lib/i18n"
import { formatDate } from "@/lib/i18n/format"
import { AdviceRecordList } from "./advice-record"
import { BrandPlatformCards, BrandPlatformTable, type BrandPlatformChoice } from "./brand-platform-table"
import { BrandPlatformDetail } from "./brand-platform-detail"
import { brandTallies } from "./brand-platforms"
import { useScanPrice } from "./brand-row-menu"
import { useSaveControls } from "./use-save-controls"

export interface BrandDialogTarget {
  readonly competitor: TrackedCompetitor
  /** The platform it opens on; every platform when none. */
  readonly platform: SocialPlatform | null
}

/** The window's scan button: scan now, with the price the scan is charged. */
function ScanButton({ competitor, busy, onScan }: { readonly competitor: TrackedCompetitor; readonly busy: boolean; readonly onScan: () => void }) {
  const t = useT()
  const credits = useScanPrice(competitor)
  return (
    <Button size="sm" onClick={onScan} disabled={busy || competitor.scanning || competitor.searches === 0}>
      {competitor.scanning ? <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" /> : <Radar className="me-1 h-3.5 w-3.5" />}
      {competitor.scanning ? t("competitors.scanning") : t("competitors.scanNow")}
      {!competitor.scanning && <CreditCost credits={credits} prefix=" · " className="ms-0.5 opacity-80" />}
    </Button>
  )
}

/**
 * One brand, platform by platform: a card per platform (their posts, the
 * posts about them, the usual reach), the platforms side by side, and on a
 * platform what works there, what people say, and the posts.
 */
export function BrandDialog({
  target,
  cards,
  posts,
  busy,
  onScan,
  onEdit,
  onOpenChange,
  onCloseAutoFocus,
}: {
  readonly target: BrandDialogTarget | null
  /** Every card on the wall, for what people say about the brand. */
  readonly cards: readonly ActionCard[]
  readonly posts: Readonly<Record<string, CompetitorPost>>
  readonly busy: boolean
  readonly onScan: (c: TrackedCompetitor) => void
  readonly onEdit: (c: TrackedCompetitor) => void
  readonly onOpenChange: (open: boolean) => void
  /** Where focus goes once the window has closed (the brand's name that opened it). */
  readonly onCloseAutoFocus?: (event: Event) => void
}) {
  const t = useT()
  const id = target?.competitor.id ?? null
  const detail = useCompetitorDetail(id)
  const competitor = detail.data ?? target?.competitor ?? null
  const [choice, setChoice] = useState<BrandPlatformChoice>("all")
  // Each opening starts where it was opened from; a reload keeps the choice.
  useEffect(() => {
    if (target) setChoice(target.platform ?? "all")
  }, [target])
  const tallies = useMemo(() => (detail.data ? brandTallies(detail.data) : []), [detail.data])
  const postIds = useMemo(() => (detail.data?.latestScan?.posts ?? []).map((p) => p.id), [detail.data])
  const save = useSaveControls(postIds, "competitors")
  const marks = useCardMarks(competitor?.isOwn === true)
  const scanCredits = useScanPrice(competitor)
  const chosen = choice === "all" ? null : (tallies.find((p) => p.platform === choice) ?? null)
  // The tab shown: a platform the brand has nothing on falls back to every platform.
  const current: BrandPlatformChoice = chosen ? chosen.platform : "all"
  const scan = detail.data?.latestScan ?? null
  const isOwn = competitor?.isOwn === true

  const own = tallies.reduce((sum, p) => sum + p.own, 0)
  const about = tallies.reduce((sum, p) => sum + p.about, 0)
  const theirs = isOwn
    ? own === 1 ? t("competitors.yourPostsCountOne") : t("competitors.yourPostsCount", { n: own })
    : own === 1 ? t("competitors.theirPostsCountOne") : t("competitors.theirPostsCount", { n: own })
  const aboutPhrase = isOwn
    ? about === 1 ? t("competitors.aboutYouCountOne") : t("competitors.aboutYouCount", { n: about })
    : about === 1 ? t("competitors.aboutThemCountOne") : t("competitors.aboutThemCount", { n: about })
  const platforms = tallies.length === 1 ? t("competitors.platformsCountOne") : t("competitors.platformsCount", { n: tallies.length })

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-0 p-0 sm:max-w-[1080px]" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader className="flex-row flex-wrap items-start justify-between gap-3 border-b border-border px-6 pb-4 pt-6 text-start">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center gap-2">
              <DialogTitle className="truncate text-[20px]" dir="auto">
                {competitor?.brand ?? ""}
              </DialogTitle>
              {isOwn && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-muted-foreground">{t("competitors.yours")}</span>}
            </div>
            <DialogDescription className="text-[14px]">
              {scan ? t("competitors.dialogScanLine", { date: formatDate(Date.parse(scan.at), { month: "short", day: "numeric" }), theirs, about: aboutPhrase, platforms }) : ""}
            </DialogDescription>
          </div>
          {competitor && (
            <div className="me-8 flex shrink-0 gap-1.5">
              <ScanButton competitor={competitor} busy={busy} onScan={() => onScan(competitor)} />
              <Button size="sm" variant="outline" onClick={() => onEdit(competitor)}>
                <Pencil className="me-1 h-3.5 w-3.5" />
                {t("competitors.edit")}
              </Button>
            </div>
          )}
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-7 pt-5">
          {detail.isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : detail.error ? (
            <p className="py-12 text-center text-sm text-destructive">{t("apiErr.loadCompetitorPosts")}</p>
          ) : !detail.data || tallies.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">{t(scan ? "competitors.noPosts" : "competitors.neverScanned")}</p>
          ) : (
            <TabsPrimitive.Root value={current} onValueChange={(value) => setChoice(value as BrandPlatformChoice)} className="flex flex-col gap-[22px]">
              <BrandPlatformCards tallies={tallies} isOwn={isOwn} choice={current} onChoose={setChoice} />
              <div className="h-px bg-border" />
              <TabsPrimitive.Content value={current} className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {chosen ? (
                  <BrandPlatformDetail
                    key={chosen.platform}
                    detail={detail.data}
                    tally={chosen}
                    cards={cards}
                    posts={posts}
                    save={save}
                    scan={{ credits: scanCredits, busy, onScan: () => onScan(detail.data!) }}
                  />
                ) : (
                  <div className="flex flex-col gap-5">
                    {isOwn && <AdviceRecordList record={marks.data?.record} />}
                    <BrandPlatformTable tallies={tallies} isOwn={isOwn} subjectId={detail.data.id} cards={cards} posts={posts} onChoose={setChoice} />
                  </div>
                )}
              </TabsPrimitive.Content>
            </TabsPrimitive.Root>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
