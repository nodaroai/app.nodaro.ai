"use client"

import { useState } from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"
import { AlertTriangle, Loader2, Radar } from "lucide-react"
import type { ActionCard, CompetitorDetail, CompetitorPlatformTally, CompetitorPost, SocialPost } from "@nodaro/shared"
import { Button } from "@/components/ui/button"
import { CreditCost } from "@/components/ui/credit-cost"
import { SocialPostCard } from "@/components/research/social-post-card"
import { SocialPostPreview } from "@/components/research/social-post-preview"
import { SocialPostTile } from "@/components/research/social-post-tile"
import { SOCIAL_PLATFORM_META } from "@/components/research/social-platforms"
import { useCompetitorLessons } from "@/hooks/queries/use-competitors-queries"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { cardText } from "./action-card-text"
import { aboutCardsOn, allFailed, postsOn, readsOf } from "./brand-platforms"
import { lessonText } from "./lesson-text"
import type { SaveControls } from "./action-card-view"
import { usualText } from "./usual-text"

/** Posts shown in the grid before "Show all". */
const POSTS_FIRST = 8

const TAG_THEIRS = "bg-[#fde0eb] text-[#be1257] dark:bg-[#3a1225] dark:text-[#ff6fa6]"
const TAG_ABOUT = "bg-[#e9e6ff] text-[#5b4bd6] dark:bg-[#231f45] dark:text-[#a99cff]"

/** One insight: whose posts it is about, what it says, what it rests on, and those posts. */
function Insight({
  tag,
  tone,
  title,
  meta,
  evidence,
  onRead,
}: {
  readonly tag: string
  readonly tone: string
  readonly title: string
  readonly meta: string
  readonly evidence: readonly CompetitorPost[]
  readonly onRead: (post: SocialPost) => void
}) {
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-card p-3.5">
      <span className={cn("self-start whitespace-nowrap rounded-[5px] px-[7px] py-0.5 text-[11px] font-semibold", tone)}>{tag}</span>
      <div className="flex flex-col gap-[3px]">
        <span className="text-[14px] font-semibold leading-[1.35]">{title}</span>
        {meta && <span className="text-[12px] text-muted-foreground">{meta}</span>}
      </div>
      {evidence.length > 0 && (
        <div className="grid max-w-[280px] grid-cols-4 gap-1.5">
          {evidence.map((post) => (
            <SocialPostTile key={post.id} post={post} onRead={onRead} />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * One platform in the brand window: what the scan found there, what works for
 * the brand there and what people say about it, and the posts themselves.
 */
export function BrandPlatformDetail({
  detail,
  tally,
  cards,
  posts,
  save,
  scan,
}: {
  readonly detail: CompetitorDetail
  readonly tally: CompetitorPlatformTally
  readonly cards: readonly ActionCard[]
  readonly posts: Readonly<Record<string, CompetitorPost>>
  readonly save: SaveControls
  readonly scan: { readonly credits: number | null; readonly busy: boolean; readonly onScan: () => void }
}) {
  const t = useT()
  const lessons = useCompetitorLessons(detail.id, true)
  const reads = readsOf(tally)
  // Their posts first; a platform only searched for posts about them opens on those.
  const [tab, setTab] = useState<"own" | "about">(reads.own || !reads.about ? "own" : "about")
  const [allShown, setAllShown] = useState(false)
  const [reading, setReading] = useState<SocialPost | null>(null)
  const [now] = useState(() => Date.now())
  const meta = SOCIAL_PLATFORM_META[tally.platform]
  const failed = allFailed(tally)
  const usual = usualText(tally, t)
  const theirs = detail.isOwn
    ? tally.own === 1 ? t("competitors.yourPostsCountOne") : t("competitors.yourPostsCount", { n: tally.own })
    : tally.own === 1 ? t("competitors.theirPostsCountOne") : t("competitors.theirPostsCount", { n: tally.own })
  const about = detail.isOwn
    ? tally.about === 1 ? t("competitors.aboutYouCountOne") : t("competitors.aboutYouCount", { n: tally.about })
    : tally.about === 1 ? t("competitors.aboutThemCountOne") : t("competitors.aboutThemCount", { n: tally.about })
  // Only what the scan reads there: a platform searched only for posts about them shows no count of theirs.
  const summary = failed
    ? t("competitors.searchFailedThisScan")
    : [...(reads.own ? [theirs] : []), ...(reads.about ? [about] : []), ...(usual ? [t("competitors.usuallyPhrase", { usual })] : [])].join(t("competitors.dotJoin"))

  const here = lessons.data?.lessons.platforms.find((p) => p.platform === tally.platform)
  const lessonPost = (id: string) => lessons.data?.posts[id]
  const mine = aboutCardsOn(cards, posts, detail.id, tally.platform)
  const list = postsOn(detail, tally.platform, tab)
  const shownPosts = allShown ? list : list.slice(0, POSTS_FIRST)
  const tabs = (["own", "about"] as const).filter((key) => (key === "own" ? reads.own : reads.about))
  const tabLabel = (key: "own" | "about") =>
    key === "own"
      ? t(detail.isOwn ? "competitors.tabOwnYou" : "competitors.tabOwn", { n: tally.own })
      : t(detail.isOwn ? "competitors.tabAboutYou" : "competitors.tabAbout", { n: tally.about })
  const choose = (key: "own" | "about") => {
    setTab(key)
    setAllShown(false)
  }

  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-muted">{meta.icon("h-4 w-4")}</span>
        <h3 className="text-[18px] font-semibold">{meta.name}</h3>
        <span className={cn("text-[13px]", failed ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>{summary}</span>
      </div>

      {failed ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/[0.08] p-4">
          <div className="flex flex-col gap-1">
            <span className="flex items-center gap-1.5 text-[14px] text-amber-800 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
              {t("competitors.failedBanner", { platform: meta.name })}
            </span>
            <span className="text-[12px] text-muted-foreground">{t("competitors.rescanHint")}</span>
          </div>
          <Button size="sm" onClick={scan.onScan} disabled={scan.busy || detail.scanning || detail.searches === 0}>
            <Radar className="me-1 h-3.5 w-3.5" />
            {t("competitors.scanBrandAgain", { brand: detail.brand })}
            <CreditCost credits={scan.credits} prefix=" · " className="ms-0.5 opacity-80" />
          </Button>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-[.08em] text-muted-foreground">{t("competitors.insightsOn", { platform: meta.name })}</span>
            {lessons.isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : lessons.isError ? (
              <p className="py-1 text-[13px] text-destructive">{t("apiErr.loadCompetitorLessons")}</p>
            ) : (
              <>
                {(here?.lessons.length ?? 0) + mine.length > 0 && (
                  <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(min(300px,100%),1fr))]">
                    {(here?.lessons ?? []).map((lesson) => {
                      const text = lessonText(lesson, t)
                      return (
                        <Insight
                          key={lesson.id}
                          tag={t(detail.isOwn ? "competitors.legendYours" : "competitors.legendTheirs")}
                          tone={TAG_THEIRS}
                          title={text.line}
                          meta={text.basis}
                          evidence={lesson.evidence.flatMap((id) => (lessonPost(id) ? [lessonPost(id)!] : []))}
                          onRead={setReading}
                        />
                      )
                    })}
                    {mine.map((card) => {
                      const text = cardText(card, t)
                      return (
                        <Insight
                          key={card.id}
                          tag={t(detail.isOwn ? "competitors.legendAboutYou" : "competitors.legendAbout")}
                          tone={TAG_ABOUT}
                          title={text.title}
                          meta={text.why}
                          evidence={card.evidence.flatMap((id) => (posts[id]?.platform === tally.platform ? [posts[id]!] : []))}
                          onRead={setReading}
                        />
                      )
                    })}
                  </div>
                )}
                {(here?.lessons.length ?? 0) === 0 && (
                  <p className="py-1 text-[13px] text-muted-foreground">
                    {here && here.usual === null
                      ? t("competitors.lessonsNeedMore", { min: lessons.data?.lessons.minPosts ?? 0, posts: here.posts })
                      : t("competitors.lessonsNothing")}
                  </p>
                )}
              </>
            )}
          </div>

          <TabsPrimitive.Root value={tab} onValueChange={(value) => choose(value as "own" | "about")} className="flex flex-col gap-3">
            {tabs.length > 0 && (
              <TabsPrimitive.List className="flex gap-1 self-start rounded-[10px] border border-border p-1" aria-label={meta.name}>
                {tabs.map((key) => (
                  <TabsPrimitive.Trigger key={key} value={key} asChild>
                    <button
                      type="button"
                      onClick={() => choose(key)}
                      className={cn("rounded-[7px] px-3 py-1.5 text-[13px] font-semibold", tab === key ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
                    >
                      {tabLabel(key)}
                    </button>
                  </TabsPrimitive.Trigger>
                ))}
              </TabsPrimitive.List>
            )}
            <TabsPrimitive.Content value={tab} className="flex flex-col gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {list.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">{t("competitors.noPosts")}</p>
              ) : (
                <div id={`posts-${detail.id}-${tally.platform}`} className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(220px,100%),1fr))]">
                  {shownPosts.map((post) => (
                    <SocialPostCard
                      key={post.id}
                      post={post}
                      now={now}
                      saved={save.isSaved(post.id)}
                      saveBusy={save.isBusy(post.id)}
                      onToggleSave={() => save.toggle(post)}
                      onRead={() => setReading(post)}
                    />
                  ))}
                </div>
              )}
              {list.length > POSTS_FIRST && (
                <button
                  type="button"
                  aria-expanded={allShown}
                  aria-controls={`posts-${detail.id}-${tally.platform}`}
                  onClick={() => setAllShown(!allShown)}
                  className="self-start text-[13px] font-semibold hover:underline"
                >
                  {allShown ? t("competitors.showFewer") : t("competitors.showAll", { n: list.length })}
                </button>
              )}
            </TabsPrimitive.Content>
          </TabsPrimitive.Root>
        </>
      )}
      <SocialPostPreview post={reading} onOpenChange={(open) => !open && setReading(null)} />
    </div>
  )
}
