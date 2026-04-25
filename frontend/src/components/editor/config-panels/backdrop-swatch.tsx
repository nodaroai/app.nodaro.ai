"use client"

import { memo } from "react"
import { cn } from "@/lib/utils"

/**
 * Tiny CSS-only swatch preview for backdrop tiles. Each backdrop id
 * maps to a small inline style (color, gradient, or layered effect)
 * that gives the picker tile a visual cue without shipping image
 * assets. Falls back to neutral grey for any unrecognized id.
 */
const STYLE_BY_ID: Record<string, React.CSSProperties> = {
  // Solid / Seamless
  "white-seamless":     { background: "#f8f8f8" },
  "black-seamless":     { background: "#0a0a0a" },
  "grey-seamless":      { background: "#777" },
  "ivory-seamless":     { background: "#f5efe1" },
  "deep-red":           { background: "#8b0a16" },
  "royal-blue":         { background: "#23429b" },
  "emerald-green":      { background: "#1a8d6e" },
  "dusty-pink":         { background: "#d49aa8" },
  "mustard-yellow":     { background: "#d6a429" },
  "teal-textured-wall": { background: "#3a7a78" },

  // Gradient
  "red-orange-gradient":   { background: "linear-gradient(135deg, #d72020 0%, #ff8c1a 100%)" },
  "pink-orange-gradient":  { background: "linear-gradient(135deg, #ff7eb6 0%, #ff8c1a 100%)" },
  "blue-emerald-gradient": { background: "linear-gradient(135deg, #1f3fa6 0%, #1a8d6e 100%)" },
  "sunset-gradient":       { background: "linear-gradient(180deg, #6b3fa0 0%, #ff7eb6 50%, #ffae42 100%)" },
  "two-tone-split":        { background: "linear-gradient(90deg, #d72020 0%, #d72020 50%, #1f3fa6 50%, #1f3fa6 100%)" },

  // Textured (use color + radial pattern hint)
  "brick-wall":      { background: "repeating-linear-gradient(0deg, #8b3a2a 0 8px, #6b2a1a 8px 10px), #8b3a2a", backgroundSize: "auto" },
  "concrete-wall":   { background: "linear-gradient(135deg, #8c8c8c 0%, #a3a3a3 50%, #777 100%)" },
  "plastered-wall":  { background: "radial-gradient(circle at 30% 30%, #efe1cb 0%, #d9c6a6 70%, #c0a87c 100%)" },
  "peeling-paint":   { background: "linear-gradient(135deg, #c4d8d6 0%, #8e9c9b 60%, #5b6464 100%)" },
  "wood-paneling":   { background: "repeating-linear-gradient(90deg, #8b5a2b 0 12px, #6b4521 12px 14px), #8b5a2b" },

  // Fabric
  "muslin-drape":  { background: "radial-gradient(circle at 40% 40%, #d9d2c5 0%, #b3a78f 100%)" },
  "velvet-drape":  { background: "linear-gradient(135deg, #4a0e1f 0%, #8b1d3a 50%, #4a0e1f 100%)" },
  "satin-drape":   { background: "linear-gradient(135deg, #d6c0a8 0%, #f4e7d4 50%, #b89878 100%)" },
  "canvas-painted": { background: "radial-gradient(circle at 30% 30%, #d4c2a3 0%, #8e7553 100%)" },

  // Effect / Lighting
  "bokeh-blur":    { background: "radial-gradient(circle at 25% 30%, rgba(255,200,150,0.7) 0%, transparent 25%), radial-gradient(circle at 70% 60%, rgba(255,180,200,0.6) 0%, transparent 30%), #1a1a1a" },
  "neon-bokeh":    { background: "radial-gradient(circle at 25% 30%, rgba(255,80,200,0.85) 0%, transparent 30%), radial-gradient(circle at 70% 60%, rgba(80,200,255,0.85) 0%, transparent 35%), #0a0a1a" },
  "halo-glow":     { background: "radial-gradient(circle at 50% 50%, #fff 0%, #ffd070 15%, transparent 35%), #0a0a0a" },
  "light-leak":    { background: "linear-gradient(115deg, transparent 50%, rgba(255,170,80,0.85) 70%, transparent 95%), #1a1a1a" },
  "vignette-dark": { background: "radial-gradient(circle at 50% 50%, #4a4a4a 0%, #1a1a1a 70%, #050505 100%)" },

  // Reflective
  "mirror-floor":   { background: "linear-gradient(180deg, #2a2a2a 0%, #2a2a2a 50%, #6b6b6b 50%, #c8c8c8 100%)" },
  "polished-floor": { background: "linear-gradient(180deg, #4a4a4a 0%, #5a5a5a 50%, #888 75%, #b8b8b8 100%)" },
}

interface BackdropSwatchProps {
  readonly backdropId: string
  readonly className?: string
}

export const BackdropSwatch = memo(function BackdropSwatch({
  backdropId,
  className,
}: BackdropSwatchProps) {
  const style = STYLE_BY_ID[backdropId] ?? { background: "#888" }
  return (
    <div
      className={cn("rounded-md overflow-hidden border border-black/10 dark:border-white/10", className)}
      style={style}
      aria-hidden="true"
    />
  )
})
