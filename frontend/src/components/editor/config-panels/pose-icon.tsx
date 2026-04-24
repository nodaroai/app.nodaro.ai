"use client"

/**
 * Minimal stick-figure pose silhouettes for Pose dimension tiles.
 * 64×64 viewport, currentColor strokes — head (circle) + torso/limbs (lines).
 * Not anatomically correct; the goal is silhouette recognition so the user
 * can scan 25 poses visually.
 */

import type { JSX } from "react"

const c = (cx: number, cy: number, r: number) => (
  <circle cx={cx} cy={cy} r={r} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
)
const l = (x1: number, y1: number, x2: number, y2: number) => (
  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
)
const p = (d: string) => (
  <path d={d} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
)

/** Head at (cx, cy) with radius 6. Returns the figure base: head + spine line. */
const Figure = ({ head, shoulders, hips, extras }: { head: [number, number]; shoulders: [number, number]; hips: [number, number]; extras: JSX.Element }) => (
  <g>
    {c(head[0], head[1], 5)}
    {l(shoulders[0], shoulders[1], hips[0], hips[1])}
    {extras}
  </g>
)

const POSE_SHAPES: Record<string, JSX.Element> = {
  // ---- Standing ----
  "standing-upright": (
    <Figure head={[32, 12]} shoulders={[32, 18]} hips={[32, 36]}
      extras={<g>{l(32, 18, 22, 28)}{l(32, 18, 42, 28)}{l(32, 36, 26, 54)}{l(32, 36, 38, 54)}</g>} />
  ),
  "confident-stance": (
    <Figure head={[32, 12]} shoulders={[32, 18]} hips={[32, 36]}
      extras={<g>{l(32, 20, 20, 28)}{l(32, 20, 44, 28)}{l(32, 36, 22, 54)}{l(32, 36, 42, 54)}</g>} />
  ),
  "hands-on-hips": (
    <Figure head={[32, 12]} shoulders={[32, 18]} hips={[32, 36]}
      extras={<g>{p("M32 20 L22 28 L28 36")}{p("M32 20 L42 28 L36 36")}{l(32, 36, 26, 54)}{l(32, 36, 38, 54)}</g>} />
  ),
  "arms-crossed": (
    <Figure head={[32, 12]} shoulders={[32, 18]} hips={[32, 36]}
      extras={<g>{l(24, 20, 40, 30)}{l(40, 20, 24, 30)}{l(32, 36, 26, 54)}{l(32, 36, 38, 54)}</g>} />
  ),
  "leaning": (
    <Figure head={[40, 14]} shoulders={[38, 20]} hips={[28, 38]}
      extras={<g>{l(38, 20, 28, 28)}{l(38, 20, 48, 30)}{l(28, 38, 20, 54)}{l(28, 38, 34, 54)}{l(46, 10, 46, 58)}</g>} />
  ),
  "hero-pose": (
    <Figure head={[32, 12]} shoulders={[32, 18]} hips={[32, 36]}
      extras={<g>{l(32, 18, 18, 22)}{l(32, 18, 46, 22)}{l(32, 36, 20, 54)}{l(32, 36, 44, 54)}</g>} />
  ),

  // ---- Seated ----
  "sitting": (
    <g>
      {c(32, 14, 5)}
      {l(32, 20, 32, 36)}
      {l(32, 22, 22, 30)}{l(32, 22, 42, 30)}
      {p("M32 36 L28 50 L20 50")}
      {p("M32 36 L36 50 L44 50")}
    </g>
  ),
  "cross-legged": (
    <g>
      {c(32, 16, 5)}
      {l(32, 22, 32, 40)}
      {l(32, 24, 22, 32)}{l(32, 24, 42, 32)}
      {p("M32 40 L20 48 L40 48")}
      {p("M32 40 L44 48 L24 48")}
    </g>
  ),
  "kneeling": (
    <g>
      {c(32, 16, 5)}
      {l(32, 22, 32, 36)}
      {l(32, 24, 24, 32)}{l(32, 24, 40, 32)}
      {p("M32 36 L28 48 L20 56")}
      {p("M32 36 L36 48 L44 56")}
      {l(18, 56, 46, 56)}
    </g>
  ),
  "crouching": (
    <g>
      {c(32, 22, 5)}
      {l(32, 28, 32, 36)}
      {p("M32 30 L22 32 L24 38")}
      {p("M32 30 L42 32 L40 38")}
      {p("M32 36 L20 50 L24 56")}
      {p("M32 36 L44 50 L40 56")}
    </g>
  ),
  "lounging": (
    <g>
      {c(14, 24, 5)}
      {l(18, 28, 48, 36)}
      {l(22, 30, 30, 40)}{l(30, 32, 42, 42)}
      {l(48, 36, 56, 44)}
      {l(48, 36, 52, 50)}
    </g>
  ),

  // ---- Movement ----
  "walking": (
    <Figure head={[32, 12]} shoulders={[32, 18]} hips={[32, 36]}
      extras={<g>{l(32, 22, 24, 32)}{l(32, 22, 40, 30)}{l(32, 36, 24, 54)}{l(32, 36, 40, 52)}</g>} />
  ),
  "running": (
    <g>
      {c(34, 12, 5)}
      {l(34, 18, 30, 34)}
      {l(34, 20, 22, 22)}{l(34, 20, 46, 30)}
      {p("M30 34 L20 48 L18 56")}
      {p("M30 34 L44 42 L48 56")}
    </g>
  ),
  "jumping": (
    <g>
      {c(32, 8, 5)}
      {l(32, 14, 32, 30)}
      {l(32, 16, 18, 18)}{l(32, 16, 46, 18)}
      {p("M32 30 L24 44 L22 48")}
      {p("M32 30 L40 44 L42 48")}
    </g>
  ),
  "dancing": (
    <g>
      {c(34, 12, 5)}
      {l(34, 18, 30, 36)}
      {p("M34 20 L22 16 L14 20")}
      {p("M34 20 L46 22 L50 14")}
      {p("M30 36 L22 50 L16 54")}
      {p("M30 36 L44 50 L50 48")}
    </g>
  ),
  "climbing": (
    <g>
      {c(32, 14, 5)}
      {l(32, 20, 32, 40)}
      {l(32, 22, 22, 10)}{l(32, 22, 42, 10)}
      {l(32, 40, 24, 56)}{l(32, 40, 40, 56)}
    </g>
  ),

  // ---- Action ----
  "fighting-stance": (
    <g>
      {c(32, 14, 5)}
      {l(32, 20, 32, 36)}
      {p("M32 22 L20 30 L20 38")}
      {p("M32 22 L44 30 L44 38")}
      {p("M32 36 L22 48 L20 56")}
      {p("M32 36 L44 48 L46 56")}
    </g>
  ),
  "reaching": (
    <Figure head={[32, 14]} shoulders={[32, 20]} hips={[32, 38]}
      extras={<g>{l(32, 22, 52, 10)}{l(32, 22, 24, 34)}{l(32, 38, 26, 56)}{l(32, 38, 38, 56)}</g>} />
  ),
  "throwing": (
    <g>
      {c(34, 14, 5)}
      {l(34, 20, 30, 38)}
      {p("M34 22 L50 14 L56 10")}
      {p("M34 22 L22 30 L18 38")}
      {l(30, 38, 22, 56)}{l(30, 38, 40, 56)}
    </g>
  ),
  "leaping": (
    <g>
      {c(40, 14, 5)}
      {l(40, 20, 26, 30)}
      {l(40, 22, 52, 16)}{l(40, 22, 30, 18)}
      {p("M26 30 L16 36 L12 44")}
      {p("M26 30 L38 40 L48 50")}
    </g>
  ),
  "dramatic-action": (
    <g>
      {c(32, 14, 5)}
      {l(32, 20, 32, 38)}
      {p("M32 22 L18 14 L12 10")}
      {p("M32 22 L50 24 L56 18")}
      {p("M32 38 L20 54 L14 58")}
      {p("M32 38 L46 54 L52 58")}
    </g>
  ),

  // ---- Resting ----
  "lying-down": (
    <g>
      {c(10, 40, 5)}
      {l(14, 44, 50, 44)}
      {l(20, 44, 26, 38)}{l(30, 44, 38, 38)}
      {l(50, 44, 56, 40)}
      {l(50, 44, 52, 52)}
    </g>
  ),
  "sleeping": (
    <g>
      {c(10, 40, 5)}
      {l(14, 44, 50, 44)}
      {l(50, 44, 56, 40)}
      {p("M22 32 L28 30 L22 34 Z")}
      {p("M12 38 Q16 34 20 38")}
    </g>
  ),
  "hugging": (
    <g>
      {c(22, 14, 5)}
      {c(42, 14, 5)}
      {l(22, 20, 22, 40)}
      {l(42, 20, 42, 40)}
      {p("M22 24 Q32 20 42 24")}
      {p("M22 30 Q32 34 42 30")}
      {l(22, 40, 18, 58)}{l(22, 40, 28, 58)}
      {l(42, 40, 36, 58)}{l(42, 40, 46, 58)}
    </g>
  ),
  "looking-away": (
    <Figure head={[32, 12]} shoulders={[32, 18]} hips={[32, 36]}
      extras={<g>{c(38, 12, 2)}{l(32, 20, 22, 30)}{l(32, 20, 42, 30)}{l(32, 36, 26, 54)}{l(32, 36, 38, 54)}</g>} />
  ),
}

export function PoseIcon({ poseId, className }: { readonly poseId: string; readonly className?: string }) {
  const shape = POSE_SHAPES[poseId]
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden role="img" style={{ pointerEvents: "none" }}>
      {shape ?? <circle cx={32} cy={14} r={5} fill="none" stroke="currentColor" strokeWidth={2} />}
    </svg>
  )
}
