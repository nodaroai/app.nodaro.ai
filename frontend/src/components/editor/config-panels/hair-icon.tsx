"use client"

/**
 * Tiny silhouette icons for Person's hair-style dimension. Each icon is a
 * minimal pictogram — head oval + hair shape — sized for 48×48 tile previews.
 * Not photorealistic. The goal is silhouette recognition so users can scan
 * 45 entries faster than text alone would allow.
 *
 * Head is always rendered by the shell; per-style JSX adds only the hair.
 * `currentColor` is used for hair so the icon inherits the tile's text color
 * (muted for unselected, pink for selected — matches the tile's state tint).
 */

import type { JSX } from "react"

// Head silhouette — rendered once by every icon. Soft oval with slightly
// narrower chin, so hair shapes read clearly above / beside it.
const Head = () => (
  <ellipse cx={32} cy={36} rx={14} ry={17} fill="currentColor" fillOpacity={0.12} />
)

const Neck = () => (
  <rect x={26} y={52} width={12} height={6} rx={2} fill="currentColor" fillOpacity={0.12} />
)

const h = (d: string) => <path d={d} fill="currentColor" />
const hs = (d: string) => <path d={d} fill="currentColor" fillOpacity={0.85} />
const rect = (x: number, y: number, w: number, ht: number, rx = 1) => (
  <rect x={x} y={y} width={w} height={ht} rx={rx} fill="currentColor" />
)
const circle = (cx: number, cy: number, r: number) => (
  <circle cx={cx} cy={cy} r={r} fill="currentColor" />
)

const HAIR_SHAPES: Record<string, JSX.Element> = {
  // ---- Short cuts ----
  "style-pixie": (
    <g>
      {h("M18 24 Q32 14 46 24 Q46 30 42 30 L22 30 Q18 30 18 24 Z")}
      {hs("M22 28 Q28 24 34 28")}
    </g>
  ),
  "style-buzz-cut": h("M20 26 Q32 22 44 26 Q44 30 40 30 L24 30 Q20 30 20 26 Z"),
  "style-crew-cut": h("M20 24 Q32 18 44 24 Q44 30 40 30 L24 30 Q20 30 20 24 Z"),
  "style-shaved": <></>,
  "style-undercut": (
    <g>
      {h("M18 20 Q32 12 46 20 Q46 28 42 28 L36 26 Q32 20 28 26 L22 28 Q18 28 18 20 Z")}
      {rect(20, 30, 24, 2)}
    </g>
  ),
  "style-faux-hawk": (
    <g>
      {h("M26 14 Q32 8 38 14 L38 28 L26 28 Z")}
      {rect(20, 28, 6, 2)}
      {rect(38, 28, 6, 2)}
    </g>
  ),
  "style-mohawk": h("M28 6 Q32 2 36 6 L36 28 L28 28 Z"),
  "style-pompadour": (
    <g>
      {h("M18 22 Q22 10 34 10 Q44 12 46 24 Q46 30 42 30 L22 30 Q18 30 18 22 Z")}
      {hs("M26 16 Q30 10 36 14")}
    </g>
  ),
  "style-short": h("M18 22 Q32 14 46 22 Q46 32 42 32 L22 32 Q18 32 18 22 Z"),
  "style-short-curly": (
    <g>
      {circle(22, 22, 5)}
      {circle(30, 18, 6)}
      {circle(38, 22, 5)}
      {circle(42, 26, 4)}
      {circle(20, 26, 4)}
    </g>
  ),

  // ---- Bob family ----
  "style-micro-bob": (
    <g>
      {h("M18 22 Q32 12 46 22 L46 38 Q46 40 44 40 L20 40 Q18 40 18 38 Z")}
    </g>
  ),
  "style-french-bob": (
    <g>
      {h("M18 22 Q32 10 46 22 L46 42 Q46 44 44 44 L20 44 Q18 44 18 42 Z")}
      {hs("M22 24 L42 24 L42 30 L22 30 Z")}
    </g>
  ),
  "style-bob": (
    <g>
      {h("M18 22 Q32 10 46 22 L46 48 Q46 50 44 50 L20 50 Q18 50 18 48 Z")}
    </g>
  ),
  "style-lob": (
    <g>
      {h("M16 22 Q32 8 48 22 L48 54 Q48 56 46 56 L18 56 Q16 56 16 54 Z")}
    </g>
  ),

  // ---- Medium & long ----
  "style-medium": (
    <g>
      {h("M16 20 Q32 8 48 20 L48 56 Q48 58 46 58 L18 58 Q16 58 16 56 Z")}
    </g>
  ),
  "style-long-straight": (
    <g>
      {h("M14 20 Q32 6 50 20 L50 62 L14 62 Z")}
    </g>
  ),
  "style-long-wavy": (
    <g>
      {h("M14 20 Q32 6 50 20 Q48 36 50 52 Q48 62 44 62 L20 62 Q16 62 14 52 Q16 36 14 20 Z")}
      {hs("M18 30 Q20 34 18 38 M46 30 Q44 34 46 38")}
    </g>
  ),
  "style-long-curly": (
    <g>
      {circle(18, 22, 6)}
      {circle(26, 14, 6)}
      {circle(34, 12, 7)}
      {circle(44, 18, 6)}
      {circle(48, 28, 5)}
      {circle(16, 32, 5)}
      {circle(48, 42, 5)}
      {circle(16, 46, 5)}
      {circle(44, 52, 5)}
      {circle(20, 54, 5)}
    </g>
  ),
  "style-afro": (
    <g>
      {circle(32, 24, 20)}
      {circle(16, 30, 8)}
      {circle(48, 30, 8)}
    </g>
  ),
  "style-mullet": (
    <g>
      {h("M18 22 Q32 12 46 22 L46 32 Q40 30 32 32 Q24 30 18 32 Z")}
      {h("M20 32 L44 32 L46 58 Q44 60 38 60 L26 60 Q20 60 18 58 Z")}
    </g>
  ),
  "style-wolf-cut": (
    <g>
      {h("M18 22 Q32 12 46 22 Q44 32 46 40 L40 50 Q32 46 24 50 L18 40 Q20 32 18 22 Z")}
      {hs("M26 22 L22 32 M38 22 L42 32")}
    </g>
  ),

  // ---- Bangs / fringe ----
  "style-bangs": (
    <g>
      {h("M18 22 Q32 10 46 22 L46 34 L18 34 Z")}
      {rect(20, 30, 24, 6, 2)}
    </g>
  ),
  "style-curtain-bangs": (
    <g>
      {h("M18 20 Q32 10 46 20 L46 36 L18 36 Z")}
      {hs("M22 24 L30 34 L32 26 L34 34 L42 24")}
    </g>
  ),
  "style-wispy-bangs": (
    <g>
      {h("M18 22 Q32 12 46 22 L46 32 L18 32 Z")}
      {hs("M22 28 L26 34 M28 28 L30 36 M34 28 L34 36 M38 28 L38 34 M42 28 L40 34")}
    </g>
  ),
  "style-side-swept": (
    <g>
      {h("M16 20 Q32 8 48 20 L48 34 L18 30 Q16 26 16 20 Z")}
      {hs("M20 22 Q30 26 44 22 L42 32 L22 28 Z")}
    </g>
  ),

  // ---- Pulled back / updos ----
  "style-slicked-back": (
    <g>
      {h("M20 20 Q32 16 44 20 Q46 26 44 30 L22 30 Q18 26 20 20 Z")}
      {hs("M22 22 L42 22")}
    </g>
  ),
  "style-bardot-tendrils": (
    <g>
      {h("M20 20 Q32 16 44 20 Q46 26 44 30 L22 30 Q18 26 20 20 Z")}
      {hs("M20 28 Q16 42 18 52")}
      {hs("M44 28 Q48 42 46 52")}
    </g>
  ),
  "style-ponytail": (
    <g>
      {h("M20 20 Q32 12 44 20 Q44 28 42 30 L22 30 Q20 28 20 20 Z")}
      {h("M44 30 Q52 38 50 50 L46 54 Q42 44 42 32 Z")}
    </g>
  ),
  "style-high-ponytail": (
    <g>
      {h("M20 22 Q32 18 44 22 Q44 30 42 32 L22 32 Q20 30 20 22 Z")}
      {h("M32 10 Q36 6 40 10 Q42 20 32 22 Q22 20 24 10 Q28 6 32 10 Z")}
      {h("M32 22 Q42 30 44 46 L40 48 Q38 36 32 24 Z")}
    </g>
  ),
  "style-half-up": (
    <g>
      {h("M16 22 Q32 10 48 22 L48 56 L16 56 Z")}
      {hs("M26 14 Q32 8 38 14 L38 20 L26 20 Z")}
    </g>
  ),
  "style-bun": (
    <g>
      {h("M20 22 Q32 16 44 22 Q44 30 42 32 L22 32 Q20 30 20 22 Z")}
      {circle(46, 30, 6)}
    </g>
  ),
  "style-top-knot": (
    <g>
      {h("M20 22 Q32 16 44 22 Q44 30 42 32 L22 32 Q20 30 20 22 Z")}
      {circle(32, 12, 7)}
      {rect(30, 16, 4, 6)}
    </g>
  ),
  "style-space-buns": (
    <g>
      {h("M20 22 Q32 18 44 22 Q44 30 42 32 L22 32 Q20 30 20 22 Z")}
      {circle(22, 14, 6)}
      {circle(42, 14, 6)}
    </g>
  ),

  // ---- Braids ----
  "style-braids": (
    <g>
      {h("M18 22 Q32 12 46 22 L46 30 L18 30 Z")}
      {rect(20, 30, 3, 28, 1.5)}
      {rect(26, 30, 3, 30, 1.5)}
      {rect(32, 30, 3, 32, 1.5)}
      {rect(38, 30, 3, 30, 1.5)}
      {rect(42, 30, 3, 28, 1.5)}
    </g>
  ),
  "style-single-braid": (
    <g>
      {h("M20 22 Q32 14 44 22 L44 32 L20 32 Z")}
      {h("M28 32 L36 32 L36 60 Q34 62 32 62 Q30 62 28 60 Z")}
    </g>
  ),
  "style-two-braids": (
    <g>
      {h("M20 22 Q32 14 44 22 L44 32 L20 32 Z")}
      {h("M20 32 Q16 40 16 58 L22 58 Q22 48 24 32 Z")}
      {h("M44 32 Q48 40 48 58 L42 58 Q42 48 40 32 Z")}
    </g>
  ),
  "style-french-braid": (
    <g>
      {h("M20 20 Q32 12 44 20 L44 30 L20 30 Z")}
      {hs("M28 20 L36 26 L28 32 L36 38 L28 44 L36 50")}
    </g>
  ),
  "style-dutch-braid": (
    <g>
      {h("M20 20 Q32 12 44 20 L44 30 L20 30 Z")}
      {h("M28 22 L36 28 L28 34 L36 40 L28 46 L36 52 L28 58")}
    </g>
  ),
  "style-fishtail-braid": (
    <g>
      {h("M20 22 Q32 14 44 22 L44 32 L20 32 Z")}
      {hs("M30 32 L34 34 L30 36 L34 38 L30 40 L34 42 L30 44 L34 46 L30 48 L34 50 L30 52")}
    </g>
  ),
  "style-box-braids": (
    <g>
      {h("M18 22 Q32 12 46 22 L46 30 L18 30 Z")}
      {rect(22, 32, 3, 10, 1)}
      {rect(22, 46, 3, 12, 1)}
      {rect(30, 32, 3, 12, 1)}
      {rect(30, 48, 3, 10, 1)}
      {rect(38, 32, 3, 10, 1)}
      {rect(38, 46, 3, 12, 1)}
      {rect(44, 32, 3, 12, 1)}
    </g>
  ),
  "style-crown-braid": (
    <g>
      {h("M18 22 Q32 16 46 22 L46 32 L18 32 Z")}
      {hs("M18 22 Q22 18 26 22 Q30 18 34 22 Q38 18 42 22 Q46 18 46 22")}
    </g>
  ),
  "style-cornrows": (
    <g>
      {h("M18 22 Q32 14 46 22 L46 30 L18 30 Z")}
      {rect(20, 22, 1.5, 10)}
      {rect(24, 22, 1.5, 10)}
      {rect(28, 22, 1.5, 10)}
      {rect(32, 22, 1.5, 10)}
      {rect(36, 22, 1.5, 10)}
      {rect(40, 22, 1.5, 10)}
      {rect(44, 22, 1.5, 10)}
    </g>
  ),

  // ---- Locs / dreadlocks ----
  "style-dreadlocks": (
    <g>
      {h("M18 22 Q32 12 46 22 L46 30 L18 30 Z")}
      {rect(18, 30, 4, 28, 2)}
      {rect(24, 30, 4, 32, 2)}
      {rect(30, 30, 4, 30, 2)}
      {rect(36, 30, 4, 32, 2)}
      {rect(42, 30, 4, 28, 2)}
    </g>
  ),
  "style-sisterlocks": (
    <g>
      {h("M18 22 Q32 12 46 22 L46 30 L18 30 Z")}
      {rect(19, 30, 2, 28, 1)}
      {rect(23, 30, 2, 30, 1)}
      {rect(27, 30, 2, 32, 1)}
      {rect(31, 30, 2, 30, 1)}
      {rect(35, 30, 2, 32, 1)}
      {rect(39, 30, 2, 30, 1)}
      {rect(43, 30, 2, 28, 1)}
    </g>
  ),
}

export function HairIcon({
  hairStyleId,
  className,
}: {
  readonly hairStyleId: string
  readonly className?: string
}) {
  const shape = HAIR_SHAPES[hairStyleId]
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      aria-hidden
      role="img"
      style={{ pointerEvents: "none" }}
    >
      <Neck />
      <Head />
      {shape}
    </svg>
  )
}
