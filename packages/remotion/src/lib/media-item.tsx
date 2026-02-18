import React from "react"
import { Img, Video } from "remotion"
import type { MediaAsset } from "../types"
import { useKenBurns } from "./use-asset"

/**
 * Renders a single image or video asset with optional Ken Burns effect.
 * Shared across all composition templates.
 */
export function MediaItem({
  asset,
  width,
  height,
  kenBurnsEnabled = false,
  kenBurnsDuration = 0,
}: {
  asset: MediaAsset
  width: number
  height: number
  kenBurnsEnabled?: boolean
  kenBurnsDuration?: number
}) {
  const applyKenBurns = kenBurnsEnabled && asset.type === "image"
  const kenBurns = useKenBurns(applyKenBurns, kenBurnsDuration)

  const transform = applyKenBurns
    ? `scale(${kenBurns.scale}) translate(${kenBurns.translateX}%, ${kenBurns.translateY}%)`
    : undefined

  const mediaStyle: React.CSSProperties = { width, height, objectFit: "cover", transform }

  if (asset.type === "image") {
    return (
      <Img src={asset.localPath} style={mediaStyle} />
    )
  }

  return (
    <Video src={asset.localPath} style={{ width, height, objectFit: "cover" }} />
  )
}
