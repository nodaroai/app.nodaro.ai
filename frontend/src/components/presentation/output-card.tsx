import { ImageOutputCard } from "./output-cards/image-output-card"
import { VideoOutputCard } from "./output-cards/video-output-card"
import { AudioOutputCard } from "./output-cards/audio-output-card"
import { TextOutputCard } from "./output-cards/text-output-card"
import { Progress } from "@/components/ui/progress"

export interface OutputCardProps {
  nodeId: string
  label: string
  outputType: string
  status: "idle" | "running" | "completed" | "failed"
  url?: string
  text?: string
  onOpenMedia?: (nodeId: string) => void
  /** 0–99 progress value; only shown when status is running/pending */
  progress?: number
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
}: OutputCardProps) {
  const showProgress = (status === "running") && progress != null

  const card = (() => {
    switch (outputType) {
      case "image":
        return <ImageOutputCard label={label} status={status} url={url} nodeId={nodeId} onOpenMedia={onOpenMedia} />
      case "video":
        return <VideoOutputCard label={label} status={status} url={url} nodeId={nodeId} onOpenMedia={onOpenMedia} />
      case "audio":
        return <AudioOutputCard label={label} status={status} url={url} />
      case "text":
        return <TextOutputCard label={label} status={status} text={text} />
      default:
        return <TextOutputCard label={label} status={status} text={text ?? url} />
    }
  })()

  if (!showProgress) return card

  return (
    <div className="flex flex-col gap-2">
      {card}
      <div className="px-1">
        <Progress
          value={progress}
          className="h-2 bg-primary/20 [&>[data-slot=progress-indicator]]:bg-[#ff0073]"
        />
        <p className="mt-1 text-xs text-muted-foreground text-center">{progress}%</p>
      </div>
    </div>
  )
}
