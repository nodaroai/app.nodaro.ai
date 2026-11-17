"use client"

import { useMemo, useState } from "react"
import { Loader2 } from "lucide-react"
import type { ActionCard, TopicCardsResult, TrackedTopic } from "@nodaro/shared/social"
import { Button } from "@/components/ui/button"
import { ActionCardView } from "@/components/competitors/action-card-view"
import { cardPlatform } from "@/components/competitors/card-facts"
import { useSaveControls } from "@/components/competitors/use-save-controls"
import { useT } from "@/lib/i18n"
import { asAboutPosts } from "./topic-posts"

/** Cards shown before "Show all". */
const CARDS_FIRST = 6

/** The topic a card is about: the followed topic it names, else the name the card carries. */
export function topicNameOf(card: ActionCard, names: ReadonlyMap<string, string>): string | null {
  const named = card.subjectId ? names.get(card.subjectId) : undefined
  return named ?? (typeof card.params.brand === "string" && card.params.brand ? card.params.brand : null)
}

/** What is happening around the topics: the cards of every topic's latest scan, most urgent first. */
export function TopicCardsWall({
  cards,
  loading,
  failed,
  onRetry,
  topics,
}: {
  readonly cards: TopicCardsResult | undefined
  readonly loading: boolean
  readonly failed: boolean
  readonly onRetry: () => void
  readonly topics: readonly TrackedTopic[]
}) {
  const t = useT()
  const [showAll, setShowAll] = useState(false)
  const posts = useMemo(() => asAboutPosts(Object.values(cards?.posts ?? {})), [cards])
  const evidenceIds = useMemo(() => [...new Set((cards?.cards ?? []).flatMap((c) => c.evidence))], [cards])
  // Saved to Inspiration under the Competitors source: a topic is followed on the same page family.
  const save = useSaveControls(evidenceIds, "competitors")
  const names = useMemo(() => new Map(topics.map((topic) => [topic.id, topic.name] as const)), [topics])
  const all = cards?.cards ?? []
  const shown = showAll ? all : all.slice(0, CARDS_FIRST)
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{t("competitors.cardsTitle")}</h2>
      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : failed && !cards ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <span className="flex-1">{t("apiErr.loadTopicCards")}</span>
          <Button size="sm" variant="outline" onClick={onRetry}>
            {t("common.retry")}
          </Button>
        </div>
      ) : all.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("topics.noCards")}</p>
      ) : (
        <>
          <div id="topic-cards" className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(320px,100%),1fr))]">
            {shown.map((card) => (
              <ActionCardView
                key={card.id}
                card={card}
                brand={{ name: topicNameOf(card, names), hue: undefined }}
                platform={cardPlatform(card, posts)}
                posts={posts}
                save={save}
              />
            ))}
          </div>
          {all.length > CARDS_FIRST && (
            <button
              type="button"
              aria-expanded={showAll}
              aria-controls="topic-cards"
              onClick={() => setShowAll(!showAll)}
              className="self-start text-[13px] font-semibold hover:underline"
            >
              {showAll ? t("competitors.showFewer") : t("competitors.showAll", { n: all.length })}
            </button>
          )}
        </>
      )}
    </section>
  )
}
