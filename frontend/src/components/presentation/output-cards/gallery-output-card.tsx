import { ImageGridOutput } from "./image-grid-output"
import { VideoCarouselOutput } from "./video-carousel-output"
import { AudioListOutput } from "./audio-list-output"
import { TextCollapsibleOutput } from "./text-collapsible-output"
import type { GalleryOutputProps } from "./shared"

export interface GalleryOutputCardProps extends GalleryOutputProps {
  outputType: string
  columns?: number
}

export function GalleryOutputCard({
  outputType,
  results,
  status,
  iterationTotal,
  iterationCompleted,
  onOpenMedia,
  columns,
}: GalleryOutputCardProps) {
  switch (outputType) {
    case "image":
      return (
        <ImageGridOutput
          results={results}
          status={status}
          iterationTotal={iterationTotal}
          iterationCompleted={iterationCompleted}
          onOpenMedia={onOpenMedia}
          columns={columns}
        />
      )
    case "video":
      return (
        <VideoCarouselOutput
          results={results}
          status={status}
          iterationTotal={iterationTotal}
          iterationCompleted={iterationCompleted}
          onOpenMedia={onOpenMedia}
        />
      )
    case "audio":
      return (
        <AudioListOutput
          results={results}
          status={status}
          iterationTotal={iterationTotal}
          iterationCompleted={iterationCompleted}
        />
      )
    case "text":
    default:
      return (
        <TextCollapsibleOutput
          results={results}
          status={status}
          iterationTotal={iterationTotal}
          iterationCompleted={iterationCompleted}
        />
      )
  }
}
