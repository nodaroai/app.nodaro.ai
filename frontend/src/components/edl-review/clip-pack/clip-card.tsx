"use client"

/**
 * One planned clip (§4.2 of the inspectors design, A4-2; M17–M21): its badge
 * (PREVIEW, FINAL or DROPPED), number, play button and duration over the
 * poster; the title (read-only, TA20 a); where it sits in the source; the hook
 * (text only, TA20 a: read-only while dropped or locked); the Keep switch; and
 * a state line — no preview yet, rendering, failed, stale, final.
 *
 * The take on show is the clip's Final, else its Preview. Its poster is the
 * server-side thumbnail; the `<video>` mounts only when the card is the one
 * playing (`useSinglePlayback`), `preload="none"`. An audio render's take is a
 * tile with no picture and the same play button; its `<audio>` mounts the same way.
 * In the windowed grid (`fixedHeight`) the poster is capped so the card's lower
 * half always fits (`clip-card-layout.ts`).
 */
import { memo } from "react"
import { AudioLines, Check, Loader2, Pencil, Play, TriangleAlert } from "lucide-react"
import type { SavedRenderItem } from "@nodaro/shared"
import { PreviewBadge } from "@/components/render/preview-badge"
import { CachedImage } from "@/components/ui/cached-image"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import type { ClipCard as ClipCardModel } from "@/lib/edl-review/build-clip-cards"
import { positionOf } from "@/lib/edl-review/review-time"
import { useT, type TFunction } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export interface ClipCardProps {
  readonly card: ClipCardModel
  /** Clips the run is rendering (for "Final 2/6"); absent when none is live. */
  readonly progress?: { readonly done: number; readonly total: number }
  /** Hook and Keep are editable. */
  readonly canEdit: boolean
  readonly playing: boolean
  readonly onPlay: (clipKey: string) => void
  readonly onKeep: (row: number, keep: boolean) => void
  readonly onHook: (row: number, hook: string) => void
  readonly onResetHook: (row: number) => void
  /** A fixed height, for the virtualised grid. */
  readonly fixedHeight?: boolean
}

const CHIP = "inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide"

function StateLine({ card, progress, t }: { readonly card: ClipCardModel; readonly progress: ClipCardProps["progress"]; readonly t: TFunction }) {
  const line = (icon: React.ReactNode, text: string, tone = "text-muted-foreground") => (
    <p data-testid="clip-state" className={cn("flex min-w-0 items-start gap-1 text-[11px] leading-snug", tone)}>
      {icon}
      <span className="min-w-0">{text}</span>
    </p>
  )
  switch (card.state) {
    case "preview-rendering":
      return line(<Loader2 className="mt-0.5 h-3 w-3 shrink-0 animate-spin" aria-hidden />, t("clipReview.state.previewRendering"))
    case "final-rendering":
      return line(
        <Loader2 className="mt-0.5 h-3 w-3 shrink-0 animate-spin" aria-hidden />,
        progress ? t("clipReview.state.finalRendering", { done: progress.done, total: progress.total }) : t("renderFinal.toastFinal"),
      )
    case "preview-failed":
      return line(
        <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />,
        `${t("clipReview.state.previewFailed")}. ${t("clipReview.state.previewFailedNote")}`,
        "text-amber-700 dark:text-amber-400",
      )
    case "preview-stale":
      return line(<TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />, t("clipReview.state.previewStale"), "text-amber-700 dark:text-amber-400")
    case "final-ready":
      return line(<Check className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />, t("clipReview.state.finalReady"), "text-emerald-700 dark:text-emerald-400")
    case "final-not-in-set":
      return line(<Check className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />, t("clipReview.state.finalNotInSet"))
    case "audio-only":
      return line(<AudioLines className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />, t("clipReview.state.audioOnly"))
    case "no-preview":
      return line(null, t("clipReview.state.noPreview"))
    case "preview":
      return null
  }
}

function Poster({ take, playing, label, onPlay }: { readonly take: SavedRenderItem; readonly playing: boolean; readonly label: string; readonly onPlay: () => void }) {
  if (take.medium === "audio") {
    // Like a video: a play button until pressed, and the player mounts only for the
    // card that is playing, so one clip sounds at a time and 40 players never mount.
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-muted/60 px-2">
        <AudioLines aria-hidden className="h-6 w-6 text-muted-foreground" />
        {playing ? (
          <audio src={take.url} preload="none" controls autoPlay className="w-full" aria-label={label} />
        ) : (
          <button type="button" aria-label={label} onClick={onPlay} className="group flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80">
            <Play className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>
    )
  }
  if (playing) {
    return <video src={take.url} poster={take.thumbnailUrl} preload="none" controls autoPlay playsInline className="absolute inset-0 h-full w-full bg-black object-contain" />
  }
  return (
    <button type="button" aria-label={label} onClick={onPlay} className="group absolute inset-0 flex items-center justify-center bg-black/80">
      {take.thumbnailUrl && <CachedImage src={take.thumbnailUrl} thumbnail alt="" className="absolute inset-0 h-full w-full object-cover" />}
      <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white transition-colors group-hover:bg-black/80">
        <Play className="h-4 w-4" aria-hidden />
      </span>
    </button>
  )
}

function ClipCardView({ card, progress, canEdit, playing, onPlay, onKeep, onHook, onResetHook, fixedHeight }: ClipCardProps) {
  const t = useT()
  const take = card.final ?? card.preview
  const editable = canEdit && card.keep
  const number = card.row + 1
  const badge = !card.keep ? (
    <span className={cn(CHIP, "bg-muted text-muted-foreground")}>{t("clipReview.dropped")}</span>
  ) : card.final ? (
    <span className={cn(CHIP, "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400")}>{t("edlReview.finalBadge")}</span>
  ) : card.preview ? (
    <PreviewBadge />
  ) : null
  const hookValue = card.hook ?? ""
  return (
    <article
      data-testid={`clip-card-${card.row}`}
      data-state={card.state}
      data-keep={card.keep}
      aria-label={t("clipReview.cardLabel", { n: number })}
      className={cn("flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-card p-2", fixedHeight && "h-[432px] overflow-hidden")}
    >
      <div className={cn("relative aspect-video w-full overflow-hidden rounded-md bg-muted", fixedHeight && "max-h-[168px]", !card.keep && "opacity-60")}>
        {take && <Poster take={take} playing={playing} label={t("clipReview.play", { n: number })} onPlay={() => onPlay(card.clipKey)} />}
        <div className="pointer-events-none absolute inset-x-1.5 top-1.5 flex items-center gap-1.5">
          {badge}
          <span className="rounded bg-black/60 px-1 text-[10px] font-medium tabular-nums text-white">#{number}</span>
        </div>
        <span className="pointer-events-none absolute bottom-1.5 end-1.5 rounded bg-black/60 px-1 text-[10px] tabular-nums text-white" dir="ltr">
          {positionOf(card.durationMs)}
        </span>
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium" title={card.title}>{card.title ?? t("clipReview.untitled")}</p>
        <p className="text-[11px] tabular-nums text-muted-foreground" dir="ltr">
          {t("clipReview.sourceSpan", { from: positionOf(card.sourceSpan.inMs), to: positionOf(card.sourceSpan.outMs) })}
        </p>
      </div>
      <label className="flex min-w-0 flex-col gap-1 text-[11px] text-muted-foreground">
        {editable ? t("clipReview.hook") : t("clipReview.hookReadOnly")}
        <Textarea
          rows={2}
          value={hookValue}
          readOnly={!editable}
          placeholder={t("clipReview.hookPlaceholder")}
          onChange={(e) => onHook(card.row, e.target.value)}
          className="min-h-0 resize-none text-xs md:text-xs"
        />
      </label>
      {card.hookEdited && (
        <p className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          <Pencil className="h-3 w-3 shrink-0" aria-hidden />
          <span>{t("clipReview.edited")}</span>
          {canEdit && (
            <button type="button" className="underline hover:text-foreground" onClick={() => onResetHook(card.row)}>{t("clipReview.resetHook")}</button>
          )}
          {card.plannedHook !== undefined && <span className="min-w-0 truncate" title={card.plannedHook}>{t("clipReview.plannedHook", { hook: card.plannedHook })}</span>}
        </p>
      )}
      <div className="mt-auto flex flex-col gap-1.5">
        <label className="flex items-center gap-2 text-xs font-medium">
          <Switch size="sm" checked={card.keep} disabled={!canEdit} onCheckedChange={(keep) => onKeep(card.row, keep)} aria-label={t("clipReview.keep")} />
          {t("clipReview.keep")}
        </label>
        <StateLine card={card} progress={progress} t={t} />
      </div>
    </article>
  )
}

export const ClipCardTile = memo(ClipCardView)
