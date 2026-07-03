import React from "react"
import { AbsoluteFill, Audio, Sequence, useCurrentFrame, useVideoConfig, interpolate } from "remotion"
import type { ResolvedReveal, ResolvedScene, ShotElement, ShotSequencePlan } from "../plan-types"
import { getEasing, getEntranceStyle, getExitStyle } from "../lib/mg-motion"
import { directionStyle } from "../lib/text-direction"
import { resolveBrand, resolveFontStack, type ResolvedBrand } from "../lib/brand"
import { BLUEPRINT_REGISTRY } from "../blueprints/registry"
import { easeOutQuad, easeInQuad } from "../blueprints/motion"
import { readableTextColor } from "../blueprints/color"

type CutDirection = "left" | "right" | "up" | "down"
const DIRECTION_VECTOR: Record<CutDirection, readonly [number, number]> = {
  left: [-1, 0],
  right: [1, 0],
  up: [0, -1],
  down: [0, 1],
}

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

interface CutCurveHalf {
  readonly frames?: number
  readonly type?: "cut-the-curve"
  readonly direction?: CutDirection
}

/** Opacity completes its fade at this fraction of the exit's travel — the
 *  element vanishes while still visibly accelerating (HF: ~25-30%). */
const EXIT_FADE_FRACTION = 0.3
/** Opacity ramps in over this fraction of the entry's travel — fast, under
 *  the entry's deceleration (HF: ~35%). */
const ENTRY_FADE_FRACTION = 0.35
/** Cut travel distance as a fraction of the transition axis's canvas
 *  dimension (HF's own reference: 230px / 1920px ≈ 0.12). */
const DISTANCE_FRACTION = 0.12

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

/** The full travel distance (px) for a cut in `direction`, plus its unit
 *  direction vector — "left"/"right" travel along width, "up"/"down" along
 *  height. */
function axisOffset(direction: CutDirection, width: number, height: number): { dx: number; dy: number; distance: number } {
  const [dx, dy] = DIRECTION_VECTOR[direction]
  const axisSize = direction === "left" || direction === "right" ? width : height
  return { dx, dy, distance: axisSize * DISTANCE_FRACTION }
}

/**
 * Cut-the-curve — HF's velocity-matched directional scene-to-scene cut.
 * Handles both halves of a scene's transition independently (a scene's
 * inherited entry direction and its own authored exit direction can
 * legitimately differ). The opacity baseline delegates to
 * `sceneCrossfadeOpacity` (passing `undefined` frames for whichever half IS
 * cut-the-curve, so that half's linear-fade branch is a no-op there) — the
 * plain-fade formula for a non-cut-the-curve half is never re-derived, only
 * ever computed by that one function. `frame` is scene-relative, matching
 * `sceneCrossfadeOpacity`.
 *
 * Only meaningfully different from `sceneCrossfadeOpacity` when at least one
 * half has `type: "cut-the-curve"` — SceneView only calls this function in
 * that case, using `sceneCrossfadeOpacity` directly otherwise (byte-identical
 * to the pre-cut-the-curve renderer for every scene that doesn't opt in).
 * Pure function — safe to unit-test without a render.
 */
export function cutCurveTransform(
  frame: number,
  durationInFrames: number,
  width: number,
  height: number,
  entry: CutCurveHalf,
  exit: CutCurveHalf,
): { x: number; y: number; opacity: number } {
  let opacity = sceneCrossfadeOpacity(
    frame,
    durationInFrames,
    entry.type === "cut-the-curve" ? undefined : entry.frames,
    exit.type === "cut-the-curve" ? undefined : exit.frames,
  )
  let x = 0
  let y = 0

  if (entry.type === "cut-the-curve" && entry.direction && entry.frames && entry.frames > 0 && frame < entry.frames) {
    const t = clamp01(frame / entry.frames)
    const { dx, dy, distance } = axisOffset(entry.direction, width, height)
    const remaining = distance * (1 - easeOutQuad(t))
    x += -dx * remaining
    y += -dy * remaining
    opacity *= clamp01(t / ENTRY_FADE_FRACTION)
  }

  if (exit.type === "cut-the-curve" && exit.direction && exit.frames && exit.frames > 0 && frame >= durationInFrames) {
    const t = clamp01((frame - durationInFrames) / exit.frames)
    const { dx, dy, distance } = axisOffset(exit.direction, width, height)
    const traveled = distance * easeInQuad(t)
    x += dx * traveled
    y += dy * traveled
    opacity *= clamp01(1 - t / EXIT_FADE_FRACTION)
  }

  return { x, y, opacity }
}

/** Font + direction CSS for a resolved text element (pure — unit-testable).
 *  `element.fontFamily` wins when set; otherwise falls back to the brand's
 *  body font; otherwise "Montserrat" (today's hardcode — byte-identical when
 *  brand is absent/has no fonts). */
export function elementTextStyle(
  element: Extract<ShotElement, { type: "text" }>,
  brand?: ResolvedBrand,
): {
  fontFamily: string
  direction: "rtl" | "ltr"
} {
  const fontName = element.fontFamily ?? brand?.fonts?.body ?? "Montserrat"
  return {
    fontFamily: resolveFontStack(fontName, fontName),
    ...directionStyle(element.text, { explicit: element.dir }),
  }
}

function ElementBox({ element, style, brand }: { element: ShotElement; style: React.CSSProperties; brand?: ResolvedBrand }) {
  if (element.type === "text") {
    const { fontFamily, direction } = elementTextStyle(element, brand)
    return (
      <div
        style={{
          position: "absolute",
          left: element.x,
          top: element.y,
          fontFamily,
          direction,
          fontSize: element.fontSize,
          fontWeight: element.fontWeight ?? 400,
          color: element.color ?? brand?.palette?.text ?? readableTextColor(brand?.backgroundColor ?? "#000000"),
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

function RevealView({ reveal, brand }: { reveal: ResolvedReveal; brand: ResolvedBrand }) {
  const frame = useCurrentFrame()

  // Blueprint branch — narrows union to ResolvedBlueprintReveal.
  // The wrapping <Sequence> makes useCurrentFrame() reveal-local inside Comp.
  if ("blueprint" in reveal) {
    const Comp = BLUEPRINT_REGISTRY[reveal.blueprint.id]
    if (!Comp) throw new Error(`Unknown blueprint id: ${reveal.blueprint.id}`)
    return (
      <Sequence from={reveal.frame} durationInFrames={reveal.durationFrames} layout="none">
        <Comp params={reveal.blueprint.params} durationInFrames={reveal.durationFrames} brand={brand} />
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
      <ElementBox element={reveal.element} style={{ ...entranceTransform, opacity: finalOpacity }} brand={brand} />
    </div>
  )
}

/** One scene's layer. Reads the scene-relative frame to apply its transition
 *  envelope — a plain cross-dissolve (opacity only) by default, or a
 *  cut-the-curve directional cut (opacity + translate) when either half opts
 *  in via `transitionInType`/`transitionOutType`. The plain-crossfade branch
 *  is byte-identical to the pre-cut-the-curve renderer — same function call,
 *  same output — for every scene that doesn't opt in. */
function SceneView({ scene, brand }: { scene: ResolvedScene; brand: ResolvedBrand }) {
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()
  const usesCutCurve = scene.transitionInType === "cut-the-curve" || scene.transitionOutType === "cut-the-curve"
  const { x, y, opacity } = usesCutCurve
    ? cutCurveTransform(
        frame,
        scene.durationInFrames,
        width,
        height,
        { frames: scene.transitionInFrames, type: scene.transitionInType, direction: scene.transitionInDirection },
        { frames: scene.transitionOutFrames, type: scene.transitionOutType, direction: scene.transitionOutDirection },
      )
    : {
        x: 0,
        y: 0,
        opacity: sceneCrossfadeOpacity(frame, scene.durationInFrames, scene.transitionInFrames, scene.transitionOutFrames),
      }
  return (
    <AbsoluteFill
      style={{
        backgroundColor: scene.background?.color,
        opacity,
        transform: x || y ? `translate(${x}px, ${y}px)` : undefined,
      }}
    >
      {scene.shots.flatMap((shot) =>
        shot.reveals.map((r) => <RevealView key={r.id} reveal={r} brand={brand} />),
      )}
    </AbsoluteFill>
  )
}

export function ShotSequenceRenderer({ plan }: { plan: ShotSequencePlan }) {
  const brand = resolveBrand(plan.brandTokens, plan.backgroundColor)
  return (
    <AbsoluteFill style={{ backgroundColor: brand.backgroundColor }}>
      <Audio src={plan.audio.src} volume={plan.audio.volume ?? 1} />
      {plan.scenes.map((scene) => (
        <Sequence
          key={scene.id}
          from={scene.startFrame}
          // Render past the window by transitionOutFrames so the out-fade overlaps
          // the next scene for the cross-dissolve (window stays non-overlapping).
          durationInFrames={scene.durationInFrames + (scene.transitionOutFrames ?? 0)}
        >
          <SceneView scene={scene} brand={brand} />
        </Sequence>
      ))}
    </AbsoluteFill>
  )
}
