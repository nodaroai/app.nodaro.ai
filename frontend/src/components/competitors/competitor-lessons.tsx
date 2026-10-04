"use client"

import { useMemo, useState } from "react"
import { Lightbulb, Loader2 } from "lucide-react"
import type { CompetitorPost, SocialPost } from "@nodaro/shared"
import { SocialPostCard } from "@/components/research/social-post-card"
import { SocialPostPreview } from "@/components/research/social-post-preview"
import { SocialPostTile } from "@/components/research/social-post-tile"
import { useCardMarks, useCompetitorLessons } from "@/hooks/queries/use-competitors-queries"
import { useT } from "@/lib/i18n"
import { platformLabel } from "./action-card-text"
import { AdviceRecordList } from "./advice-record"
import { lessonText, platformLine } from "./lesson-text"
import { useSaveControls } from "./use-save-controls"

/**
 * What works for a tracked brand (stage 4, learning from results): per
 * platform, what its best posts share — measured on its own posts across every
 * scan — with the posts each lesson rests on, and its best posts. "What works
 * for you" on the brand marked as yours. Free: read from the scans already made.
 */
export function CompetitorLessons({ competitorId, isOwn }: { readonly competitorId: string; readonly isOwn: boolean }) {
  const t = useT()
  const query = useCompetitorLessons(competitorId, true)
  // On your own brand: how the advice you acted on went, beside what works.
  const marks = useCardMarks(isOwn)
  const [reading, setReading] = useState<SocialPost | null>(null)
  const [now] = useState(() => Date.now())
  const data = query.data
  const winners = useMemo(() => data?.lessons.platforms.flatMap((p) => p.winners) ?? [], [data])
  const save = useSaveControls(winners, "competitors")
  const postOf = (id: string): CompetitorPost | undefined => data?.posts[id]

  if (query.isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (query.error || !data) return <p className="py-12 text-center text-sm text-destructive">{t("apiErr.loadCompetitorLessons")}</p>
  const { platforms, minPosts } = data.lessons
  if (platforms.length === 0) return <p className="py-12 text-center text-sm text-muted-foreground">{t("competitors.lessonsNoPosts")}</p>

  return (
    <div className="flex flex-col gap-6">
      <p className="text-[12.5px] text-muted-foreground">{t(isOwn ? "competitors.lessonsHintOwn" : "competitors.lessonsHintThem")}</p>
      {isOwn && <AdviceRecordList record={marks.data?.record} />}
      {platforms.map((pl) => (
        <section key={pl.platform} className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h3 className="text-[13.5px] font-extrabold">{platformLabel(pl.platform)}</h3>
            <span className="text-[12px] tabular-nums text-muted-foreground">{platformLine(pl, t)}</span>
          </div>
          {pl.usual === null ? (
            <p className="text-[12.5px] text-muted-foreground">{t("competitors.lessonsNeedMore", { min: minPosts, posts: pl.posts })}</p>
          ) : pl.lessons.length === 0 ? (
            <p className="text-[12.5px] text-muted-foreground">{t("competitors.lessonsNothing")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {pl.lessons.map((lesson) => {
                const text = lessonText(lesson, t)
                const evidence = lesson.evidence.flatMap((id) => {
                  const post = postOf(id)
                  return post ? [post] : []
                })
                return (
                  <li key={lesson.id} className="flex flex-col gap-2 rounded-lg border p-3">
                    <div className="flex items-start gap-2">
                      <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                      <div className="flex flex-col gap-0.5">
                        <span dir="auto" className="text-[13px] font-semibold leading-snug">{text.line}</span>
                        <span className="text-[11.5px] text-muted-foreground">{text.basis}</span>
                      </div>
                    </div>
                    {evidence.length > 0 && (
                      <div className="grid max-w-[480px] grid-cols-4 gap-1.5">
                        {evidence.map((post) => (
                          <SocialPostTile key={post.id} post={post} onRead={setReading} />
                        ))}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          {pl.winners.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-bold uppercase tracking-[.08em] text-muted-foreground">{t("competitors.lessonsBest")}</span>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
                {pl.winners.flatMap((id) => {
                  const post = postOf(id)
                  return post
                    ? [
                        <SocialPostCard
                          key={post.id}
                          post={post}
                          now={now}
                          saved={save.isSaved(post.id)}
                          saveBusy={save.isBusy(post.id)}
                          onToggleSave={() => save.toggle(post)}
                        />,
                      ]
                    : []
                })}
              </div>
            </div>
          )}
        </section>
      ))}
      <SocialPostPreview post={reading} onOpenChange={(open) => !open && setReading(null)} />
    </div>
  )
}
