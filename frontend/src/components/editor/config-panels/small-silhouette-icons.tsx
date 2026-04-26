"use client"

/**
 * Small inline silhouette icons for chip-level Person/Styling dimensions.
 *
 * Build / Facial Hair / Eyewear / Headwear each have fewer than ~15 entries,
 * so they don't need a modal browser — a ~20×20 icon inside the existing
 * chip layout is enough. Each icon is a minimal pictogram drawn in
 * `currentColor` so it matches the chip's selection tint.
 */

import type { JSX } from "react"

const p = (d: string) => <path d={d} fill="currentColor" />
const ps = (d: string) => <path d={d} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
const c = (cx: number, cy: number, r: number) => <circle cx={cx} cy={cy} r={r} fill="currentColor" />
const cs = (cx: number, cy: number, r: number) => <circle cx={cx} cy={cy} r={r} fill="none" stroke="currentColor" strokeWidth={2} />

// ---------------------------------------------------------------------------
// Build (body silhouettes) — head + torso + arms + legs with varied shapes.
// ---------------------------------------------------------------------------
const BUILD: Record<string, JSX.Element> = {
  "petite":        <g>{c(12, 5, 2)}{p("M10 7 L10 14 L9 22 M14 7 L14 14 L15 22 M11 7 L11 13 L9 13 M13 7 L13 13 L15 13")}</g>,
  "slim":          <g>{c(12, 4, 2)}{p("M10 6 L10 14 L9 22 M14 6 L14 14 L15 22 M11 6 L9 12 M13 6 L15 12")}</g>,
  "average-build": <g>{c(12, 4, 2)}{p("M9 6 L9 14 L8 22 M15 6 L15 14 L16 22 M10 6 L7 12 M14 6 L17 12")}</g>,
  "athletic":      <g>{c(12, 4, 2)}{p("M8 7 L9 13 L8 22 M16 7 L15 13 L16 22 M10 7 L6 12 M14 7 L18 12")}</g>,
  "muscular":      <g>{c(12, 4, 2)}{p("M7 7 L9 13 L8 22 M17 7 L15 13 L16 22 M10 7 L4 12 M14 7 L20 12")}</g>,
  "curvy":         <g>{c(12, 4, 2)}{p("M9 7 L7 14 L9 22 M15 7 L17 14 L15 22 M10 7 L7 12 M14 7 L17 12")}</g>,
  "heavy-set":     <g>{c(12, 4, 2)}{p("M7 7 L6 15 L9 22 M17 7 L18 15 L15 22 M9 7 L5 13 M15 7 L19 13")}</g>,
  "tall-lean":     <g>{c(12, 3, 2)}{p("M10 5 L10 16 L9 24 M14 5 L14 16 L15 24 M11 5 L9 13 M13 5 L15 13")}</g>,
  "voluptuous":    <g>{c(12, 4, 2)}{p("M9 6 L7 12 L9 16 L8 22 M15 6 L17 12 L15 16 L16 22 M10 6 L7 11 M14 6 L17 11")}</g>,
  "hourglass":     <g>{c(12, 4, 2)}{p("M8 6 L9 11 L7 16 L8 22 M16 6 L15 11 L17 16 L16 22 M9 6 L6 11 M15 6 L18 11")}</g>,
  "pear-build":    <g>{c(12, 4, 2)}{p("M10 6 L9 12 L7 16 L8 22 M14 6 L15 12 L17 16 L16 22 M10 6 L8 11 M14 6 L16 11")}</g>,
  "apple-build":   <g>{c(12, 4, 2)}{p("M9 6 L7 13 L10 16 L10 22 M15 6 L17 13 L14 16 L14 22 M10 6 L7 11 M14 6 L17 11")}</g>,
  "rectangular":   <g>{c(12, 4, 2)}{p("M9 6 L9 16 L9 22 M15 6 L15 16 L15 22 M10 6 L8 12 M14 6 L16 12")}</g>,
  "plus-size":     <g>{c(12, 4, 2)}{p("M6 7 L5 14 L8 22 M18 7 L19 14 L16 22 M9 7 L4 12 M15 7 L20 12")}</g>,
  "lanky":         <g>{c(12, 3, 1.8)}{p("M10 5 L10 17 L9 24 M14 5 L14 17 L15 24 M11 5 L8 14 M13 5 L16 14")}</g>,
}

// ---------------------------------------------------------------------------
// Facial Hair — small face outline + beard / mustache shape on top.
// ---------------------------------------------------------------------------
const FACE_BASE = <ellipse cx={12} cy={12} rx={7} ry={8.5} fill="none" stroke="currentColor" strokeWidth={1.5} />

const FACIAL_HAIR: Record<string, JSX.Element> = {
  "face-clean-shaven": <g>{FACE_BASE}</g>,
  "face-stubble":      <g>{FACE_BASE}{ps("M7 16 L8 17 M10 17 L11 18 M13 17 L14 18 M16 16 L17 17")}</g>,
  "face-mustache":     <g>{FACE_BASE}{p("M8 13 Q12 15 16 13 L15 14 L13 14 L12 13 L11 14 L9 14 Z")}</g>,
  "face-goatee":       <g>{FACE_BASE}{p("M10 16 Q12 20 14 16 L14 20 Q12 22 10 20 Z")}</g>,
  "face-short-beard":  <g>{FACE_BASE}{p("M6 14 Q12 19 18 14 L17 19 Q12 21 7 19 Z")}</g>,
  "face-full-beard":   <g>{FACE_BASE}{p("M5 13 Q12 21 19 13 L18 22 Q12 24 6 22 Z")}</g>,
}

// ---------------------------------------------------------------------------
// Eyewear — just the glasses silhouette.
// ---------------------------------------------------------------------------
const EYEWEAR: Record<string, JSX.Element> = {
  "eyewear-sunglasses":  <g>{p("M3 10 L10 10 L10 15 L3 15 Z")}{p("M14 10 L21 10 L21 15 L14 15 Z")}{ps("M10 12 L14 12")}</g>,
  "eyewear-aviators":    <g>{ps("M7 10 L9 15 L5 15 Z")}{ps("M17 10 L15 15 L19 15 Z")}{ps("M9 12 L15 12")}</g>,
  "eyewear-cat-eye":     <g>{p("M3 11 L10 10 L10 14 L3 14 Z")}{p("M14 10 L21 11 L21 14 L14 14 Z")}{p("M3 11 L1 9 M21 11 L23 9")}</g>,
  "eyewear-round":       <g>{cs(7, 12, 4)}{cs(17, 12, 4)}{ps("M11 12 L13 12")}</g>,
  "eyewear-fashion":     <g>{p("M2 9 L11 9 L11 16 L2 16 Z")}{p("M13 9 L22 9 L22 16 L13 16 Z")}{ps("M11 12 L13 12")}</g>,
  "eyewear-sport":       <g>{p("M2 10 Q12 6 22 10 L21 15 Q12 17 3 15 Z")}</g>,
}

// ---------------------------------------------------------------------------
// Headwear — small hat/head silhouette.
// ---------------------------------------------------------------------------
const HEAD = <ellipse cx={12} cy={18} rx={6} ry={4} fill="none" stroke="currentColor" strokeWidth={1.2} />

const HEADWEAR: Record<string, JSX.Element> = {
  "headwear-beanie":       <g>{HEAD}{p("M6 14 Q12 4 18 14 Z")}{ps("M12 4 L12 2")}</g>,
  "headwear-baseball-cap": <g>{HEAD}{p("M7 14 Q12 6 17 14 Z")}{p("M5 14 L22 14 L22 12 L5 12 Z")}</g>,
  "headwear-fedora":       <g>{HEAD}{p("M8 12 Q12 4 16 12 Z")}{p("M3 12 L21 12 L21 14 L3 14 Z")}</g>,
  "headwear-sun-hat":      <g>{HEAD}{p("M7 12 Q12 6 17 12 Z")}{p("M1 12 L23 12 L23 14 L1 14 Z")}</g>,
  "headwear-headband":     <g>{HEAD}{p("M6 13 L18 13 L18 15 L6 15 Z")}</g>,
  "headwear-bandana":      <g>{HEAD}{p("M6 12 L18 12 L20 16 L4 16 Z")}{ps("M6 12 L4 10 M18 12 L20 10")}</g>,
  "headwear-hood":         <g>{p("M4 10 Q12 3 20 10 L20 20 L4 20 Z")}{ps("M8 14 L16 14 L16 20")}</g>,
  "headwear-crown":        <g>{HEAD}{p("M5 12 L7 6 L10 10 L12 4 L14 10 L17 6 L19 12 Z")}</g>,
  "headwear-helmet":       <g>{HEAD}{p("M5 14 Q12 4 19 14 Z")}{ps("M5 14 L19 14")}</g>,
  "headwear-veil":         <g>{HEAD}{ps("M5 8 Q12 6 19 8 L18 18 L6 18 Z")}</g>,
}

// ---------------------------------------------------------------------------
// Face Shape — outline of the face silhouette.
// ---------------------------------------------------------------------------
const FACE_SHAPE: Record<string, JSX.Element> = {
  "face-oval":       <ellipse cx={12} cy={12} rx={6} ry={9} fill="none" stroke="currentColor" strokeWidth={1.5} />,
  "face-round":      <circle cx={12} cy={12} r={7} fill="none" stroke="currentColor" strokeWidth={1.5} />,
  "face-square":     <rect x={5} y={5} width={14} height={14} rx={1.5} fill="none" stroke="currentColor" strokeWidth={1.5} />,
  "face-heart":      ps("M5 6 Q5 4 7 4 L17 4 Q19 4 19 6 L19 11 Q19 16 12 21 Q5 16 5 11 Z"),
  "face-diamond":    ps("M12 3 L20 12 L12 21 L4 12 Z"),
  "face-oblong":     <rect x={7} y={3} width={10} height={18} rx={5} fill="none" stroke="currentColor" strokeWidth={1.5} />,
  "face-triangular": ps("M5 4 L19 4 L12 21 Z"),
}

// ---------------------------------------------------------------------------
// Jawline — bottom of face emphasizing chin / jaw shape.
// ---------------------------------------------------------------------------
const JAWLINE: Record<string, JSX.Element> = {
  "jaw-strong":  ps("M5 4 L5 12 L8 18 L12 20 L16 18 L19 12 L19 4"),
  "jaw-soft":    ps("M5 4 L5 11 Q5 18 12 20 Q19 18 19 11 L19 4"),
  "jaw-pointed": ps("M5 4 L5 10 L9 16 L12 21 L15 16 L19 10 L19 4"),
  "jaw-wide":    ps("M5 4 L4 12 L6 18 L12 19 L18 18 L20 12 L19 4"),
  "jaw-double":  <g>{ps("M5 4 L5 11 Q5 16 12 17 Q19 16 19 11 L19 4")}{ps("M7 17 Q12 22 17 17")}</g>,
}

// ---------------------------------------------------------------------------
// Eye Shape — single eye drawing; corners + lid shape vary.
// ---------------------------------------------------------------------------
const EYE_SHAPE: Record<string, JSX.Element> = {
  "eye-almond":     <g>{ps("M3 12 Q12 6 21 12 Q12 18 3 12 Z")}{c(12, 12, 2.5)}</g>,
  "eye-round":      <g>{cs(12, 12, 6)}{c(12, 12, 2.5)}</g>,
  "eye-hooded":     <g>{ps("M3 12 Q12 7 21 12 Q12 17 3 12 Z")}{ps("M3 12 Q12 4 21 12")}{c(12, 13, 2)}</g>,
  "eye-monolid":    <g>{ps("M3 11 Q12 8 21 11 Q12 15 3 11 Z")}{c(12, 11, 2)}</g>,
  "eye-deep-set":   <g>{ps("M5 9 Q12 7 19 9")}{ps("M3 13 Q12 9 21 13 Q12 17 3 13 Z")}{c(12, 13, 2)}</g>,
  "eye-downturned": <g>{ps("M3 9 Q12 7 21 13 Q12 19 3 9 Z")}{c(11, 12, 2.5)}</g>,
  "eye-upturned":   <g>{ps("M3 13 Q12 19 21 9 Q12 7 3 13 Z")}{c(13, 12, 2.5)}</g>,
  "eye-wide-set":   <g>{ps("M1 12 Q5 9 9 12 Q5 15 1 12 Z")}{ps("M15 12 Q19 9 23 12 Q19 15 15 12 Z")}{c(5, 12, 1.5)}{c(19, 12, 1.5)}</g>,
  "eye-close-set":  <g>{ps("M5 12 Q9 9 13 12 Q9 15 5 12 Z")}{ps("M11 12 Q15 9 19 12 Q15 15 11 12 Z")}{c(9, 12, 1.5)}{c(15, 12, 1.5)}</g>,
}

// ---------------------------------------------------------------------------
// Nose — front view (or slight 3/4 for hooked/aquiline).
// ---------------------------------------------------------------------------
const NOSE: Record<string, JSX.Element> = {
  "nose-straight": ps("M12 4 L12 16 M9 18 Q12 20 15 18"),
  "nose-aquiline": ps("M11 4 Q14 8 13 12 L13 16 M9 18 Q12 20 15 18"),
  "nose-roman":    ps("M11 4 L13 8 L11 12 L13 16 M9 18 Q12 20 15 18"),
  "nose-snub":     ps("M12 6 L11 14 Q9 18 12 18 Q15 18 13 14 Z"),
  "nose-button":   <g>{ps("M12 8 L12 14")}{c(12, 16, 3)}</g>,
  "nose-broad":    ps("M10 4 L8 14 Q8 18 12 18 Q16 18 16 14 L14 4"),
  "nose-narrow":   ps("M12 4 L11 16 L13 16 Z M10 18 L14 18"),
  "nose-hooked":   ps("M11 4 Q14 7 14 12 Q14 16 9 18"),
}

// ---------------------------------------------------------------------------
// Lips — mouth silhouette variations.
// ---------------------------------------------------------------------------
const LIPS: Record<string, JSX.Element> = {
  "lips-thin":       p("M3 11 L21 11 L21 13 L3 13 Z"),
  "lips-medium":     p("M3 10 Q12 7 21 10 Q21 14 12 16 Q3 14 3 10 Z"),
  "lips-full":       p("M3 9 Q12 4 21 9 Q21 16 12 19 Q3 16 3 9 Z"),
  "lips-wide":       p("M1 11 Q12 8 23 11 Q23 14 12 16 Q1 14 1 11 Z"),
  "lips-cupids-bow": p("M3 10 Q7 8 9 12 L12 8 L15 12 Q17 8 21 10 Q21 14 12 16 Q3 14 3 10 Z"),
  "lips-small":      p("M7 10 Q12 8 17 10 Q17 13 12 14 Q7 13 7 10 Z"),
}

// ---------------------------------------------------------------------------
// Body Proportions — body silhouette emphasising leg/torso ratio.
// ---------------------------------------------------------------------------
const BODY_PROPORTIONS: Record<string, JSX.Element> = {
  "proportions-balanced":     <g>{c(12, 4, 2)}{p("M9 6 L9 14 L8 22 M15 6 L15 14 L16 22")}</g>,
  "proportions-long-legged":  <g>{c(12, 3, 2)}{p("M10 5 L10 12 L8 22 M14 5 L14 12 L16 22")}</g>,
  "proportions-short-legged": <g>{c(12, 5, 2)}{p("M9 7 L9 17 L8 22 M15 7 L15 17 L16 22")}</g>,
  "proportions-long-torso":   <g>{c(12, 3, 2)}{p("M10 5 L10 17 L9 22 M14 5 L14 17 L15 22")}</g>,
  "proportions-hourglass":    <g>{c(12, 4, 2)}{p("M8 6 L10 11 L8 14 L9 22 M16 6 L14 11 L16 14 L15 22")}</g>,
  "proportions-pear":         <g>{c(12, 4, 2)}{p("M10 6 L9 12 L7 14 L9 22 M14 6 L15 12 L17 14 L15 22")}</g>,
  "proportions-apple":        <g>{c(12, 4, 2)}{p("M9 6 L7 12 L9 14 L9 22 M15 6 L17 12 L15 14 L15 22")}</g>,
  "proportions-inverted":     <g>{c(12, 4, 2)}{p("M7 6 L10 12 L10 14 L9 22 M17 6 L14 12 L14 14 L15 22")}</g>,
}

function Svg({ children, className }: { children: JSX.Element; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden role="img" style={{ pointerEvents: "none" }}>
      {children}
    </svg>
  )
}

export function BuildIcon({ buildId, className }: { readonly buildId: string; readonly className?: string }) {
  const shape = BUILD[buildId]
  if (!shape) return null
  return <Svg className={className}>{shape}</Svg>
}

export function FacialHairIcon({ facialHairId, className }: { readonly facialHairId: string; readonly className?: string }) {
  const shape = FACIAL_HAIR[facialHairId]
  if (!shape) return null
  return <Svg className={className}>{shape}</Svg>
}

export function EyewearIcon({ eyewearId, className }: { readonly eyewearId: string; readonly className?: string }) {
  const shape = EYEWEAR[eyewearId]
  if (!shape) return null
  return <Svg className={className}>{shape}</Svg>
}

export function HeadwearIcon({ headwearId, className }: { readonly headwearId: string; readonly className?: string }) {
  const shape = HEADWEAR[headwearId]
  if (!shape) return null
  return <Svg className={className}>{shape}</Svg>
}

export function FaceShapeIcon({ id, className }: { readonly id: string; readonly className?: string }) {
  const shape = FACE_SHAPE[id]
  if (!shape) return null
  return <Svg className={className}>{shape}</Svg>
}

export function JawlineIcon({ id, className }: { readonly id: string; readonly className?: string }) {
  const shape = JAWLINE[id]
  if (!shape) return null
  return <Svg className={className}>{shape}</Svg>
}

export function EyeShapeIcon({ id, className }: { readonly id: string; readonly className?: string }) {
  const shape = EYE_SHAPE[id]
  if (!shape) return null
  return <Svg className={className}>{shape}</Svg>
}

export function NoseIcon({ id, className }: { readonly id: string; readonly className?: string }) {
  const shape = NOSE[id]
  if (!shape) return null
  return <Svg className={className}>{shape}</Svg>
}

export function LipsIcon({ id, className }: { readonly id: string; readonly className?: string }) {
  const shape = LIPS[id]
  if (!shape) return null
  return <Svg className={className}>{shape}</Svg>
}

export function BodyProportionsIcon({ id, className }: { readonly id: string; readonly className?: string }) {
  const shape = BODY_PROPORTIONS[id]
  if (!shape) return null
  return <Svg className={className}>{shape}</Svg>
}
