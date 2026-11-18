import { useEffect, useState } from "react"

/**
 * The marshal: while a run works, a small character in a police cap walks the
 * panel from corner to corner and, at each one, points toward the work in the
 * middle, so it is plain at a glance that the agents are at it. It never takes
 * the pointer, and for a person who asked for less motion it stands still in
 * one corner, pointing.
 */
export type Corner = "top-start" | "top-end" | "bottom-end" | "bottom-start"

const ROUND: readonly Corner[] = ["top-start", "top-end", "bottom-end", "bottom-start"]

/** The corner after `corner`, walking the panel's edge. */
export function nextCorner(corner: Corner): Corner {
  return ROUND[(ROUND.indexOf(corner) + 1) % ROUND.length]!
}

/** Where a corner is, in the panel (clear of its header and its footer). */
const PLACE: Record<Corner, { readonly left: string; readonly top: string }> = {
  "top-start": { left: "10px", top: "54px" },
  "top-end": { left: "calc(100% - 66px)", top: "54px" },
  "bottom-end": { left: "calc(100% - 66px)", top: "calc(100% - 138px)" },
  "bottom-start": { left: "10px", top: "calc(100% - 138px)" },
}

/** The arm points toward the middle of the panel from each corner. */
const POINT: Record<Corner, number> = {
  "top-start": 35,
  "top-end": 145,
  "bottom-end": -145,
  "bottom-start": -35,
}

const WALK_MS = 1400
const STAND_MS = 1600

const KEYFRAMES = `
@keyframes nodaro-marshal-step { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-2px) } }
@keyframes nodaro-marshal-wave { 0%,100% { transform: rotate(var(--point)) } 50% { transform: rotate(calc(var(--point) + 12deg)) } }
[data-marshal][data-walking='true'] .nodaro-marshal-body { animation: nodaro-marshal-step 0.26s infinite }
[data-marshal][data-walking='false'] .nodaro-marshal-arm { animation: nodaro-marshal-wave 0.7s ease-in-out infinite }
@media (prefers-reduced-motion: reduce) { [data-marshal] * { animation: none !important } }
`

/**
 * The arm's turn in the character's own drawing: one facing left is drawn
 * mirrored, so its arm turns the other way round to point the same direction.
 */
export function armAngle(point: number): number {
  if (Math.abs(point) <= 90) return point
  return point > 0 ? 180 - point : -180 - point
}

function reducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
}

export function RunMarshal() {
  const [corner, setCorner] = useState<Corner>("top-start")
  const [walking, setWalking] = useState(false)

  useEffect(() => {
    if (reducedMotion()) return
    let timer = 0
    const stand = () => {
      setWalking(false)
      timer = window.setTimeout(walk, STAND_MS)
    }
    const walk = () => {
      setWalking(true)
      setCorner((c) => nextCorner(c))
      timer = window.setTimeout(stand, WALK_MS)
    }
    timer = window.setTimeout(walk, STAND_MS)
    return () => window.clearTimeout(timer)
  }, [])

  const place = PLACE[corner]
  const point = POINT[corner]
  const facingLeft = Math.abs(point) > 90
  const arm = armAngle(point)
  return (
    <div
      aria-hidden="true"
      data-marshal=""
      data-walking={walking}
      className="pointer-events-none absolute z-20 h-14 w-14"
      style={{ left: place.left, top: place.top, transition: `left ${WALK_MS}ms ease-in-out, top ${WALK_MS}ms ease-in-out` }}
    >
      <style>{KEYFRAMES}</style>
      <svg viewBox="0 0 64 64" className="h-full w-full overflow-visible drop-shadow-[0_0_6px_rgba(59,130,246,0.5)]" style={{ transform: facingLeft ? "scaleX(-1)" : undefined }}>
        <g className="nodaro-marshal-body">
          {/* body */}
          <path d="M32 14c11.6 0 19.6 8 19.6 19 0 12.4-8.2 22-19.6 22S12.4 45.4 12.4 33c0-11 8-19 19.6-19z" fill="#ededf2" />
          {/* cap: crown, band, peak, badge */}
          <path d="M14 18c4-9 32-9 36 0l-3 4H17z" fill="#1e3a8a" />
          <rect x="16" y="20" width="32" height="4" rx="1.5" fill="#0f1f4d" />
          <path d="M18 24h22c2 0 2 3 0 3H20z" fill="#0b1638" />
          <path d="M32 9l3 4-3 3-3-3z" fill="#f5b942" />
          {/* eyes */}
          <circle cx="26" cy="33" r="3" fill="#15151d" />
          <circle cx="38" cy="33" r="3" fill="#15151d" />
          {/* whistle */}
          <rect x="30" y="41" width="7" height="3" rx="1.5" fill="#94a3b8" />
          {/* feet */}
          <ellipse cx="24" cy="56" rx="5" ry="2.5" fill="#0f1f4d" />
          <ellipse cx="40" cy="56" rx="5" ry="2.5" fill="#0f1f4d" />
        </g>
        {/* the pointing arm, from the shoulder */}
        <g
          className="nodaro-marshal-arm"
          style={{ transformOrigin: "48px 38px", transform: `rotate(${arm}deg)`, ["--point" as string]: `${arm}deg` }}
        >
          <rect x="47" y="36" width="15" height="4" rx="2" fill="#ededf2" />
          <circle cx="62" cy="38" r="3" fill="#ededf2" />
        </g>
      </svg>
    </div>
  )
}
