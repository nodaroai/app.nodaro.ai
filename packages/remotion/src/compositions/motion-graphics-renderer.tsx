import React from "react"
import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion"
import type {
  MotionGraphicsPlan,
  MGElement,
  MGElementAnimation,
  MGExitAnimation,
  MGShapeElement,
  MGTextElement,
  MGSvgPathElement,
} from "../plan-types"
import { FONT_MAP, withRtlFallback } from "../lib/font-registry"
import { directionStyle } from "../lib/text-direction"
import { getEasing, getEntranceStyle, getExitStyle } from "../lib/mg-motion"

interface MotionGraphicsRendererProps {
  readonly plan: MotionGraphicsPlan
}

function computeEntranceProgress(frame: number, anim: MGElementAnimation): number {
  if (anim.type === "none") return 1
  if (anim.durationFrames <= 0) return frame >= anim.startFrame ? 1 : 0
  return interpolate(
    frame,
    [anim.startFrame, anim.startFrame + anim.durationFrames],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: getEasing(anim.easing) },
  )
}

function computeExitProgress(frame: number, exit: MGExitAnimation | undefined): number {
  if (!exit || exit.type === "none") return 1
  if (exit.durationFrames <= 0) return frame >= exit.startFrame ? 0 : 1
  return interpolate(
    frame,
    [exit.startFrame, exit.startFrame + exit.durationFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  )
}

// ── Shape Element ─────────────────────────────────────────────────────

function ShapeElementRenderer({
  element,
  entranceProgress,
}: {
  element: MGShapeElement
  entranceProgress: number
}) {
  const style = getEntranceStyle(entranceProgress, element.animation)

  if (element.shape === "circle") {
    const r = Math.min(element.width, element.height) / 2
    return (
      <svg
        width={element.width}
        height={element.height}
        style={{ position: "absolute", left: element.x, top: element.y, ...style }}
      >
        <circle
          cx={r}
          cy={r}
          r={r}
          fill={element.fill ?? "transparent"}
          stroke={element.stroke}
          strokeWidth={element.strokeWidth}
          opacity={element.opacity ?? 1}
        />
      </svg>
    )
  }

  if (element.shape === "line") {
    return (
      <svg
        width={element.width}
        height={element.height || element.strokeWidth || 2}
        style={{ position: "absolute", left: element.x, top: element.y, ...style }}
      >
        <line
          x1={0}
          y1={(element.height || element.strokeWidth || 2) / 2}
          x2={element.width}
          y2={(element.height || element.strokeWidth || 2) / 2}
          stroke={element.stroke ?? element.fill ?? "#ffffff"}
          strokeWidth={element.strokeWidth ?? 2}
          opacity={element.opacity ?? 1}
        />
      </svg>
    )
  }

  // rectangle
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
        opacity: element.opacity ?? 1,
        ...style,
      }}
    />
  )
}

// ── Text Element ──────────────────────────────────────────────────────

function TextElementRenderer({
  element,
  entranceProgress,
}: {
  element: MGTextElement
  entranceProgress: number
}) {
  const style = getEntranceStyle(entranceProgress, element.animation)
  const fontFamily = withRtlFallback(FONT_MAP[element.fontFamily] ?? element.fontFamily)

  return (
    <div
      style={{
        position: "absolute",
        left: element.x,
        top: element.y,
        fontFamily,
        ...directionStyle(element.text),
        fontSize: element.fontSize,
        fontWeight: element.fontWeight ?? 400,
        color: element.color,
        letterSpacing: element.letterSpacing,
        opacity: element.opacity ?? 1,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {element.text}
    </div>
  )
}

// ── SVG Path Element ──────────────────────────────────────────────────

function SvgPathElementRenderer({
  element,
  entranceProgress,
}: {
  element: MGSvgPathElement
  entranceProgress: number
}) {
  const pathRef = React.useRef<SVGPathElement>(null)
  const [pathLength, setPathLength] = React.useState(0)

  React.useEffect(() => {
    if (pathRef.current) {
      setPathLength(pathRef.current.getTotalLength())
    }
  }, [element.path])

  const isDrawAnim = element.animation.type === "draw-path"
  const dashOffset = isDrawAnim && pathLength > 0
    ? interpolate(entranceProgress, [0, 1], [pathLength, 0])
    : 0

  const style = isDrawAnim ? {} : getEntranceStyle(entranceProgress, element.animation)

  return (
    <svg
      style={{
        position: "absolute",
        left: element.x,
        top: element.y,
        overflow: "visible",
        ...style,
      }}
      width="100%"
      height="100%"
    >
      <path
        ref={pathRef}
        d={element.path}
        stroke={element.stroke}
        strokeWidth={element.strokeWidth}
        fill={element.fill ?? "none"}
        opacity={element.opacity ?? 1}
        strokeDasharray={isDrawAnim && pathLength > 0 ? pathLength : undefined}
        strokeDashoffset={isDrawAnim ? dashOffset : undefined}
      />
    </svg>
  )
}

// ── Element Dispatcher ────────────────────────────────────────────────

function MGElementRenderer({
  element,
  frame,
  exitAnimation,
}: {
  element: MGElement
  frame: number
  exitAnimation?: MGExitAnimation
}) {
  const entranceProgress = computeEntranceProgress(frame, element.animation)
  const exitProgress = computeExitProgress(frame, exitAnimation)

  const exitStyle = exitAnimation && exitAnimation.type !== "none"
    ? getExitStyle(exitProgress, exitAnimation)
    : {}

  return (
    <div style={{ ...exitStyle }}>
      {element.type === "shape" && (
        <ShapeElementRenderer element={element} entranceProgress={entranceProgress} />
      )}
      {element.type === "text" && (
        <TextElementRenderer element={element} entranceProgress={entranceProgress} />
      )}
      {element.type === "svg-path" && (
        <SvgPathElementRenderer element={element} entranceProgress={entranceProgress} />
      )}
    </div>
  )
}

// ── Main Composition ──────────────────────────────────────────────────

export function MotionGraphicsRenderer({ plan }: MotionGraphicsRendererProps) {
  const frame = useCurrentFrame()

  return (
    <AbsoluteFill style={{ backgroundColor: plan.backgroundColor }}>
      {plan.elements.map((element) => (
        <MGElementRenderer
          key={element.id}
          element={element}
          frame={frame}
          exitAnimation={plan.exitAnimation}
        />
      ))}
    </AbsoluteFill>
  )
}
