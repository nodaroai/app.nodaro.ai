import { memo } from "react"
import { ImageOutputCard } from "./output-cards/image-output-card"
import { VideoOutputCard } from "./output-cards/video-output-card"
import { AudioOutputCard } from "./output-cards/audio-output-card"
import { TextOutputCard } from "./output-cards/text-output-card"
import { GalleryOutputCard } from "./output-cards/gallery-output-card"
import { StatusBadge } from "./output-cards/shared"
import type { OutputCardActions } from "./output-cards/shared"
import { Progress } from "@/components/ui/progress"
import { FieldBadge } from "./field-badge"
import { useT } from "@/lib/i18n"
import { PreviewBadge } from "@/components/render/preview-badge"
import { AppGatedOutputCard, AppRenderReviewBar, useAppRenderReview } from "@/components/render/app-render-review"
import type { ExposableField } from "@nodaro/shared"

export interface FieldBadgeEntry {
  id: string
  fieldDef: ExposableField
  value: unknown
}

export interface OutputCardProps {
  nodeId: string
  /** Producing node type — threaded to cards that need it (e.g. switchx brand attribution). */
  nodeType?: string
  label: string
  outputType: string
  status: "idle" | "waiting" | "running" | "completed" | "failed" | "skipped"
  url?: string
  text?: string
  onOpenMedia?: (nodeId: string) => void
  /** 0–99 progress value; only shown when status is running/pending */
  progress?: number
  /** Multiple result URLs/texts from list/loop execution */
  listResults?: string[]
  /** "gallery" renders all results in one card; "individual" renders separate cards (default) */
  displayMode?: "gallery" | "individual"
  /** Total iterations expected (for progress display in gallery mode) */
  iterationTotal?: number
  /** Iterations completed so far */
  iterationCompleted?: number
  /** Element size for output rendering (sm, md, lg) */
  elementSize?: "sm" | "md" | "lg"
  /** Number of columns for gallery grid layouts */
  columns?: number
  /** Field badges to display below the media content */
  fieldBadges?: FieldBadgeEntry[]
  /** Action callbacks for share/edit/hide */
  actions?: OutputCardActions
  /** The output is a Preview — a render at proxy quality (F1, `outputIsPreview`). */
  preview?: boolean
  /** The app run this card shows, where a surface lists several (the chat
   *  thread). Absent: the run on show. Only that run's cards carry Render final. */
  runId?: string
}

/** Renders the appropriate output card based on output type */
function OutputCardImpl({
  nodeId,
  nodeType,
  label,
  outputType,
  status,
  url: runUrl,
  text,
  onOpenMedia,
  progress,
  listResults,
  displayMode,
  iterationTotal,
  iterationCompleted,
  elementSize,
  columns,
  fieldBadges,
  actions,
  preview: runPreview,
  runId,
}: OutputCardProps) {
  const t = useT()
  // The app runner's review of this card (Render final in the app runner):
  // a node that waited for the final never shows the snapshot's output; a
  // render's card carries its Render final, and its final's "Show preview".
  const review = useAppRenderReview(nodeId, nodeType, runId)
  if (review?.kind === "gated") return <AppGatedOutputCard label={label} />
  const showingPreview = review?.kind === "final" && review.showingPreview
  const url = showingPreview ? (review.previewUrl ?? runUrl) : runUrl
  const preview = showingPreview || runPreview
  const reviewBar = review ? <AppRenderReviewBar review={review} /> : null
  const showProgress = status === "running" || status === "waiting"
  const progressValue = progress ?? 0
  const badgeRow = fieldBadges && fieldBadges.length > 0 ? (
    <div className="flex flex-wrap gap-1 mt-2 px-1">
      {fieldBadges.map((fb) => (
        <FieldBadge key={fb.id} field={fb.fieldDef} value={fb.value} />
      ))}
    </div>
  ) : null

  // The run skipped this node for want of input (a feed with no new posts):
  // a quiet "nothing new" card, never an empty media frame or a failure.
  if (status === "skipped") {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-foreground">{label}</span>
          <StatusBadge status={status} />
        </div>
        <div className="rounded-lg border border-dashed border-border/60 px-3 py-6 text-center text-xs text-muted-foreground">
          {t("present.nothingNewCard")}
        </div>
        {badgeRow}
      </div>
    )
  }

  // Gallery mode: multiple results in a single card
  if (listResults && listResults.length > 1 && displayMode === "gallery") {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-foreground">{label}</span>
            {preview && <PreviewBadge />}
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#ff0073]/10 text-[#ff0073] font-medium">
              {t("present.resultsCount", { n: listResults.length })}
            </span>
          </div>
          <StatusBadge status={status} />
        </div>
        <GalleryOutputCard
          outputType={outputType}
          results={listResults}
          status={status}
          iterationTotal={iterationTotal}
          iterationCompleted={iterationCompleted}
          onOpenMedia={onOpenMedia ? () => onOpenMedia(nodeId) : undefined}
          columns={columns}
        />
        {badgeRow}
        {reviewBar}
        {showProgress && (
          <div className="px-1">
            <Progress
              value={progressValue}
              className="h-2 bg-primary/20 [&>[data-slot=progress-indicator]]:bg-[#ff0073]"
            />
            <p className="mt-1 text-xs text-muted-foreground text-center">{progressValue}%</p>
          </div>
        )}
      </div>
    )
  }

  // Single-result mode (default)
  const card = (() => {
    switch (outputType) {
      case "image":
        return <ImageOutputCard label={label} status={status} url={url} nodeId={nodeId} onOpenMedia={onOpenMedia} elementSize={elementSize} actions={actions} />
      case "video":
        return <VideoOutputCard label={label} status={status} url={url} nodeId={nodeId} nodeType={nodeType} onOpenMedia={onOpenMedia} elementSize={elementSize} actions={actions} preview={preview} />
      case "audio":
        return <AudioOutputCard label={label} status={status} url={url} elementSize={elementSize} nodeId={nodeId} actions={actions} preview={preview} />
      case "text":
        return <TextOutputCard label={label} status={status} text={text} nodeId={nodeId} actions={actions} />
      default:
        return <TextOutputCard label={label} status={status} text={text ?? url} nodeId={nodeId} actions={actions} />
    }
  })()

  if (!showProgress && !badgeRow && !reviewBar) return card

  return (
    <div className="flex flex-col gap-2">
      {card}
      {badgeRow}
      {reviewBar}
      {showProgress && (
        <div className="px-1">
          <Progress
            value={progress}
            className="h-2 bg-primary/20 [&>[data-slot=progress-indicator]]:bg-[#ff0073]"
          />
          <p className="mt-1 text-xs text-muted-foreground text-center">{progress}%</p>
        </div>
      )}
    </div>
  )
}

/** Memoized so presentation-view's 2s poll re-render doesn't reconcile every
 *  output card — props (actions/fieldBadges/onOpenMedia) are stabilized upstream
 *  so unchanged nodes bail the shallow compare. */
export const OutputCard = memo(OutputCardImpl)
