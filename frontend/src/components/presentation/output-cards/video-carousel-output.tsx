import { useState } from "react"
import { IterationProgress, type GalleryOutputProps } from "./shared"

export function VideoCarouselOutput({
  results,
  status,
  iterationTotal,
  iterationCompleted,
  onOpenMedia,
}: GalleryOutputProps) {
  const [activeIndex, setActiveIndex] = useState(0)
  const filtered = results.filter(Boolean)

  return (
    <div>
      <IterationProgress status={status} iterationTotal={iterationTotal} iterationCompleted={iterationCompleted} />

      {/* Main video */}
      <div className="relative aspect-video rounded-lg overflow-hidden bg-black">
        {filtered[activeIndex] && (
          <video
            src={filtered[activeIndex]}
            controls
            className="w-full h-full object-contain"
            onClick={() => onOpenMedia?.(filtered[activeIndex])}
          />
        )}
        {/* Counter */}
        {filtered.length > 0 && (
          <div className="absolute top-2 right-2 bg-black/60 text-white text-xs px-2 py-0.5 rounded pointer-events-none">
            {activeIndex + 1} / {filtered.length}
          </div>
        )}
        {/* Prev/Next arrows */}
        {filtered.length > 1 && (
          <>
            <button
              onClick={() => setActiveIndex(Math.max(0, activeIndex - 1))}
              disabled={activeIndex === 0}
              className="absolute left-1 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-card/80 border border-border flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30"
            >
              &#8249;
            </button>
            <button
              onClick={() => setActiveIndex(Math.min(filtered.length - 1, activeIndex + 1))}
              disabled={activeIndex === filtered.length - 1}
              className="absolute right-1 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-card/80 border border-border flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30"
            >
              &#8250;
            </button>
          </>
        )}
      </div>

      {/* Thumbnail strip */}
      {filtered.length > 1 && (
        <div className="flex gap-1.5 mt-2 overflow-x-auto">
          {filtered.map((url, i) => (
            <button
              key={i}
              onClick={() => setActiveIndex(i)}
              className={`w-16 h-9 rounded flex-shrink-0 overflow-hidden border-2 ${
                i === activeIndex ? "border-[#ff0073]" : "border-transparent opacity-60"
              }`}
            >
              <video src={url} preload="none" className="w-full h-full object-cover" muted />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
