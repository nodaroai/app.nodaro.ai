import type { CompositeLayerConfig } from "@/types/nodes"

const LAYER_COLORS = [
  "#3B82F6", // blue
  "#10B981", // emerald
  "#F59E0B", // amber
  "#EF4444", // red
]

const ASPECT_RATIOS: Record<string, { w: number; h: number }> = {
  "16:9": { w: 16, h: 9 },
  "9:16": { w: 9, h: 16 },
  "1:1": { w: 1, h: 1 },
  "4:5": { w: 4, h: 5 },
}

interface CompositePreviewProps {
  readonly layers: CompositeLayerConfig[]
  readonly aspectRatio: string
}

export function CompositePreview({ layers, aspectRatio }: CompositePreviewProps) {
  const ratio = ASPECT_RATIOS[aspectRatio] ?? ASPECT_RATIOS["16:9"]
  const maxWidth = 280
  const containerWidth = maxWidth
  const containerHeight = (maxWidth * ratio.h) / ratio.w

  const sortedLayers = [...layers].sort((a, b) => a.zIndex - b.zIndex)

  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-medium text-muted-foreground">Layer Preview</div>
      <div
        className="relative rounded-md border border-[var(--border-primary)] bg-muted/20 overflow-hidden mx-auto"
        style={{ width: containerWidth, height: containerHeight }}
      >
        {sortedLayers.map((layer, idx) => {
          const color = LAYER_COLORS[idx % LAYER_COLORS.length]
          const isFullscreen = layer.position === "fullscreen"

          return (
            <div
              key={layer.id}
              className="absolute border-2 rounded-sm flex items-center justify-center"
              style={{
                borderColor: color,
                backgroundColor: `${color}20`,
                left: isFullscreen ? 0 : `${layer.x}%`,
                top: isFullscreen ? 0 : `${layer.y}%`,
                width: isFullscreen ? "100%" : `${layer.width}%`,
                height: isFullscreen ? "100%" : `${layer.height}%`,
                opacity: Math.max(0.4, layer.opacity),
              }}
            >
              <span
                className="text-[9px] font-mono font-medium px-1 rounded"
                style={{ backgroundColor: color, color: "#fff" }}
              >
                {layer.inputHandle}
              </span>
            </div>
          )
        })}

        {sortedLayers.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground/50">
            No layers
          </div>
        )}
      </div>
    </div>
  )
}
