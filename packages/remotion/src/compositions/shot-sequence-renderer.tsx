import React from "react"
import { AbsoluteFill, Audio, Sequence, useCurrentFrame, interpolate } from "remotion"
import type { ResolvedReveal, ResolvedScene, ShotElement, ShotSequencePlan } from "../plan-types"
import { getEasing, getEntranceStyle, getExitStyle } from "../lib/mg-motion"
import { FONT_MAP } from "../lib/font-registry"
import { BLUEPRINT_REGISTRY } from "../blueprints/registry"

/** Final opacity = base × entrance × exit (multiplied, not overwritten). */
export function computeRevealOpacity(base: number | undefined, enterOpacity: number, exitOpacity: number): number {
  return (base ?? 1) * enterOpacity * exitOpacity
}

/**
 * Scene cross-dissolve opacity — the "Seamless Join" recipe ported to the
 * single-composition renderer (video half only; the VO track is continuous and
 * untouched). A non-first scene fades IN 0→1 over its first `transitionInFrames`
 * so it is transparent at the boundary and the still-held outgoing scene shows
 * through (kills the blank handoff frame even when scenes have opaque
 * backgrounds). A non-last scene's <Sequence> renders `transitionOutFrames`
 * frames PAST its window and fades OUT 1→0 across that tail, overlapping the next
 * scene. `frame` is scene-relative.
 */
export function sceneCrossfadeOpacity(
  frame: number,
  durationInFrames: number,
  transitionInFrames?: number,
  transitionOutFrames?: number,
): number {
  let opacity = 1
  if (transitionInFrames && transitionInFrames > 0 && frame < transitionInFrames) {
    opacity *= Math.max(0, Math.min(1, frame / transitionInFrames))
  }
  if (transitionOutFrames && transitionOutFrames > 0 && frame >= durationInFrames) {
    opacity *= Math.max(0, Math.min(1, 1 - (frame - durationInFrames) / transitionOutFrames))
  }
  return opacity
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

function RevealView({ reveal, backgroundColor }: { reveal: ResolvedReveal; backgroundColor: string }) {
  const frame = useCurrentFrame()

  // Blueprint branch — narrows union to ResolvedBlueprintReveal.
  // The wrapping <Sequence> makes useCurrentFrame() reveal-local inside Comp.
  if ("blueprint" in reveal) {
    const Comp = BLUEPRINT_REGISTRY[reveal.blueprint.id]
    if (!Comp) throw new Error(`Unknown blueprint id: ${reveal.blueprint.id}`)
    return (
      <Sequence from={reveal.frame} durationInFrames={reveal.durationFrames} layout="none">
        <Comp params={reveal.blueprint.params} durationInFrames={reveal.durationFrames} brand={{ backgroundColor }} />
      </Sequence>
    )
  }

  // Element reveal branch — TypeScript narrows to ResolvedElementReveal here.
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

/** One scene's layer. Reads the scene-relative frame to apply the cross-dissolve
 *  opacity envelope (in at the open, out across the overlap tail). */
function SceneView({ scene, backgroundColor }: { scene: ResolvedScene; backgroundColor: string }) {
  const frame = useCurrentFrame()
  const opacity = sceneCrossfadeOpacity(frame, scene.durationInFrames, scene.transitionInFrames, scene.transitionOutFrames)
  return (
    <AbsoluteFill style={{ backgroundColor: scene.background?.color, opacity }}>
      {scene.shots.flatMap((shot) =>
        shot.reveals.map((r) => <RevealView key={r.id} reveal={r} backgroundColor={backgroundColor} />),
      )}
    </AbsoluteFill>
  )
}

export function ShotSequenceRenderer({ plan }: { plan: ShotSequencePlan }) {
  return (
    <AbsoluteFill style={{ backgroundColor: plan.backgroundColor }}>
      <Audio src={plan.audio.src} volume={plan.audio.volume ?? 1} />
      {plan.scenes.map((scene) => (
        <Sequence
          key={scene.id}
          from={scene.startFrame}
          // Render past the window by transitionOutFrames so the out-fade overlaps
          // the next scene for the cross-dissolve (window stays non-overlapping).
          durationInFrames={scene.durationInFrames + (scene.transitionOutFrames ?? 0)}
        >
          <SceneView scene={scene} backgroundColor={plan.backgroundColor} />
        </Sequence>
      ))}
    </AbsoluteFill>
  )
}
