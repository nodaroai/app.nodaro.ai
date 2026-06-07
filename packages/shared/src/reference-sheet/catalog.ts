import {
  CHARACTER_ASSET_VARIANTS, OBJECT_ASSET_VARIANTS, LOCATION_ASSET_VARIANTS,
} from "../entity-prompts.js"
import type { EntityKind, SectionKind, SheetType, SheetSection } from "./types.js"

/** Starter presets for the NEW close-up bucket (per entity). Custom entries override. */
export const DETAIL_VARIANTS: Record<EntityKind, readonly string[]> = {
  character: ["eyes", "hands", "hair detail"],
  object: ["texture", "material detail", "key part"],
  location: ["architectural detail", "material detail", "focal element"],
}

/** Starter presets for the NEW wardrobe bucket (character only). Custom entries override. */
export const WARDROBE_VARIANTS = ["base look", "alternate look", "sporty"] as const

/** Logical board → ordered canonical variants, per entity. Character/object/location
 *  pull from the SoT lists; detail/wardrobe are the new buckets. */
export const BOARD_VARIANTS: Record<EntityKind, Record<string, readonly string[]>> = {
  character: {
    headAngles: CHARACTER_ASSET_VARIANTS.headAngles,
    bodyAngles: CHARACTER_ASSET_VARIANTS.bodyAngles,
    expressions: CHARACTER_ASSET_VARIANTS.expressions,
    poses: CHARACTER_ASSET_VARIANTS.poses,
    lighting: CHARACTER_ASSET_VARIANTS.lighting,
    detail: DETAIL_VARIANTS.character,
    wardrobe: WARDROBE_VARIANTS,
  },
  object: {
    angles: OBJECT_ASSET_VARIANTS.angles,
    materials: OBJECT_ASSET_VARIANTS.materials,
    variations: OBJECT_ASSET_VARIANTS.variations,
    detail: DETAIL_VARIANTS.object,
  },
  location: {
    angles: LOCATION_ASSET_VARIANTS.angles,
    timeOfDay: LOCATION_ASSET_VARIANTS.timeOfDay,
    weather: LOCATION_ASSET_VARIANTS.weather,
    seasons: LOCATION_ASSET_VARIANTS.seasons,
    lighting: LOCATION_ASSET_VARIANTS.lighting,
    detail: DETAIL_VARIANTS.location,
  },
}

/** Section kinds that NEVER produce panels (chrome/text bands). The single
 *  source of truth for "structural" — the planner uses this to decide whether a
 *  section with no resolvable board is intentionally panel-less (these) or a
 *  misconfiguration (e.g. `environment-board` with no explicit `board`, which
 *  must throw, not silently yield zero panels). */
export const STRUCTURAL_SECTIONS = new Set<SectionKind>(["header", "palette", "scale", "notes"])

/** Default board for each board-typed section kind. `null` = no default board.
 *  For the four structural kinds (`STRUCTURAL_SECTIONS`) that means "no panels".
 *  For `environment-board` it means "ambiguous (3 buckets) — the section MUST
 *  carry an explicit `board`" (the planner throws if it doesn't). */
export const SECTION_BOARD: Record<SectionKind, string | null> = {
  header: null, palette: null, scale: null, notes: null,
  "head-turnaround": "headAngles",
  "body-turnaround": "bodyAngles",
  turnaround: "angles",
  coverage: "angles",
  "expression-board": "expressions",
  "pose-board": "poses",
  "material-board": "materials",
  "variation-board": "variations",
  "environment-board": null, // requires explicit section.board (timeOfDay|weather|seasons)
  "detail-board": "detail",
  "wardrobe-board": "wardrobe",
}

/** Sections each entity supports (catalog gate for the config picker, Plan 06). */
export const ENTITY_SECTIONS: Record<EntityKind, readonly SectionKind[]> = {
  character: ["header", "head-turnaround", "body-turnaround", "expression-board", "pose-board",
    "detail-board", "wardrobe-board", "palette", "scale", "notes"],
  object: ["header", "turnaround", "material-board", "variation-board", "detail-board",
    "palette", "scale", "notes"],
  location: ["header", "coverage", "environment-board", "detail-board", "palette", "scale", "notes"],
}

const sec = (kind: SectionKind, extra: Partial<SheetSection> = {}): SheetSection => ({ kind, ...extra })

/** Preset section stacks per (entity, type). `full-reference` is the rich poster
 *  (YUVAL order for character); other types are single-board presets. */
export const DEFAULT_SECTIONS: Record<EntityKind, Record<SheetType, readonly SheetSection[]>> = {
  character: {
    turnaround: [sec("header"), sec("head-turnaround")],
    "variation-board": [sec("header"), sec("expression-board")],
    detail: [sec("header"), sec("detail-board")],
    "full-reference": [
      sec("header"), sec("head-turnaround"), sec("expression-board"), sec("body-turnaround"),
      sec("pose-board"), sec("detail-board"), sec("wardrobe-board"), sec("palette"), sec("notes"),
    ],
  },
  object: {
    turnaround: [sec("header"), sec("turnaround")],
    "variation-board": [sec("header"), sec("material-board")],
    detail: [sec("header"), sec("detail-board")],
    "full-reference": [
      sec("header"), sec("turnaround"), sec("material-board"), sec("variation-board"),
      sec("detail-board"), sec("palette"), sec("notes"),
    ],
  },
  location: {
    turnaround: [sec("header"), sec("coverage")],
    "variation-board": [sec("header"), sec("environment-board", { board: "timeOfDay" })],
    detail: [sec("header"), sec("detail-board")],
    "full-reference": [
      sec("header"), sec("coverage"),
      sec("environment-board", { board: "timeOfDay" }),
      sec("environment-board", { board: "weather" }),
      sec("detail-board"), sec("palette"), sec("notes"),
    ],
  },
}

/** Default number of panels drawn from a board when the section doesn't specify. */
export const DEFAULT_PANEL_COUNT = 4

/** Logical board key → real entity DB column (headAngles→angles,
 *  lighting→lighting_variations, timeOfDay→time_of_day, etc.). The worker uses
 *  this to find a panel's asset in the entity's JSONB buckets. */
export const BOARD_TO_COLUMN: Record<EntityKind, Record<string, string>> = {
  character: { headAngles: "angles", bodyAngles: "body_angles", expressions: "expressions", poses: "poses", lighting: "lighting_variations", detail: "detail_closeups", wardrobe: "outfit_variations" },
  object: { angles: "angles", materials: "materials", variations: "variations", detail: "detail_closeups" },
  location: { angles: "angles", timeOfDay: "time_of_day", weather: "weather", seasons: "seasons", lighting: "lighting", detail: "detail_closeups" },
}

/** Flat per-entity DB column holding motion clips ({name,url} videos). Unlike
 *  still panels (per-board columns via BOARD_TO_COLUMN), all of an entity's motion
 *  clips live in ONE column, looked up by name===variant. Used by the motion
 *  reference sheet to find the clip for each planned panel. */
export const MOTION_COLUMN: Record<EntityKind, string> = {
  character: "motions",
  object: "motion_clips",
  location: "atmosphere_motions",
}

/** Logical board → the `generate-*-asset` `assetType` to use. Standard boards map
 *  to their own assetType; detail/wardrobe have no dedicated assetType so they go
 *  through `custom` (with a built userPrompt). */
export const BOARD_TO_ASSET_TYPE: Record<EntityKind, Record<string, string>> = {
  character: { headAngles: "headAngles", bodyAngles: "bodyAngles", expressions: "expressions", poses: "poses", lighting: "lighting", detail: "custom", wardrobe: "custom" },
  object: { angles: "angles", materials: "materials", variations: "variations", detail: "custom" },
  location: { angles: "angles", timeOfDay: "timeOfDay", weather: "weather", seasons: "seasons", lighting: "lighting", detail: "custom" },
}
