"use client"

import { useEffect, useState, type FormEvent } from "react"
import { CheckCircle2, Clock, ExternalLink, Link2, Minus, MoreHorizontal, TrendingDown, Undo2, Unlink } from "lucide-react"
import type { CardAction, CompetitorPost } from "@nodaro/shared"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { MetaAdMedia } from "@/components/nodes/meta-ad-media"
import { initialOf, socialPostLink, whoOf } from "@/components/research/social-post-card"
import { useT } from "@/lib/i18n"
import { useAppDir } from "@/lib/locale-store"
import { cn } from "@/lib/utils"
import { isPendingMark, outcomeText, ratioText, type OutcomeTone } from "./card-outcome-text"
import { useCountUp } from "./use-count-up"

export const TONE_CLASS: Readonly<Record<OutcomeTone, string>> = {
  worked: "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
  neutral: "border-border bg-muted/60 text-foreground",
  muted: "border-border bg-muted/40 text-muted-foreground",
  pending: "border-dashed border-border bg-background text-muted-foreground",
}

export function ToneIcon({ tone, className }: { readonly tone: OutcomeTone; readonly className?: string }) {
  if (tone === "worked") return <CheckCircle2 className={className} />
  if (tone === "neutral") return <Minus className={className} />
  if (tone === "muted") return <TrendingDown className={className} />
  return <Clock className={className} />
}

const LINK_RE = /^https?:\/\/\S+$/i

/** A post of the person's, to pick or to show: thumbnail, who, link. */
export function MarkPostChip({ post, onPick, disabled }: { readonly post: CompetitorPost; readonly onPick?: () => void; readonly disabled?: boolean }) {
  const t = useT()
  const link = socialPostLink(post)
  const body = (
    <>
      <MetaAdMedia src={post.media.thumbnailUrl ?? post.author.avatarUrl ?? null} initial={initialOf(post)} className="h-9 w-9 shrink-0 rounded-md" />
      <span className="min-w-0 flex-1 truncate text-start text-[11px]" dir="auto">
        {(post.title || post.text).replace(/\s+/g, " ").trim() || whoOf(post)}
      </span>
    </>
  )
  if (onPick) {
    return (
      <button
        type="button"
        onClick={onPick}
        disabled={disabled}
        title={t("marks.thisOne")}
        className="flex min-w-0 items-center gap-1.5 rounded-lg border bg-background p-1 hover:border-foreground/40 disabled:opacity-50"
      >
        {body}
      </button>
    )
  }
  return (
    <div className="flex min-w-0 items-center gap-1.5 rounded-lg border bg-background p-1">
      {body}
      {link && (
        <a href={link} target="_blank" rel="noopener noreferrer" className="rounded-md p-1 text-muted-foreground hover:text-foreground" aria-label={t("social.openPost")} title={t("social.openPost")}>
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
    </div>
  )
}

/** How a worked verdict counts up: armed (waiting to be seen), playing, or still. */
export interface Celebrate {
  /** Count up now (seen for the first time, and in view). */
  readonly play: boolean
  /** Not seen yet: show the start of the count until it plays. */
  readonly armed: boolean
  readonly onPlayed: () => void
}

/** A worked verdict's multiplier, big: counts up the first time it is seen. */
function VerdictNumber({ ratio, celebrate }: { readonly ratio: number; readonly celebrate: Celebrate }) {
  const t = useT()
  const value = useCountUp(ratio, celebrate.play, celebrate.onPlayed)
  const shown = celebrate.armed && !celebrate.play ? 1 : value
  return (
    <>
      <span aria-hidden className="text-[28px] font-extrabold leading-none tabular-nums">
        {ratioText(Math.round(shown * 10) / 10, t)}
      </span>
      <span className="sr-only">{ratioText(ratio, t)}</span>
    </>
  )
}

/**
 * Under a card the person marked "I did this": how it went (or what happens
 * next), the post it was judged on, a place to link the post that came of it
 * (or pick it from their posts since), and change / remove link / undo.
 */
export function CardMarkStrip({
  action,
  posts,
  busy,
  linkOpen: linkOpenInitially = false,
  celebrate,
  onLink,
  onUndo,
  onLater,
}: {
  readonly action: CardAction
  readonly posts: Readonly<Record<string, CompetitorPost>>
  readonly busy?: boolean
  /** Open the link field at once (right after marking). */
  readonly linkOpen?: boolean
  /** A worked verdict shows its multiplier big; it counts up once when it plays. */
  readonly celebrate?: Celebrate
  readonly onLink: (postUrl: string | null) => void
  readonly onUndo: () => void
  /** "Later": close the link field (the card moves to Tried). */
  readonly onLater?: () => void
}) {
  const t = useT()
  const isRtl = useAppDir() === "rtl"
  const text = outcomeText(action.outcome, t)
  const [linkOpen, setLinkOpen] = useState(linkOpenInitially)
  const [url, setUrl] = useState("")
  const [invalid, setInvalid] = useState(false)
  const pending = isPendingMark(action)
  // A link the server took closes the field; a refused one leaves what was typed.
  useEffect(() => {
    if (!action.postUrl) return
    setUrl("")
    setLinkOpen(false)
  }, [action.postUrl])
  const judgedId = action.outcome.postIds?.[0]
  const judged = judgedId && (action.verdict || action.outcome.matchedBy) ? posts[judgedId] : undefined
  const candidates = (action.outcome.candidates ?? []).flatMap((id) => (posts[id] ? [posts[id]!] : []))
  const showLink = !pending && (linkOpen || (text.askLink && !action.postUrl && !action.verdict))
  const big = celebrate && action.outcome.state === "worked" && typeof action.outcome.ratio === "number"

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const value = url.trim()
    if (!LINK_RE.test(value)) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    onLink(value)
  }

  return (
    <div className={cn("flex flex-col gap-2 rounded-lg border p-2", TONE_CLASS[text.tone])}>
      {big && <VerdictNumber ratio={action.outcome.ratio!} celebrate={celebrate} />}
      <div className="flex items-start gap-2">
        <ToneIcon tone={text.tone} className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1" aria-live="polite">
          <p className="text-[12.5px] font-semibold leading-snug">{pending ? t("marks.marking") : text.headline}</p>
          {!pending && text.detail && <p className="text-[11.5px] opacity-80">{text.detail}</p>}
        </div>
        {!pending && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" aria-label={t("marks.more")} title={t("marks.more")} disabled={busy}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setLinkOpen(true)}>
                <Link2 className="me-2 h-3.5 w-3.5" />
                {action.postUrl ? t("marks.changeLink") : t("marks.linkPost")}
              </DropdownMenuItem>
              {action.postUrl && (
                <DropdownMenuItem onSelect={() => onLink(null)}>
                  <Unlink className="me-2 h-3.5 w-3.5" />
                  {t("marks.removeLink")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={onUndo}>
                <Undo2 className={cn("me-2 h-3.5 w-3.5", isRtl && "-scale-x-100")} />
                {t("marks.undo")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {judged && <MarkPostChip post={judged} />}
      {action.outcome.matchedBy === "sound" && <p className="text-[11px] opacity-80">{t("marks.matchedBySound")}</p>}

      {showLink && (
        <div className="flex flex-col gap-1.5 text-foreground">
          {candidates.length > 0 && (
            <>
              <span className="text-[11px] font-semibold text-muted-foreground">{t("marks.isItOneOfThese")}</span>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {candidates.slice(0, 4).map((post) => (
                  <MarkPostChip key={post.id} post={post} disabled={busy} onPick={() => onLink(post.url)} />
                ))}
              </div>
            </>
          )}
          <form onSubmit={submit} className="flex items-center gap-1.5">
            <Input
              value={url}
              onChange={(e) => {
                setUrl(e.target.value)
                setInvalid(false)
              }}
              placeholder={t("marks.linkPlaceholder")}
              aria-label={t("marks.linkPost")}
              aria-invalid={invalid}
              inputMode="url"
              dir="ltr"
              className="h-8 text-[12px]"
              disabled={busy}
            />
            <Button type="submit" size="sm" className="h-8" disabled={busy || url.trim() === ""}>
              {t("marks.link")}
            </Button>
            {onLater && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8"
                onClick={() => {
                  setLinkOpen(false)
                  onLater()
                }}
              >
                {t("marks.later")}
              </Button>
            )}
          </form>
          {invalid && <p className="text-[11px] text-destructive">{t("marks.linkInvalid")}</p>}
        </div>
      )}
    </div>
  )
}
