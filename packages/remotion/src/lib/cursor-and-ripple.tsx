import React from "react"

/**
 * Brand-colored pointer cursor + optional expanding press ripple, extracted
 * from cta-morph-press so multiple blueprints can drive a cursor. Purely
 * presentational — the caller computes position, visibility, and ripple state.
 * The ripple is an optional unit: omit `ripple` for cursor-only callers so no
 * inert extra `<div>` renders.
 */
export function CursorAndRipple(props: {
  x: number
  y: number
  size: number
  color: string
  visible: boolean
  ripple?: { scale: number; opacity: number; w: number; h: number; radius: number }
}) {
  const { x, y, size, color, visible, ripple } = props
  return (
    <>
      {ripple && (
        <div
          style={{
            position: "absolute",
            left: x,
            top: y,
            width: ripple.w,
            height: ripple.h,
            borderRadius: ripple.radius,
            border: `2px solid ${color}`,
            transform: `translate(-50%, -50%) scale(${ripple.scale})`,
            opacity: ripple.opacity,
            pointerEvents: "none",
          }}
        />
      )}
      <svg
        width={size}
        height={Math.round(size * 1.33)}
        viewBox="0 0 18 24"
        style={{
          position: "absolute",
          left: x,
          top: y,
          overflow: "visible",
          opacity: visible ? 1 : 0,
          filter: "drop-shadow(1px 2px 3px rgba(0,0,0,0.5))",
          pointerEvents: "none",
        }}
      >
        <polygon points="0,0 0,18 5,14 8,22 11,21 8,13 14,13" fill={color} stroke="rgba(0,0,0,0.6)" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    </>
  )
}
