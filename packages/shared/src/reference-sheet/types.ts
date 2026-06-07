export type EntityKind = "character" | "object" | "location"

export const SHEET_TYPES = ["turnaround", "variation-board", "detail", "full-reference"] as const
export type SheetType = (typeof SHEET_TYPES)[number]

export const SHEET_SKINS = ["studio", "cinematic", "blueprint", "illustrated"] as const
export type SheetSkin = (typeof SHEET_SKINS)[number]

export const SHEET_ASPECTS = ["landscape", "square", "story"] as const
export type SheetAspect = (typeof SHEET_ASPECTS)[number]

export const OUTPUT_FORMATS = ["still", "motion"] as const
export type OutputFormat = (typeof OUTPUT_FORMATS)[number]

export const SECTION_KINDS = [
  "header",
  "head-turnaround", "body-turnaround", "turnaround", "coverage",
  "expression-board", "pose-board", "material-board", "variation-board", "environment-board",
  "detail-board", "wardrobe-board",
  "palette", "scale", "notes",
] as const
export type SectionKind = (typeof SECTION_KINDS)[number]

export const SHEET_BACKGROUNDS = ["grey", "white", "transparent", "in-context"] as const
export type SheetBackground = (typeof SHEET_BACKGROUNDS)[number]

/** A board entry is either a catalog preset (by variant) or a user-authored custom panel. */
export interface PresetEntry { kind: "preset"; variant: string }
export interface CustomEntry { kind: "custom"; label: string; prompt: string }
export type SheetEntry = PresetEntry | CustomEntry

/** One band in the sheet. `board` disambiguates kinds that map to several buckets (environment-board). */
export interface SheetSection {
  kind: SectionKind
  board?: string
  subtitle?: string
  panelCount?: number
  entries?: SheetEntry[]   // omitted => planner fills the default preset set
}

export interface SheetFlavour {
  outputFormat: OutputFormat
  withText: boolean
  showLabels: boolean
  aspect: SheetAspect
  background: SheetBackground
  sections?: SheetSection[]   // explicit stack for `full-reference`; other types derive defaults
}

/** A single panel the planner says must exist (reused or generated). */
export interface PanelRequest {
  section: SectionKind
  board: string       // logical board key (maps to a DB column via the backend adapter, Plan 04)
  variant: string     // preset variant string, or the custom label
  label: string
  custom: boolean
  prompt?: string      // present iff custom
}

export interface Swatch { hex: string; label: string }
export interface PanelSource { board: string; variant: string; assetId?: string; url: string }
export interface SheetTextData {
  title?: string
  metadata?: Record<string, string>
  notes?: string
  sectionLabels?: Record<string, string>
}

export interface ReferenceSheet {
  id: string
  type: SheetType
  skin: SheetSkin
  flavour: SheetFlavour
  source: "studio" | "node"
  url: string
  panelUrls: string[]
  panelSources: PanelSource[]
  sectionsSnapshot: SheetSection[]
  metadataSnapshot: SheetTextData
  paletteSnapshot: Swatch[]
  sourceImageUrlAtGen: string
  createdAt: string
}

/** Hard ceilings (also re-asserted in the route Zod schema, Plan 04). */
export const MAX_PANELS_PER_SHEET = 24
export const MAX_CUSTOM_ENTRIES_PER_BOARD = 12
