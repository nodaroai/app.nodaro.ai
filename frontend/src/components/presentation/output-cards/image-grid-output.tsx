import { CachedImage } from "@/components/ui/cached-image"
import { IterationProgress, type GalleryOutputProps } from "./shared"

interface ImageGridOutputProps extends GalleryOutputProps {
  columns?: number
}

export function ImageGridOutput({
  results,
  status,
  iterationTotal,
  iterationCompleted,
  onOpenMedia,
  columns,
}: ImageGridOutputProps) {
  return (
    <div>
      <IterationProgress status={status} iterationTotal={iterationTotal} iterationCompleted={iterationCompleted} />
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columns ?? 3}, 1fr)` }}>
        {results.filter(Boolean).map((url, i) => (
          <div
            key={i}
            className="aspect-square rounded-md overflow-hidden cursor-pointer relative group"
            onClick={() => onOpenMedia?.(url)}
          >
            <CachedImage
              src={url}
              alt={`Result ${i + 1}`}
              className="w-full h-full object-cover"
              thumbnail
              thumbnailWidth={240}
            />
            <div className="absolute bottom-0 left-0 right-0 px-1.5 py-0.5 bg-gradient-to-t from-black/50 text-white text-[9px]">
              #{i + 1}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
