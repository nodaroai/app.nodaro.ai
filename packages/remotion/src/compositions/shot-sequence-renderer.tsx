import React from "react"
import { AbsoluteFill, Audio, Sequence, useCurrentFrame, interpolate } from "remotion"
import type { ResolvedReveal, ShotElement, ShotSequencePlan } from "../plan-types"
import { getEasing, getEntranceStyle, getExitStyle } from "../lib/mg-motion"
import { FONT_MAP } from "../lib/font-registry"

/** Final opacity = base × entrance × exit (multiplied, not overwritten). */
export function computeRevealOpacity(base: number | undefined, enterOpacity: number, exitOpacity: number): number {
  return (base ?? 1) * enterOpacity * exitOpacity
}

function ElementBox({ element, style }: { element: ShotElement; style: React.CSSProperties }) {
  if (element.type === "text") {
    const fontFamily = FONT_MAP[element.fontFamily] ?? element.fontFamily
    return (
      <div
        style={{
          position: "absolute",
          left: element.x,
          top: element.y,
          fontFamily,
          fontSize: element.fontSize,
          fontWeight: element.fontWeight ?? 400,
          color: element.color,
          letterSpacing: element.letterSpacing,
          whiteSpace: "nowrap",
          ...style,
        }}
      >
        {element.text}
      </div>
    )
  }

  // shape
  if (element.shape === "circle") {
    const r = Math.min(element.width, element.height) / 2
    return (
      <svg width={element.width} height={element.height} style={{ position: "absolute", left: element.x, top: element.y, ...style }}>
        <circle cx={r} cy={r} r={r} fill={element.fill ?? "transparent"} stroke={element.stroke} strokeWidth={element.strokeWidth} />
      </svg>
    )
  }
  if (element.shape === "line") {
    const h = element.height || element.strokeWidth || 2
    return (
      <svg width={element.width} height={h} style={{ position: "absolute", left: element.x, top: element.y, ...style }}>
        <line x1={0} y1={h / 2} x2={element.width} y2={h / 2} stroke={element.stroke ?? element.fill ?? "#ffffff"} strokeWidth={element.strokeWidth ?? 2} />
      </svg>
    )
  }
  return (
    <div
      style={{
        position: "absolute",
        left: element.x,
        top: element.y,
        width: element.width,
        height: element.height,
        backgroundColor: element.fill ?? "transparent",
        border: element.stroke ? `${element.strokeWidth ?? 1}px solid ${element.stroke}` : undefined,
        borderRadius: element.cornerRadius ?? 0,
        ...style,
      }}
    />
  )
}

function RevealView({ reveal }: { reveal: ResolvedReveal }) {
  const frame = useCurrentFrame()
  const { enter, exit } = reveal

  // Entrance progress 0→1 (guard a zero-length range — bare interpolate throws).
  const enterProgress =
    enter.durationFrames <= 0
      ? frame >= reveal.frame
        ? 1
        : 0
      : interpolate(frame, [reveal.frame, reveal.frame + enter.durationFrames], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: getEasing(enter.easing),
        })

  // Exit progress 1→0 starting after enter + hold.
  const exitStart = reveal.frame + enter.durationFrames + (reveal.hold ?? 0)
  const exitProgress =
    !exit || exit.motion === "none"
      ? 1
      : exit.durationFrames <= 0
        ? frame >= exitStart
          ? 0
          : 1
        : interpolate(frame, [exitStart, exitStart + exit.durationFrames], [1, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: getEasing(exit.easing),
          })

  // Entrance style — strip its opacity (we compose opacity ourselves); keep transform/clipPath.
  const entranceStyleFull = getEntranceStyle(enterProgress, { type: enter.motion, direction: enter.direction })
  const { opacity: entranceOpacityRaw, ...entranceTransform } = entranceStyleFull
  // none → step at the cue frame; wipe-in → fully opaque (clip reveals it); else use the style opacity.
  // Cast: CSSProperties['opacity'] is 0|1|string — we know getEntranceStyle always puts numeric progress.
  const enterOpacity =
    (entranceOpacityRaw as number | undefined) ?? (enter.motion === "none" ? (frame >= reveal.frame ? 1 : 0) : 1)

  // Exit style — strip its opacity, keep transform; applied on the OUTER wrapper.
  const exitStyleFull = exit ? getExitStyle(exitProgress, { type: exit.motion }) : {}
  const { opacity: exitOpacityRaw, ...exitTransform } = exitStyleFull
  // Cast: CSSProperties['opacity'] is 0|1|string — we know getExitStyle always puts numeric progress.
  const exitOpacity = (exitOpacityRaw as number | undefined) ?? 1

  const finalOpacity = computeRevealOpacity(reveal.element.opacity, enterOpacity, exitOpacity)

  return (
    <div style={{ ...exitTransform }}>
      <ElementBox element={reveal.element} style={{ ...entranceTransform, opacity: finalOpacity }} />
    </div>
  )
}

export function ShotSequenceRenderer({ plan }: { plan: ShotSequencePlan }) {
  return (
    <AbsoluteFill style={{ backgroundColor: plan.backgroundColor }}>
      <Audio src={plan.audio.src} volume={plan.audio.volume ?? 1} />
      {plan.scenes.map((scene) => (
        <Sequence key={scene.id} from={scene.startFrame} durationInFrames={scene.durationInFrames}>
          <AbsoluteFill style={{ backgroundColor: scene.background?.color }}>
            {scene.shots.flatMap((shot) => shot.reveals.map((r) => <RevealView key={r.id} reveal={r} />))}
          </AbsoluteFill>
        </Sequence>
      ))}
    </AbsoluteFill>
  )
}
