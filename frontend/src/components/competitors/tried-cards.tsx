"use client"

import { useEffect, useRef } from "react"
import { ArrowRight } from "lucide-react"
import type { ActionCard, CardAction, CompetitorActionsResult } from "@nodaro/shared"
import { useT } from "@/lib/i18n"
import { formatDate } from "@/lib/i18n/format"
import { useAppDir } from "@/lib/locale-store"
import { cn } from "@/lib/utils"
import { cardText, priorityLabel } from "./action-card-text"
import { AdviceRecordList } from "./advice-record"
import { CardMarkStrip } from "./card-mark-strip"
import { isPendingMark } from "./card-outcome-text"
import { useInView } from "./use-in-view"

/** The card as it was when acted on, phrased as the wall phrased it. */
function snapshotCard(action: CardAction): ActionCard {
  return {
    id: action.cardId,
    kind: action.cardKind,
    priority: action.card.priority ?? 2,
    subjectId: action.subjectId,
    params: action.card.params ?? {},
    evidence: action.card.evidence ?? [],
    title: action.card.title ?? "",
    why: action.card.why ?? "",
    action: action.card.action ?? "",
  }
}

export interface MarkHandlers {
  readonly busyId: string | null
  readonly onLink: (action: CardAction, postUrl: string | null) => void
  readonly onUndo: (action: CardAction) => void
  readonly onSeen: (action: CardAction) => void
}

/**
 * One tried card. A verdict not seen yet is marked seen once the card is on
 * screen: a worked one after its multiplier counts up, the others at once.
 */
function TriedCard({ action, posts, handlers }: { readonly action: CardAction; readonly posts: CompetitorActionsResult["posts"]; readonly handlers: MarkHandlers }) {
  const t = useT()
  const isRtl = useAppDir() === "rtl"
  const ref = useRef<HTMLElement>(null)
  const inView = useInView(ref)
  const unseen = action.verdict !== null && action.seenAt === null && !isPendingMark(action)
  const worked = action.verdict?.state === "worked"
  // Asked once per card, however often the page re-renders before the answer.
  const asked = useRef(false)
  const { onSeen: askSeen } = handlers
  const onSeen = (a: CardAction) => {
    if (asked.current) return
    asked.current = true
    askSeen(a)
  }
  useEffect(() => {
    if (!inView || !unseen || worked || asked.current) return
    asked.current = true
    askSeen(action)
  }, [inView, unseen, worked, askSeen, action])
  const card = snapshotCard(action)
  // A snapshot without its numbers reads in the server's words.
  const text = action.card.params ? cardText(card, t) : { title: card.title, why: card.why, action: card.action }
  return (
    <article ref={ref} className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        {action.card.priority && <span className="rounded-full bg-muted px-2 py-0.5 font-bold">{priorityLabel(card, t)}</span>}
        <span>{t("marks.triedOn", { date: formatDate(Date.parse(action.actedAt), { month: "short", day: "numeric" }) })}</span>
        {!action.onWall && <span>· {t("marks.offWall")}</span>}
      </div>
      <h3 className="text-[14px] font-semibold leading-snug" dir="auto">
        {text.title}
      </h3>
      <p className="flex items-center gap-1.5 text-[12.5px] font-semibold">
        <ArrowRight className={cn("h-3.5 w-3.5 shrink-0", isRtl && "rotate-180")} />
        {text.action}
      </p>
      <CardMarkStrip
        action={action}
        posts={posts}
        busy={handlers.busyId === action.id || isPendingMark(action)}
        celebrate={{ play: unseen && worked && inView, armed: unseen && worked, onPlayed: () => onSeen(action) }}
        onLink={(url) => handlers.onLink(action, url)}
        onUndo={() => handlers.onUndo(action)}
      />
    </article>
  )
}

/**
 * Tried: every card the person marked "I did this", newest first, with how it
 * went, and their track record on top.
 */
export function TriedCards({ data, handlers }: { readonly data: CompetitorActionsResult; readonly handlers: MarkHandlers }) {
  const t = useT()
  if (data.actions.length === 0) return <p className="text-sm text-muted-foreground">{t("marks.noneTried")}</p>
  return (
    <div className="flex flex-col gap-3">
      <AdviceRecordList record={data.record} />
      <div className="grid gap-3 md:grid-cols-2">
        {data.actions.map((action) => (
          <TriedCard key={action.id} action={action} posts={data.posts} handlers={handlers} />
        ))}
      </div>
    </div>
  )
}
