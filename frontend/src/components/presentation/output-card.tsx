import { ImageOutputCard } from "./output-cards/image-output-card"
import { VideoOutputCard } from "./output-cards/video-output-card"
import { AudioOutputCard } from "./output-cards/audio-output-card"
import { TextOutputCard } from "./output-cards/text-output-card"
import { GalleryOutputCard } from "./output-cards/gallery-output-card"
import { StatusBadge } from "./output-cards/shared"
import type { OutputCardActions } from "./output-cards/shared"
import { Progress } from "@/components/ui/progress"
import { FieldBadge } from "./field-badge"
import type { ExposableField } from "@nodaro/shared"

export interface FieldBadgeEntry {
  id: string
  fieldDef: ExposableField
  value: unknown
}

export interface OutputCardProps {
  nodeId: string
  label: string
  outputType: string
  status: "idle" | "waiting" | "running" | "completed" | "failed"
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
}

/** Renders the appropriate output card based on output type */
export function OutputCard({
  nodeId,
  label,
  outputType,
  status,
  url,
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
}: OutputCardProps) {
  const showProgress = (status === "running" || status === "waiting") && progress != null
  const badgeRow = fieldBadges && fieldBadges.length > 0 ? (
    <div className="flex flex-wrap gap-1 mt-2 px-1">
      {fieldBadges.map((fb) => (
        <FieldBadge key={fb.id} field={fb.fieldDef} value={fb.value} />
      ))}
    </div>
  ) : null

  // Gallery mode: multiple results in a single card
  if (listResults && listResults.length > 1 && displayMode === "gallery") {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-foreground">{label}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#ff0073]/10 text-[#ff0073] font-medium">
              {listResults.length} results
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

  // Single-result mode (default)
  const card = (() => {
    switch (outputType) {
      case "image":
        return <ImageOutputCard label={label} status={status} url={url} nodeId={nodeId} onOpenMedia={onOpenMedia} elementSize={elementSize} actions={actions} />
      case "video":
        return <VideoOutputCard label={label} status={status} url={url} nodeId={nodeId} onOpenMedia={onOpenMedia} elementSize={elementSize} actions={actions} />
      case "audio":
        return <AudioOutputCard label={label} status={status} url={url} elementSize={elementSize} nodeId={nodeId} actions={actions} />
      case "text":
        return <TextOutputCard label={label} status={status} text={text} nodeId={nodeId} actions={actions} />
      default:
        return <TextOutputCard label={label} status={status} text={text ?? url} nodeId={nodeId} actions={actions} />
    }
  })()

  if (!showProgress && !badgeRow) return card

  return (
    <div className="flex flex-col gap-2">
      {card}
      {badgeRow}
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
