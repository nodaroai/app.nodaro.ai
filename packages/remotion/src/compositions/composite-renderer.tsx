import React from "react"
import { AbsoluteFill, Video, Sequence } from "remotion"
import type { CompositePlan, CompositeLayer } from "../plan-types"

interface CompositeRendererProps {
  readonly plan: CompositePlan
}

const BLEND_MODE_MAP: Record<CompositeLayer["blendMode"], React.CSSProperties["mixBlendMode"]> = {
  normal: "normal",
  multiply: "multiply",
  screen: "screen",
  overlay: "overlay",
}

function CompositeLayerView({ layer }: { readonly layer: CompositeLayer }) {
  const blendMode = BLEND_MODE_MAP[layer.blendMode] ?? "normal"

  if (layer.position === "fullscreen") {
    return (
      <AbsoluteFill style={{ opacity: layer.opacity, mixBlendMode: blendMode }}>
        <Video
          src={layer.sourceVideo}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </AbsoluteFill>
    )
  }

  return (
    <div
      style={{
        position: "absolute",
        left: `${layer.x}%`,
        top: `${layer.y}%`,
        width: `${layer.width}%`,
        height: `${layer.height}%`,
        opacity: layer.opacity,
        mixBlendMode: blendMode,
        overflow: "hidden",
      }}
    >
      <Video
        src={layer.sourceVideo}
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
    </div>
  )
}

export function CompositeRenderer({ plan }: CompositeRendererProps) {
  const sortedLayers = [...plan.layers].sort((a, b) => a.zIndex - b.zIndex)

  return (
    <AbsoluteFill style={{ backgroundColor: plan.backgroundColor }}>
      {sortedLayers.map((layer) => (
        <Sequence
          key={layer.id}
          from={layer.startFrame}
          durationInFrames={layer.durationInFrames ?? plan.durationInFrames - layer.startFrame}
        >
          <CompositeLayerView layer={layer} />
        </Sequence>
      ))}
    </AbsoluteFill>
  )
}
