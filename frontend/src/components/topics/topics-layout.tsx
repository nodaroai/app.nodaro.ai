"use client"

import { Hash, Loader2, Plus } from "lucide-react"
import type { TopicCardsResult, TrackedTopic } from "@nodaro/shared/social"
import { Button } from "@/components/ui/button"
import { useT } from "@/lib/i18n"
import { TopicCardsWall } from "./topic-cards-wall"
import { TopicRow, type TopicActions } from "./topic-row"
import { TopicsLocked, TopicsUnavailable } from "./topics-notice"
import type { TopicsBodyState } from "./use-topics-page"

/** The page's title and what it is for, with Add when a topic can be added (disabled, with why, at the plan's cap). */
export function TopicsHeader({
  canAdd,
  limit,
  atCap,
  onAdd,
}: {
  readonly canAdd: boolean
  readonly limit: number | null | undefined
  /** Every topic the plan allows is in use. */
  readonly atCap: boolean
  readonly onAdd: () => void
}) {
  const t = useT()
  return (
    <div className="mb-[30px] flex items-start justify-between gap-4">
      <div className="flex max-w-[640px] flex-col gap-2">
        <div className="flex items-center gap-2.5">
          <Hash className="h-[22px] w-[22px] text-muted-foreground" />
          <h1 className="text-2xl font-semibold">{t("topics.title")}</h1>
        </div>
        <p className="text-sm leading-normal text-muted-foreground">{t("topics.description")}</p>
      </div>
      {canAdd && (
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Button className="whitespace-nowrap" disabled={atCap} onClick={onAdd}>
            <Plus className="me-1 h-4 w-4" />
            {t("topics.add")}
          </Button>
          {atCap && <span className="text-[12px] text-muted-foreground">{limit === 1 ? t("topics.atCapOne") : t("topics.atCap", { n: limit ?? 0 })}</span>}
        </div>
      )}
    </div>
  )
}

/** The topics, what is happening around them, and the plan's word when it has no topics. */
function TopicsReady({
  topics,
  locked,
  cards,
  actions,
}: {
  readonly topics: readonly TrackedTopic[]
  readonly locked: boolean
  readonly cards: { readonly data: TopicCardsResult | undefined; readonly isLoading: boolean; readonly isError: boolean; readonly refetch: () => unknown }
  readonly actions: TopicActions
}) {
  const t = useT()
  return (
    <div className="flex flex-col gap-[30px]">
      {locked && <TopicsLocked />}
      {topics.length === 0 && !locked && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Hash className="mb-3 h-10 w-10 text-muted-foreground" />
          <p className="max-w-md text-sm text-muted-foreground">{t("topics.empty")}</p>
        </div>
      )}
      {topics.length > 0 && (
        <>
          <ul className="flex flex-col gap-2" aria-label={t("topics.title")}>
            {topics.map((topic) => (
              <TopicRow key={topic.id} topic={topic} actions={actions} />
            ))}
          </ul>
          <TopicCardsWall cards={cards.data} loading={cards.isLoading} failed={cards.isError} onRetry={() => void cards.refetch()} topics={topics} />
        </>
      )}
    </div>
  )
}

/** The page body, by the list's state. */
export function TopicsBody({
  state,
  ...ready
}: {
  readonly state: TopicsBodyState
} & Parameters<typeof TopicsReady>[0]) {
  const t = useT()
  switch (state) {
    case "loading":
      return (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )
    case "unavailable":
      return <TopicsUnavailable />
    case "error":
      return <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{t("apiErr.loadTopics")}</div>
    case "ready":
      return <TopicsReady {...ready} />
  }
}
