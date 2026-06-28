import type { SheetSection, SheetEntry, SheetType, SheetSkin, SheetAspect, SheetPresetId } from "./types.js"

export type { SheetPresetId }

/** Build ordered preset entries from a variant list (a curated board subset). */
export const presetEntries = (vs: readonly string[]): SheetEntry[] =>
  vs.map((variant) => ({ kind: "preset", variant }))

export interface SheetPreset {
  id: SheetPresetId
  label: string
  description: string
  /** Carrier for the route's required `type` enum; the layout comes from `baseSections`. */
  type: SheetType
  baseSections: SheetSection[]
  skin: SheetSkin
  aspect: SheetAspect
}

/**
 * Studio sheet presets (character only). Each bundles a curated head+body
 * turnaround (via `entries`) + a default skin/aspect + a carrier `type`. The
 * à-la-carte boards below layer optional extra bands on top.
 *
 * `studio-main` is the clean screenshot format (head: front, profiles, back-of-
 * head; body: front, side, back). `studio-extended` adds above/below + 3/4
 * angles for fuller coverage.
 */
export const SHEET_PRESETS: readonly SheetPreset[] = [
  {
    id: "studio-main",
    label: "Studio · Main",
    description: "Clean turnaround for AI video reference — head (front, profiles, back) + body (front, side, back).",
    type: "turnaround",
    skin: "studio",
    aspect: "landscape",
    baseSections: [
      { kind: "head-turnaround", entries: presetEntries(["front", "left profile", "right profile", "back"]) },
      { kind: "body-turnaround", entries: presetEntries(["front", "left profile", "back"]) },
    ],
  },
  {
    id: "studio-extended",
    label: "Studio · Extended",
    description: "Full turnaround — adds above/below and 3/4 angles for maximum coverage.",
    type: "full-reference",
    skin: "studio",
    aspect: "landscape",
    baseSections: [
      { kind: "head-turnaround", entries: presetEntries(["front", "3/4 left", "left profile", "right profile", "3/4 right", "above", "below", "back"]) },
      { kind: "body-turnaround", entries: presetEntries(["front", "3/4 left", "left profile", "right profile", "back", "above", "below"]) },
    ],
  },
]

export const PRESET_LABELS: Record<SheetPresetId, string> = {
  "studio-main": "Studio · Main",
  "studio-extended": "Studio · Extended",
}

export interface AlaCarteBoard {
  id: string
  label: string
  /** UI hint: panels this board adds (the board's default slice). Free boards are 0. */
  panelCount: number
  section: SheetSection
}

/** Optional boards layered on a base preset. No `entries` → the planner uses the
 *  board's default slice (`min(4, board length)`). Palette is structural (free). */
export const ALA_CARTE_BOARDS: readonly AlaCarteBoard[] = [
  { id: "expressions", label: "Expressions", panelCount: 4, section: { kind: "expression-board" } },
  { id: "poses",       label: "Poses",       panelCount: 4, section: { kind: "pose-board" } },
  { id: "wardrobe",    label: "Wardrobe",    panelCount: 3, section: { kind: "wardrobe-board" } },
  { id: "detail",      label: "Detail",      panelCount: 3, section: { kind: "detail-board" } },
  { id: "palette",     label: "Palette",     panelCount: 0, section: { kind: "palette" } },
]
