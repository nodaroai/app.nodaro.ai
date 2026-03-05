import { Image } from "lucide-react"
import { isVideoUrl } from "@/lib/media-type"

interface WorkflowThumbnailProps {
  readonly thumbnailUrl: string | null
}

export function WorkflowThumbnail({ thumbnailUrl }: WorkflowThumbnailProps) {
  return (
    <div className="aspect-[4/3] bg-muted/50 overflow-hidden">
      {thumbnailUrl ? (
        isVideoUrl(thumbnailUrl) ? (
          <video
            src={thumbnailUrl}
            muted
            loop
            autoPlay
            playsInline
            className="w-full h-full object-cover"
          />
        ) : (
          <img
            src={thumbnailUrl}
            alt=""
            className="w-full h-full object-cover"
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
