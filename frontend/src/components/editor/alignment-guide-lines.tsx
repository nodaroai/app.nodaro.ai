import { useStore } from "@xyflow/react"
import type { GuideLine } from "@/hooks/use-alignment-guides"

interface AlignmentGuideLinesProps {
  readonly guides: readonly GuideLine[]
}

export function AlignmentGuideLines({ guides }: AlignmentGuideLinesProps) {
  const transform = useStore((s) => s.transform)
  const [tx, ty, zoom] = transform

  if (guides.length === 0) return null

  // Scale stroke so lines always appear 1px on screen regardless of zoom
  const scaledStrokeWidth = 1 / zoom
  const scaledDash = `${4 / zoom} ${3 / zoom}`

  return (
    <svg
      className="react-flow__alignment-guides"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 1000,
      }}
    >
      <g transform={`translate(${tx}, ${ty}) scale(${zoom})`}>
        {guides.map((guide, i) =>
          guide.orientation === "vertical" ? (
            <line
              key={`v-${i}`}
              x1={guide.position}
              y1={guide.from}
              x2={guide.position}
              y2={guide.to}
              stroke="#ff0073"
              strokeOpacity={0.7}
              strokeWidth={scaledStrokeWidth}
              strokeDasharray={scaledDash}
            />
          ) : (
            <line
              key={`h-${i}`}
              x1={guide.from}
              y1={guide.position}
              x2={guide.to}
              y2={guide.position}
              stroke="#ff0073"
              strokeOpacity={0.7}
              strokeWidth={scaledStrokeWidth}
              strokeDasharray={scaledDash}
            />
          ),
        )}
      </g>
    </svg>
  )
}
