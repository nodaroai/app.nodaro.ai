"use client"

import { useState, type ReactNode } from "react"
import type { ActionCard, CompetitorPost, SocialPost } from "@nodaro/shared/social"
import { ActionCardView, type SaveControls } from "@/components/competitors/action-card-view"
import { cardPlatform } from "@/components/competitors/card-facts"
import { SocialPostCard } from "@/components/research/social-post-card"
import { SocialPostPreview } from "@/components/research/social-post-preview"
import { useT } from "@/lib/i18n"

/** Posts shown in the grid before "Show all". */
const POSTS_FIRST = 8

/** A titled part of a topic's window. */
export function TopicSection({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="text-[11px] font-semibold uppercase tracking-[.08em] text-muted-foreground">{title}</h3>
      {children}
    </section>
  )
}

/** The cards of the topic's latest scan. */
export function TopicCardsSection({
  name,
  cards,
  byId,
  save,
}: {
  /** The topic's name, which every card is about. */
  readonly name: string | null
  readonly cards: readonly ActionCard[]
  readonly byId: Readonly<Record<string, CompetitorPost>>
  readonly save: SaveControls
}) {
  const t = useT()
  return (
    <TopicSection title={t("competitors.cardsTitle")}>
      {cards.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{t("topics.noCards")}</p>
      ) : (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(300px,100%),1fr))]">
          {cards.map((card) => (
            <ActionCardView key={card.id} card={card} brand={{ name, hue: undefined }} platform={cardPlatform(card, byId)} posts={byId} save={save} />
          ))}
        </div>
      )}
    </TopicSection>
  )
}

/**
 * The posts the topic's latest scan kept, most reached first, the first few
 * with "Show all", each readable whole. Its own state (shown all, the post
 * read, the clock the ages read) belongs to one topic: the window keys this
 * section by the topic, so another topic starts it afresh.
 */
export function TopicPostsSection({
  listId,
  posts,
  byId,
  save,
}: {
  readonly listId: string
  /** Most reached first. */
  readonly posts: readonly SocialPost[]
  readonly byId: Readonly<Record<string, CompetitorPost>>
  readonly save: SaveControls
}) {
  const t = useT()
  const [allShown, setAllShown] = useState(false)
  const [reading, setReading] = useState<SocialPost | null>(null)
  const [now] = useState(() => Date.now())
  const visible = allShown ? posts : posts.slice(0, POSTS_FIRST)
  return (
    <TopicSection title={t("topics.postsTitle")}>
      {posts.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{t("competitors.noPosts")}</p>
      ) : (
        <div id={listId} className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(220px,100%),1fr))]">
          {visible.map((post) => (
            <SocialPostCard
              key={post.id}
              post={post}
              now={now}
              saved={save.isSaved(post.id)}
              saveBusy={save.isBusy(post.id)}
              onToggleSave={() => save.toggle(byId[post.id] ?? { ...post, role: "about" })}
              onRead={() => setReading(post)}
            />
          ))}
        </div>
      )}
      {posts.length > POSTS_FIRST && (
        <button type="button" aria-expanded={allShown} aria-controls={listId} onClick={() => setAllShown(!allShown)} className="self-start text-[13px] font-semibold hover:underline">
          {allShown ? t("competitors.showFewer") : t("competitors.showAll", { n: posts.length })}
        </button>
      )}
      <SocialPostPreview post={reading} onOpenChange={(open) => !open && setReading(null)} />
    </TopicSection>
  )
}
