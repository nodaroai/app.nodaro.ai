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
