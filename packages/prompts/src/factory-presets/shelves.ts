/**
 * The shelves an image-preset picker files the catalog's groups under: Video,
 * Marketing, Photos & products, Creative, Life, then the pro catalog's groups
 * (Studio · Pro). A group no shelf names goes on "more", so a group added to
 * the catalog still shows. One mapping for every picker that shelves the
 * catalog (a client's preset window, a menu that lists the categories, the
 * catalog's group summary `GET /v1/node-presets/factory/groups`).
 */

export type PresetShelf = "video" | "marketing" | "photos" | "creative" | "life" | "more" | "pro"

/** The shelves in the order a picker shows them. */
export const PRESET_SHELF_ORDER: readonly PresetShelf[] = ["video", "marketing", "photos", "creative", "life", "more", "pro"]

/** The generate-image catalog's groups on the five named shelves, in the order they are shown. */
const NAMED_SHELVES: ReadonlyArray<readonly [string, PresetShelf]> = [
  ["YouTube", "video"],
  ["Shorts · TikTok", "video"],
  ["Social & Ads", "marketing"],
  ["Business", "marketing"],
  ["Business & Marketing", "marketing"],
  ["Personal Photos", "photos"],
  ["Products & Fashion", "photos"],
  ["Home & Spaces", "photos"],
  ["Text", "creative"],
  ["Content & Creative", "creative"],
  ["Layout", "creative"],
  ["Life & Events", "life"],
  ["Family & Events", "life"],
]

/** The pro catalog's groups (the canvas's and Studio's presets), on the Studio · Pro shelf. */
const PRO_GROUPS: ReadonlySet<string> = new Set([
  "Reference Sheet", "Cast & Consistency", "Edit by Name", "Face Privacy", "Photography & Cinematic", "Characters", "Product & Commerce",
  "Branding & Logos", "Marketing & Social", "Print & Posters", "Illustration & Art Styles", "Handmade & Stop-Motion", "Film & Storyboard",
  "Architecture & Interiors", "Icons, Game Assets & Textures", "Diagrams & Infographics", "Portrait Transformations", "Stylized Subject", "Edits",
  "Realism & Authentic",
])

const SHELF_OF: ReadonlyMap<string, PresetShelf> = new Map(NAMED_SHELVES)

/** The shelf a group goes on. */
export function presetShelf(group: string): PresetShelf {
  return SHELF_OF.get(group) ?? (PRO_GROUPS.has(group) ? "pro" : "more")
}

/** Where a group stands among the named shelves' groups (the design's order), or -1 for one no named shelf lists. */
export function presetShelfRank(group: string): number {
  return NAMED_SHELVES.findIndex(([name]) => name === group)
}
