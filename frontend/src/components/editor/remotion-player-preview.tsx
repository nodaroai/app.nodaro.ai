import { useMemo } from "react"
import { Player } from "@remotion/player"
import type { ComponentType } from "react"

interface RemotionPlayerPreviewProps<T extends Record<string, unknown>> {
  component: ComponentType<T>
  inputProps: T
  durationInFrames: number
  fps: number
  width: number
  height: number
}

export function RemotionPlayerPreview<T extends Record<string, unknown>>({
  component,
  inputProps,
  durationInFrames,
  fps,
  width,
  height,
}: RemotionPlayerPreviewProps<T>) {
  const aspectRatio = width / height
  const style = useMemo(
    () => ({ width: "100%", aspectRatio: String(aspectRatio) }),
    [aspectRatio],
  )

  if (durationInFrames < 1) return null

  return (
    <div className="rounded-md overflow-hidden border border-[var(--border-primary)]">
      <Player
        component={component}
        inputProps={inputProps}
        durationInFrames={durationInFrames}
        compositionWidth={width}
        compositionHeight={height}
        fps={fps}
        style={style}
        controls
        autoPlay={false}
        loop
        acknowledgeRemotionLicense
      />
    </div>
  )
}
