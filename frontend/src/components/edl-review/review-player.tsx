"use client"

/**
 * The review inspector's player (§2.3 of the inspectors design, A3-4).
 *
 * THE SWITCH ( ● Preview ○ Original ): the take on display, labelled Preview or Final (R18 a); the newest
 * Preview beside a Final on display; Original. The take is a `<video>` (or an
 * `<audio>` for an audio render) of its URL; Original plays the original file
 * of the look the time takes (R6 a, audition.ts), both `preload="metadata"`.
 * The Original element mounts only once something is auditioned, so opening
 * the review fetches no original.
 *
 * STATES (M24): no take ("No preview yet."), and a take whose file fails to
 * load ("This take can't be loaded…"), each with Update preview (stop rule on)
 * and Render final behind the footer's gate. Original stays available in
 * both. The original shows "Loading original…" while it loads or seeks (its
 * files run to 8 GB) and says so when its file can't be loaded.
 *
 * What plays where, seeks and follow playback: use-review-playback.ts.
 */
import { AudioLines } from "lucide-react"
import type { SavedRenderItem } from "@nodaro/shared"
import type { ReviewModel } from "@/hooks/use-review-model"
import type { MediaBinding, PlayerTab, ReviewPlayback } from "@/hooks/use-review-playback"
import type { ReviewRuns } from "@/hooks/use-review-runs"
import { useT, type TFunction } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { PlayerTransport } from "./player-transport"
import { ReviewRunButtons } from "./review-run-buttons"

export interface ReviewPlayerProps {
  readonly model: ReviewModel
  readonly playback: ReviewPlayback
  readonly runs: ReviewRuns
}

const MEDIA = "absolute inset-0 h-full w-full object-contain"

function Media({ testId, url, medium, poster, binding, shown }: {
  readonly testId: string
  readonly url: string
  readonly medium: "video" | "audio"
  readonly poster?: string
  readonly binding: MediaBinding
  readonly shown: boolean
}) {
  const hidden = shown ? undefined : "hidden"
  if (medium === "audio") {
    return (
      <>
        {shown && <AudioLines aria-hidden className="absolute inset-0 m-auto h-10 w-10 text-white/50" />}
        <audio key={url} data-testid={testId} src={url} preload="metadata" className={hidden} {...binding} />
      </>
    )
  }
  return <video key={url} data-testid={testId} src={url} poster={poster} preload="metadata" playsInline className={cn(MEDIA, hidden)} {...binding} />
}

function Note({ children, runs }: { readonly children: string; readonly runs?: ReviewRuns }) {
  return (
    <div role="status" className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80 p-3 text-center text-xs text-white">
      <p>{children}</p>
      {runs && <div className="flex flex-wrap justify-center gap-2"><ReviewRunButtons runs={runs} /></div>}
    </div>
  )
}

function tabLabel(tab: PlayerTab, take: SavedRenderItem | undefined, t: TFunction): string {
  if (tab === "original") return t("edlReview.tabOriginal")
  if (tab === "preview" || !take || take.quality === "proxy") return t("edlReview.tabPreview")
  return t("edlReview.finalBadge")
}

export function ReviewPlayer({ model, playback, runs }: ReviewPlayerProps) {
  const t = useT()
  const { take, previewTake } = model
  const { tab, audition, status } = playback
  const onTake = tab !== "original"
  const shownTake = tab === "preview" ? previewTake : take
  const ready = onTake ? !!shownTake && status[tab] !== "error" : !!audition && status.original !== "error"

  return (
    <section data-testid="review-player" aria-label={t("edlReview.player")} className="flex flex-col gap-2">
      <div className="relative aspect-video w-full overflow-hidden rounded-md bg-black">
        {take && <Media testId="review-take-media" url={take.url} medium={take.medium} poster={take.thumbnailUrl} binding={playback.bind("take")} shown={tab === "take"} />}
        {previewTake && (
          <Media testId="review-preview-media" url={previewTake.url} medium={previewTake.medium} poster={previewTake.thumbnailUrl} binding={playback.bind("preview")} shown={tab === "preview"} />
        )}
        {audition && <Media testId="review-original-media" url={audition.url} medium={audition.medium} binding={playback.bind("original")} shown={!onTake} />}
        {onTake && !shownTake && <Note runs={runs}>{t("edlReview.noTake")}</Note>}
        {onTake && shownTake && status[tab] === "error" && <Note runs={runs}>{t("edlReview.takeLoadError")}</Note>}
        {!onTake && status.original === "loading" && <Note>{t("edlReview.loadingOriginal")}</Note>}
        {!onTake && status.original === "error" && <Note>{t("edlReview.originalLoadError")}</Note>}
      </div>
      <PlayerTransport playback={playback} ready={ready} />
      <div role="radiogroup" aria-label={t("edlReview.player")} className="inline-flex w-fit rounded-md bg-muted p-0.5 text-xs">
        {playback.tabs.map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={tab === id}
            className={cn("rounded px-2 py-0.5", tab === id ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
            onClick={() => playback.selectTab(id)}
          >
            {tabLabel(id, take, t)}
          </button>
        ))}
      </div>
    </section>
  )
}
