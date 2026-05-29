import { useRef } from "react"
import { Image } from "lucide-react"
import { isVideoUrl } from "@/lib/media-type"
import { CachedImage } from "@/components/ui/cached-image"

interface WorkflowThumbnailProps {
  readonly thumbnailUrl: string | null
}

export function WorkflowThumbnail({ thumbnailUrl }: WorkflowThumbnailProps) {
  const videoRef = useRef<HTMLVideoElement>(null)

  return (
    <div className="aspect-[4/3] bg-muted/50 overflow-hidden">
      {thumbnailUrl ? (
        isVideoUrl(thumbnailUrl) ? (
          <video
            ref={videoRef}
            src={thumbnailUrl}
            muted
            loop
            playsInline
            preload="none"
            className="w-full h-full object-cover"
            onMouseEnter={() => { void videoRef.current?.play() }}
            onMouseLeave={() => { videoRef.current?.pause() }}
          />
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
