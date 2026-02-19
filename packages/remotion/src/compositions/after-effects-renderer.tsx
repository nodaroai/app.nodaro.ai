import React from "react"
import { AbsoluteFill, Video, Sequence, useCurrentFrame, interpolate, Easing } from "remotion"
import { CameraMotionBlur, Trail } from "@remotion/motion-blur"
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

  // Build combined CSS filter (color grading + animated blur)
  const filters: string[] = []
  if (colorGrade) filters.push(buildColorGradeFilter(colorGrade))
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
  const videoFilter = filters.length > 0 ? filters.join(" ") : "none"

  // Build the core content (effects + overlays)
  const content = (
    <AbsoluteFill style={{ backgroundColor: "#000000" }}>
      {/* 1. Base video layer with color grading applied via CSS filter */}
      <AbsoluteFill style={{ filter: videoFilter }}>
        <Video
          src={sourceVideo}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      </AbsoluteFill>

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

  // Wrap with Trail if present (inner wrapper)
  const withTrail = trail ? (
    <Trail
      layers={trail.layers}
      lagInFrames={trail.lagInFrames}
      trailOpacity={trail.trailOpacity}
    >
      {content}
    </Trail>
  ) : content

  // Wrap with CameraMotionBlur if present (outer wrapper)
  const withMotionBlur = motionBlur ? (
    <CameraMotionBlur
      shutterAngle={motionBlur.shutterAngle}
      samples={motionBlur.samples}
    >
      {withTrail}
    </CameraMotionBlur>
  ) : withTrail

  return withMotionBlur
}
