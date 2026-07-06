import React from "react"
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from "remotion"
import type { BlueprintProps } from "./types"
import { MediaFrame } from "../lib/media-frame"
import { scaleSwap, headlineSwap, easeOutQuad } from "./motion"
import { readableTextColor } from "./color"
import { directionStyle } from "../lib/text-direction"
import { blueprintFontFamily, resolveBlueprintAccent } from "../lib/brand"

type Params = { deviceImage: string; screens: string[]; headlines?: string[]; accentColor?: string }

/**
 * A device mockup holds as the persistent hero on a styled backdrop while its
 * screens cycle through a real flow (static-tour: camera-static, no pan/zoom).
 * Side headlines swap in sync with the screen cycle.
 */
export function DeviceSurfaceShowcase({ params, durationInFrames, brand }: BlueprintProps) {
  const { deviceImage, screens, headlines, accentColor } = params as Params
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()

  const fontFamily = blueprintFontFamily(brand)
  const primaryColor = readableTextColor(brand.backgroundColor)
  // Decorative accent shape behind the device — same fallback convention as
  // the other UI-shape (non-text) accent consumers (cta-morph-press,
  // grid-card-assemble, logo-assemble-lockup): a neutral light gray, not a
  // text-contrast color.
  const accent = resolveBlueprintAccent(accentColor, brand, "#f5f5f7")

  // Device establish: slide up + settle over the first 18 frames.
  const enterY = interpolate(frame, [0, 18], [height * 0.06, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.ease) })
  const enterOpacity = interpolate(frame, [0, 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })

  // Screen cycle: split the post-establish window evenly across screens.
  const establish = 24
  const cycleLen = (durationInFrames - establish) / Math.max(1, screens.length)
  const rawIdx = Math.floor((frame - establish) / cycleLen)
  const idx = Math.max(0, Math.min(screens.length - 1, rawIdx))
  const nextIdx = Math.min(screens.length - 1, idx + 1)
  const localT = (frame - establish - idx * cycleLen) / cycleLen
  const swapWindow = 0.25 // last 25% of each hold cross-fades to the next
  const e = localT > 1 - swapWindow && idx < screens.length - 1 ? easeOutQuad((localT - (1 - swapWindow)) / swapWindow) : 0
  const swap = scaleSwap(e)

  const deviceW = Math.round(width * 0.34)
  const deviceH = Math.round(height * 0.72)
  const screenInsetW = Math.round(deviceW * 0.86)
  const screenInsetH = Math.round(deviceH * 0.9)

  const hl = headlines ?? []
  const hSwap = headlineSwap(e)
  const currentHeadline = hl[e > 0 ? nextIdx : idx] ?? ""
  const headlineDir = directionStyle(currentHeadline)

  return (
    <AbsoluteFill style={{ backgroundColor: brand.backgroundColor, alignItems: "center", justifyContent: "center" }}>
      {/* accent shape behind the device */}
      <div
        style={{
          position: "absolute",
          width: deviceW * 1.5,
          height: deviceW * 1.5,
          borderRadius: "50%",
          backgroundColor: accent,
          opacity: 0.18,
          transform: `scale(${interpolate(frame, [0, 20], [0.6, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.ease) })})`,
        }}
      />

      {/* side headline (swaps in sync with the screen) */}
      {hl.length > 0 && (
        <div
          style={{
            position: "absolute",
            left: width * 0.62,
            top: height * 0.42,
            width: width * 0.3,
            color: primaryColor,
            fontFamily,
            fontSize: Math.round(height * 0.05),
            fontWeight: 700,
            ...headlineDir,
          }}
        >
          <div style={{ position: "absolute", transform: `translateY(${hSwap.inY}px)`, opacity: e > 0 ? hSwap.inOpacity : 1 }}>{currentHeadline}</div>
        </div>
      )}

      {/* device frame — clip screens to its bounds */}
      <div
        style={{
          position: "absolute",
          left: (width - deviceW) / 2,
          top: (height - deviceH) / 2 + enterY,
          width: deviceW,
          height: deviceH,
          opacity: enterOpacity,
          overflow: "hidden",
          borderRadius: Math.round(deviceW * 0.09),
        }}
      >
        <MediaFrame src={deviceImage} fit="contain" width={deviceW} height={deviceH} />
        {/* current screen */}
        <div
          style={{
            position: "absolute",
            left: (deviceW - screenInsetW) / 2,
            top: (deviceH - screenInsetH) / 2,
            width: screenInsetW,
            height: screenInsetH,
            opacity: swap.outOpacity,
            transform: `scale(${swap.outScale})`,
          }}
        >
          <MediaFrame src={screens[idx]} fit="cover" width={screenInsetW} height={screenInsetH} />
        </div>
        {/* incoming screen during swap */}
        {e > 0 && (
          <div
            style={{
              position: "absolute",
              left: (deviceW - screenInsetW) / 2,
              top: (deviceH - screenInsetH) / 2,
              width: screenInsetW,
              height: screenInsetH,
              opacity: swap.inOpacity,
              transform: `scale(${swap.inScale})`,
            }}
          >
            <MediaFrame src={screens[nextIdx]} fit="cover" width={screenInsetW} height={screenInsetH} />
          </div>
        )}
      </div>
    </AbsoluteFill>
  )
}
