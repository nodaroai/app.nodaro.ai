import { ImageOutputCard } from "./output-cards/image-output-card"
import { VideoOutputCard } from "./output-cards/video-output-card"
import { AudioOutputCard } from "./output-cards/audio-output-card"
import { TextOutputCard } from "./output-cards/text-output-card"

export interface OutputCardProps {
  nodeId: string
  label: string
  outputType: string
  status: "idle" | "running" | "completed" | "failed"
  url?: string
  text?: string
  onOpenMedia?: (nodeId: string) => void
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
}: OutputCardProps) {
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
}
