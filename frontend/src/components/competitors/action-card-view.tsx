"use client"

import { useId, useState } from "react"
import { ArrowRight, Bookmark, BookmarkCheck, CheckCircle2, ExternalLink } from "lucide-react"
import { isMeasurableCard, type ActionCard, type AdviceRecord, type CardAction, type CompetitorPost, type SocialPlatform } from "@nodaro/shared"
import { Button } from "@/components/ui/button"
import { MetaAdMedia } from "@/components/nodes/meta-ad-media"
import { initialOf, socialPostLink, whoOf } from "@/components/research/social-post-card"
import { SOCIAL_PLATFORM_META } from "@/components/research/social-platforms"
import { useT } from "@/lib/i18n"
import { useAppDir } from "@/lib/locale-store"
import { cn } from "@/lib/utils"
import { cardText, priorityLabel } from "./action-card-text"
import { brandHueStyle } from "./brand-colors"
import { CardMarkStrip } from "./card-mark-strip"
import { familyLabel, recordPill } from "./card-outcome-text"

const PRIORITY_TONE: Readonly<Record<ActionCard["priority"], string>> = {
  1: "bg-[#fde0eb] text-[#be1257] dark:bg-[#3a1225] dark:text-[#ff4d8f]",
  2: "bg-[#fdf0d6] text-[#945800] dark:bg-[#3a2a0e] dark:text-[#f5a524]",
  3: "bg-muted text-muted-foreground",
}

export interface SaveControls {
  readonly isSaved: (postId: string) => boolean
  readonly isBusy: (postId: string) => boolean
  readonly toggle: (post: CompetitorPost) => void
}

/** One post a card rests on: a thumbnail, who posted it, a link, and a bookmark. */
function EvidencePost({ post, save, wide }: { readonly post: CompetitorPost; readonly save: SaveControls; readonly wide?: boolean }) {
  const t = useT()
  const link = socialPostLink(post)
  const saved = save.isSaved(post.id)
  const words = wide ? (post.title || post.text).replace(/\s+/g, " ").trim() : ""
  return (
    <div className="flex min-w-0 items-center gap-2">
      <MetaAdMedia src={post.media.thumbnailUrl ?? post.author.avatarUrl ?? null} initial={initialOf(post)} className="h-7 w-7 shrink-0 rounded-md" />
      <div className="min-w-0">
        <div className="truncate text-[12px] font-semibold">{whoOf(post)}</div>
        {words && (
          <div className="truncate text-[11px] text-muted-foreground" dir="auto">
            {words}
          </div>
        )}
      </div>
      {link && (
        <a href={link} target="_blank" rel="noopener noreferrer" className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground" aria-label={t("social.openPost")} title={t("social.openPost")}>
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
        className={cn("shrink-0 rounded-md p-1 disabled:opacity-50", saved ? "text-[#FF0073]" : "text-muted-foreground hover:text-foreground")}
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

/** Whose card it is, as the wall shows it: the brand's name and color, or the market's. */
export interface CardBrand {
  /** The brand's name; null for a card about the market across brands. */
  readonly name: string | null
  readonly hue: number | undefined
}

/**
 * An action card: whose it is and where, what happened, what to do, and the
 * posts it rests on, with a top edge in the brand's color.
 */
export function ActionCardView({
  card,
  brand,
  platform,
  posts,
  save,
  marking,
  record,
}: {
  readonly card: ActionCard
  readonly brand: CardBrand
  /** The platform the card is about, when it has one. */
  readonly platform: SocialPlatform | null
  readonly posts: Readonly<Record<string, CompetitorPost>>
  readonly save: SaveControls
  readonly marking?: CardMarking
  /** How this card's family of advice has gone for the person, when there is enough to say. */
  readonly record?: AdviceRecord
}) {
  const t = useT()
  const isRtl = useAppDir() === "rtl"
  const [allPosts, setAllPosts] = useState(false)
  const moreId = useId()
  const text = cardText(card, t)
  const evidence = card.evidence.flatMap((id) => (posts[id] ? [posts[id]!] : []))
  const [first, ...rest] = evidence
  // One line under the title: the post's own words, else what the numbers say.
  const quote = text.quote || text.why
  const showWhy = Boolean(text.quote && text.why)
  const markable = marking?.canMark === true && isMeasurableCard(card)
  return (
    <article
      className={cn("flex flex-col gap-2 rounded-xl border border-t-[3px] border-border bg-card px-3.5 py-3", brand.hue === undefined ? "border-t-muted-foreground/40" : "brand-top")}
      style={brandHueStyle(brand.hue)}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[13px] font-semibold" dir="auto">
          {brand.name ?? t("competitors.acrossBrands")}
        </span>
        <div className="flex shrink-0 gap-1.5">
          {platform && <span className="rounded-full bg-muted px-2 py-[3px] text-[11px] font-semibold text-foreground/80">{SOCIAL_PLATFORM_META[platform].name}</span>}
          <span className={cn("rounded-full px-2 py-[3px] text-[11px] font-semibold", PRIORITY_TONE[card.priority])}>{priorityLabel(card, t)}</span>
        </div>
      </div>
      {record && (
        <span className="self-start rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:text-emerald-300" title={familyLabel(record.family, t)}>
          {familyLabel(record.family, t)} · {recordPill(record, t)}
        </span>
      )}
      {/* Our sentence: it follows the page's direction (dir="auto" would turn a Hebrew title that opens on a brand name around). */}
      <h3 className="text-[14px] font-semibold leading-[1.35]">{text.title}</h3>
      {showWhy && <p className="text-[12px] text-muted-foreground">{text.why}</p>}
      {quote && (
        <blockquote
          className="line-clamp-3 border-s-2 border-border ps-[9px] text-[12px] italic leading-[1.45] text-muted-foreground"
          dir={text.quote ? "auto" : undefined}
        >
          {quote}
        </blockquote>
      )}
      <p className="flex items-start gap-1.5 text-[13px] font-semibold leading-[1.4]">
        <ArrowRight className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", isRtl && "rotate-180")} aria-hidden />
        {text.action}
      </p>
      {(first || (markable && !marking?.action)) && (
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            {first && <EvidencePost post={first} save={save} />}
            {rest.length > 0 && (
              <button
                type="button"
                onClick={() => setAllPosts(!allPosts)}
                aria-expanded={allPosts}
                aria-controls={moreId}
                aria-label={allPosts ? undefined : t(rest.length === 1 ? "competitors.moreEvidenceLabelOne" : "competitors.moreEvidenceLabel", { n: rest.length })}
                className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
              >
                {allPosts ? t("common.less") : t("competitors.moreEvidence", { n: rest.length })}
              </button>
            )}
          </div>
          {markable && !marking?.action && (
            <Button variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-[12px] font-semibold" onClick={marking.onMark} disabled={marking.busy}>
              <CheckCircle2 className="me-1.5 h-4 w-4" />
              {t("marks.iDidThis")}
            </Button>
          )}
        </div>
      )}
      {allPosts && rest.length > 0 && (
        <div id={moreId} className="flex flex-col gap-1.5 border-t border-border/60 pt-2">
          {rest.map((post) => (
            <EvidencePost key={post.id} post={post} save={save} wide />
          ))}
        </div>
      )}
      {marking?.action && (
        <CardMarkStrip
          action={marking.action}
          posts={marking.posts}
          busy={marking.busy}
          linkOpen={marking.linkOpen}
          onLink={marking.onLink}
          onUndo={marking.onUndo}
          onLater={marking.onLater}
        />
      )}
    </article>
  )
}
