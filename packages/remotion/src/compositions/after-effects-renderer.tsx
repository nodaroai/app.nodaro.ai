import React from "react"
import { AbsoluteFill, OffthreadVideo, Sequence, useCurrentFrame, interpolate, Easing } from "remotion"
import type { AfterEffectsPlan, AfterEffect } from "../plan-types"
import {
  buildColorGradeFilter,
  VignetteOverlay,
  FilmGrainOverlay,
  LetterboxBars,
  NoiseOverlay,
} from "../lib/effect-renderers"
import { SceneTextSegment } from "../lib/scene-text-segment"

const EASING_MAP: Record<string, (t: number) => number> = {
  linear: Easing.linear,
  easeIn: Easing.ease,
  easeOut: Easing.out(Easing.ease),
  easeInOut: Easing.inOut(Easing.ease),
}

interface AfterEffectsRendererProps {
  readonly plan: AfterEffectsPlan
}

function getEffectByType<T extends AfterEffect["type"]>(
  effects: AfterEffect[],
  type: T,
): Extract<AfterEffect, { type: T }> | undefined {
  return effects.find((e) => e.type === type) as
    | Extract<AfterEffect, { type: T }>
    | undefined
}

/**
 * Remotion composition that applies post-processing effects to a source video.
 * Renders effects as layered overlays on top of the base video.
 */
export function AfterEffectsRenderer({ plan }: AfterEffectsRendererProps) {
  const { width, height, sourceVideo, effects, textOverlays } = plan

  const frame = useCurrentFrame()

  const colorGrade = getEffectByType(effects, "color-grade")
  const vignette = getEffectByType(effects, "vignette")
  const filmGrain = getEffectByType(effects, "film-grain")
  const noiseOverlay = getEffectByType(effects, "noise-overlay")
  const letterbox = getEffectByType(effects, "letterbox")
  const animatedBlur = getEffectByType(effects, "animated-blur")
  const motionBlur = getEffectByType(effects, "motion-blur")
  const trail = getEffectByType(effects, "trail")

  // Build combined CSS filter (color grading + animated blur + motion blur)
  const filters: string[] = []
  if (colorGrade) {
    const cg = buildColorGradeFilter(colorGrade)
    if (cg) filters.push(cg)
  }
  if (animatedBlur) {
    const easingFn = EASING_MAP[animatedBlur.easing ?? "linear"] ?? Easing.linear
    const blur = interpolate(
      frame,
      [animatedBlur.startFrame, animatedBlur.startFrame + animatedBlur.durationFrames],
      [animatedBlur.startBlur, animatedBlur.endBlur],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: easingFn },
    )
    if (blur > 0.1) filters.push(`blur(${blur.toFixed(1)}px)`)
  }
  if (motionBlur) {
    const blurPx = (motionBlur.shutterAngle / 360) * 4 // 0-4px
    if (blurPx > 0.1) filters.push(`blur(${blurPx.toFixed(1)}px)`)
  }
  const videoFilter = filters.length > 0 ? filters.join(" ") : undefined

  return (
    <AbsoluteFill style={{ backgroundColor: "#000000" }}>
      {/* Trail ghost layers (behind main video) */}
      {trail && Array.from({ length: trail.layers }, (_, i) => {
        const layerIndex = i + 1
        const frameOffset = Math.round(trail.lagInFrames * layerIndex)
        const opacity = trail.trailOpacity * (1 - layerIndex / (trail.layers + 1))
        if (frame < frameOffset) return null
        return (
          <Sequence key={`trail-${i}`} from={frameOffset} layout="none">
            <OffthreadVideo
              src={sourceVideo}
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
                opacity,
                filter: videoFilter,
              }}
            />
          </Sequence>
        )
      })}

      {/* 1. Base video layer with color grading + blur applied directly to Video */}
      <OffthreadVideo
        src={sourceVideo}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          filter: videoFilter,
        }}
      />

      {/* 2. Vignette overlay */}
      {vignette && (
        <VignetteOverlay
          intensity={vignette.intensity}
          radius={vignette.radius}
        />
      )}

      {/* 3. Film grain overlay */}
      {filmGrain && (
        <FilmGrainOverlay
          intensity={filmGrain.intensity}
          size={filmGrain.size}
          seed={filmGrain.seed}
        />
      )}

      {/* 4. Noise overlay */}
      {noiseOverlay && (
        <NoiseOverlay
          opacity={noiseOverlay.opacity}
          scale={noiseOverlay.scale}
          animated={noiseOverlay.animated}
          noiseType={noiseOverlay.noiseType}
        />
      )}

      {/* 5. Letterbox bars */}
      {letterbox && (
        <LetterboxBars
          ratio={letterbox.ratio}
          color={letterbox.color}
          width={width}
          height={height}
        />
      )}

      {/* 6. Text overlays */}
      {textOverlays?.map((overlay) => (
        <Sequence
          key={overlay.id}
          from={overlay.startFrame}
          durationInFrames={overlay.durationInFrames}
        >
          <SceneTextSegment
            segment={{
              id: overlay.id,
              text: overlay.text,
              startFrame: 0,
              durationInFrames: overlay.durationInFrames,
              position: overlay.position,
              fontSize: overlay.fontSize,
              color: overlay.color,
              fontFamily: overlay.fontFamily,
              animation: overlay.animation,
            }}
          />
        </Sequence>
      ))}
    </AbsoluteFill>
  )
}
