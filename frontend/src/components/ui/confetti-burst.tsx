import { useEffect, useRef } from "react"
import { createPortal } from "react-dom"

/**
 * A burst of confetti over the whole page, once each time `fire` changes to a
 * new truthy value: the moment a long piece of work is done. Drawn on one
 * canvas that ignores the pointer and is gone after the burst. Nothing at all
 * for a person who asked for less motion.
 */
const COLORS = ["#ff0073", "#ff4d9d", "#f5b942", "#34d399", "#38bdf8", "#c39bff"]
const PIECES = 140
const LIFE_MS = 2200

interface Piece {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  spin: number
  angle: number
  color: string
}

export function makePieces(width: number, random: () => number = Math.random): Piece[] {
  return Array.from({ length: PIECES }, () => ({
    x: width / 2 + (random() - 0.5) * width * 0.4,
    y: -10 - random() * 40,
    vx: (random() - 0.5) * 9,
    vy: 2 + random() * 5,
    size: 5 + random() * 6,
    spin: (random() - 0.5) * 0.3,
    angle: random() * Math.PI,
    color: COLORS[Math.floor(random() * COLORS.length)]!,
  }))
}

function reducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
}

export function ConfettiBurst({ fire }: { readonly fire: number | string | null | undefined }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!fire || !canvas || reducedMotion()) return
    const context = canvas.getContext("2d")
    if (!context) return
    const width = (canvas.width = window.innerWidth)
    const height = (canvas.height = window.innerHeight)
    const pieces = makePieces(width)
    const start = performance.now()
    let frame = 0
    const draw = (now: number) => {
      const t = now - start
      context.clearRect(0, 0, width, height)
      context.globalAlpha = Math.max(0, 1 - t / LIFE_MS)
      for (const p of pieces) {
        p.vy += 0.12
        p.vx *= 0.99
        p.x += p.vx
        p.y += p.vy
        p.angle += p.spin
        context.save()
        context.translate(p.x, p.y)
        context.rotate(p.angle)
        context.fillStyle = p.color
        context.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2)
        context.restore()
      }
      if (t < LIFE_MS) frame = requestAnimationFrame(draw)
      else context.clearRect(0, 0, width, height)
    }
    frame = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(frame)
      context.clearRect(0, 0, width, height)
    }
  }, [fire])

  if (typeof document === "undefined") return null
  return createPortal(
    <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none fixed inset-0 z-[9999] h-screen w-screen" />,
    document.body,
  )
}
