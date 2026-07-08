import { Image } from "lucide-react"
import { isVideoUrl } from "@/lib/media-type"
import { CachedImage } from "@/components/ui/cached-image"
import { PreviewVideo } from "@/components/ui/preview-video"

interface WorkflowThumbnailProps {
  readonly thumbnailUrl: string | null
}

export function WorkflowThumbnail({ thumbnailUrl }: WorkflowThumbnailProps) {
  return (
    <div className="aspect-[4/3] bg-muted/50 overflow-hidden">
      {thumbnailUrl ? (
        isVideoUrl(thumbnailUrl) ? (
          // Shared hover-to-play primitive: preload="metadata" paints the first
          // frame so the tile is never blank until hover (the reported bug).
          <PreviewVideo src={thumbnailUrl} className="w-full h-full object-cover" />
        ) : (
          <CachedImage
            src={thumbnailUrl}
            alt=""
            className="w-full h-full object-cover"
            thumbnail
            thumbnailWidth={320}
          />
        )
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <Image className="h-8 w-8 text-muted-foreground/30" />
        </div>
      )}
    </div>
  )
}
