import type { SheetSkin, SheetAspect, SectionKind } from "@nodaro/shared"

/** One placed image cell within a band (absolute canvas coords). */
export interface Slot {
  x: number
  y: number
  w: number
  h: number
}

/** A panel ready to composite: a decoded image buffer + its caption. */
export interface ResolvedPanel {
  image: Buffer
  label?: string
}

/** A swatch for the palette band. */
export interface ResolvedSwatch {
  hex: string
  label: string
}

/** A section with all of its content already resolved to buffers/strings —
 *  the compositor does no fetching or planning, only layout + raster. */
export interface ResolvedSection {
  kind: SectionKind
  /** Section heading ("EXPRESSIONS"); for `header` this is the entity name/title. */
  title?: string
  subtitle?: string
  /** Board/turnaround/detail/wardrobe panels (in display order). */
  panels?: ResolvedPanel[]
  /** Header-only: optional hero image + metadata key/value lines. */
  hero?: Buffer
  metadata?: Record<string, string>
  /** Palette-only swatches. */
  swatches?: ResolvedSwatch[]
  /** Notes-only free text. */
  text?: string
}

export interface ComposeInput {
  skin: SheetSkin
  aspect: SheetAspect
  sections: ResolvedSection[]
  /** When false, name/role/traits and notes text are suppressed (structural labels still drawn). */
  withText?: boolean
  /** When false, per-panel caption labels are suppressed. */
  showLabels?: boolean
  /** "background" renders the chrome (hero + SVG text/labels/palette) but SKIPS the
   *  panel-image composite, leaving the slot rectangles empty — the motion renderer
   *  then overlays clips into those slots via FFmpeg. Default (undefined) = the
   *  normal still sheet with panels composited in. */
  slotsMode?: "background"
}

/** Visual vocabulary for a skin. Plan 07 adds cinematic/blueprint/illustrated. */
export interface SkinTokens {
  bg: string
  panelBg: string
  frame: string
  text: string
  subtext: string
  accent: string
  fontFamily: string
}

export const SKIN_TOKENS: Record<SheetSkin, SkinTokens> = {
  studio: {
    bg: "#f4f4f5", panelBg: "#ffffff", frame: "#d4d4d8",
    text: "#18181b", subtext: "#71717a", accent: "#2563eb", fontFamily: "DejaVu Sans, sans-serif",
  },
  // Plan 07 replaces these placeholders with authored tokens.
  cinematic: {
    bg: "#0b0b0e", panelBg: "#16161c", frame: "#33333a",
    text: "#fafafa", subtext: "#a1a1aa", accent: "#22d3ee", fontFamily: "DejaVu Sans, sans-serif",
  },
  blueprint: {
    bg: "#0e2a47", panelBg: "#0b2238", frame: "#3b6ea5",
    text: "#e6f1ff", subtext: "#9db8d6", accent: "#7dd3fc", fontFamily: "DejaVu Sans Mono, monospace",
  },
  illustrated: {
    bg: "#efe6d4", panelBg: "#fbf6ea", frame: "#caa66a",
    text: "#3a2c1a", subtext: "#7a6a52", accent: "#b4541f", fontFamily: "DejaVu Serif, serif",
  },
}

/** Canvas width per aspect (height grows with the band stack). */
export const CANVAS_WIDTH: Record<SheetAspect, number> = {
  landscape: 1600,
  square: 1200,
  story: 900,
}

/** Grid columns per aspect for board/turnaround bands. */
export const GRID_COLUMNS: Record<SheetAspect, number> = {
  landscape: 5,
  square: 4,
  story: 3,
}
