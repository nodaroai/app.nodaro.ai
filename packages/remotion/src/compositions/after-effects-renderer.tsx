import React from "react"
import { AbsoluteFill, Video, Sequence } from "remotion"
import type { AfterEffectsPlan, AfterEffect } from "../plan-types"
import {
  buildColorGradeFilter,
  VignetteOverlay,
  FilmGrainOverlay,
  LetterboxBars,
  NoiseOverlay,
} from "../lib/effect-renderers"
import { SceneTextSegment } from "../lib/scene-text-segment"

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

  const colorGrade = getEffectByType(effects, "color-grade")
  const vignette = getEffectByType(effects, "vignette")
  const filmGrain = getEffectByType(effects, "film-grain")
  const noiseOverlay = getEffectByType(effects, "noise-overlay")
  const letterbox = getEffectByType(effects, "letterbox")

  // Build CSS filter for color grading
  const videoFilter = colorGrade ? buildColorGradeFilter(colorGrade) : "none"

  return (
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
