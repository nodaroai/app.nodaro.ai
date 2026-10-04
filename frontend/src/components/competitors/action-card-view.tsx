"use client"

import { ArrowRight, Bookmark, BookmarkCheck, CheckCircle2, ExternalLink } from "lucide-react"
import { isMeasurableCard, type ActionCard, type AdviceRecord, type CardAction, type CompetitorPost } from "@nodaro/shared"
import { Button } from "@/components/ui/button"
import { MetaAdMedia } from "@/components/nodes/meta-ad-media"
import { initialOf, socialPostLink, whoOf } from "@/components/research/social-post-card"
import { useT } from "@/lib/i18n"
import { useAppDir } from "@/lib/locale-store"
import { cn } from "@/lib/utils"
import { cardText, priorityLabel } from "./action-card-text"
import { CardMarkStrip } from "./card-mark-strip"
import { familyLabel, recordPill } from "./card-outcome-text"

const PRIORITY_TONE: Readonly<Record<ActionCard["priority"], string>> = {
  1: "bg-[#FF0073]/10 text-[#FF0073]",
  2: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  3: "bg-muted text-muted-foreground",
}

export interface SaveControls {
  readonly isSaved: (postId: string) => boolean
  readonly isBusy: (postId: string) => boolean
  readonly toggle: (post: CompetitorPost) => void
}

/** One post a card rests on: who, the first words, a link, and a bookmark. */
function EvidencePost({ post, save }: { readonly post: CompetitorPost; readonly save: SaveControls }) {
  const t = useT()
  const link = socialPostLink(post)
  const words = (post.title || post.text).replace(/\s+/g, " ").trim()
  const saved = save.isSaved(post.id)
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-background/60 p-1.5">
      <MetaAdMedia src={post.media.thumbnailUrl ?? post.author.avatarUrl ?? null} initial={initialOf(post)} className="h-10 w-10 shrink-0 rounded-md" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11.5px] font-bold">{whoOf(post)}</div>
        {words && (
          <div className="truncate text-[11px] text-muted-foreground" dir="auto">
            {words}
          </div>
        )}
      </div>
      {link && (
        <a href={link} target="_blank" rel="noopener noreferrer" className="rounded-md p-1 text-muted-foreground hover:text-foreground" aria-label={t("social.openPost")} title={t("social.openPost")}>
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
      <button
        type="button"
        onClick={() => save.toggle(post)}
        disabled={save.isBusy(post.id)}
        aria-pressed={saved}
        aria-label={saved ? t("social.savedRemove") : t("social.saveToWall")}
        title={saved ? t("social.savedRemove") : t("social.saveToWall")}
        className={cn("rounded-md p-1 disabled:opacity-50", saved ? "text-[#FF0073]" : "text-muted-foreground hover:text-foreground")}
      >
        {saved ? <BookmarkCheck className="h-3.5 w-3.5" /> : <Bookmark className="h-3.5 w-3.5" />}
      </button>
    </div>
  )
}

/** "I did this" on a card, and its mark once made. */
export interface CardMarking {
  /** Marks can be kept (the server has a place for them). */
  readonly canMark: boolean
  /** The card's mark, when it has one. */
  readonly action?: CardAction
  /** The posts the mark's outcome names. */
  readonly posts: Readonly<Record<string, CompetitorPost>>
  readonly busy?: boolean
  /** Open the link field at once (right after marking). */
  readonly linkOpen?: boolean
  readonly onMark: () => void
  readonly onLink: (postUrl: string | null) => void
  readonly onUndo: () => void
  readonly onLater?: () => void
}

/** An action card: what happened, why it matters, what to do, and the posts it rests on. */
export function ActionCardView({
  card,
  posts,
  save,
  marking,
  record,
}: {
  readonly card: ActionCard
  readonly posts: Readonly<Record<string, CompetitorPost>>
  readonly save: SaveControls
  readonly marking?: CardMarking
  /** How this card's family of advice has gone for the person, when there is enough to say. */
  readonly record?: AdviceRecord
}) {
  const t = useT()
  const isRtl = useAppDir() === "rtl"
  const text = cardText(card, t)
  const evidence = card.evidence.flatMap((id) => (posts[id] ? [posts[id]!] : []))
  return (
    <article className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", PRIORITY_TONE[card.priority])}>{priorityLabel(card, t)}</span>
        {record && (
          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:text-emerald-300" title={familyLabel(record.family, t)}>
            {familyLabel(record.family, t)} · {recordPill(record, t)}
          </span>
        )}
      </div>
      <h3 className="text-[14px] font-semibold leading-snug" dir="auto">
        {text.title}
      </h3>
      {text.why && <p className="text-[12.5px] text-muted-foreground">{text.why}</p>}
      {text.quote && (
        <blockquote className="line-clamp-2 border-s-2 border-border ps-2 text-[12.5px] italic text-muted-foreground" dir="auto">
          {text.quote}
        </blockquote>
      )}
      <p className="flex items-center gap-1.5 text-[12.5px] font-semibold">
        <ArrowRight className={cn("h-3.5 w-3.5 shrink-0", isRtl && "rotate-180")} />
        {text.action}
      </p>
      {evidence.length > 0 && (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {evidence.map((post) => (
            <EvidencePost key={post.id} post={post} save={save} />
          ))}
        </div>
      )}
      {marking?.action ? (
        <CardMarkStrip
          action={marking.action}
          posts={marking.posts}
          busy={marking.busy}
          linkOpen={marking.linkOpen}
          onLink={marking.onLink}
          onUndo={marking.onUndo}
          onLater={marking.onLater}
        />
      ) : (
        marking?.canMark &&
        isMeasurableCard(card) && (
          <Button variant="ghost" size="sm" className="h-8 self-start px-2 text-[12.5px] font-semibold" onClick={marking.onMark} disabled={marking.busy}>
            <CheckCircle2 className="me-1.5 h-4 w-4" />
            {t("marks.iDidThis")}
          </Button>
        )
      )}
    </article>
  )
}
