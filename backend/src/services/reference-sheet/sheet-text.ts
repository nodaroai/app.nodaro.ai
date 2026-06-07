import type { EntityKind } from "@nodaro/shared"

const HEADINGS: Record<string, string> = {
  "head-turnaround": "FACE REFERENCE", "body-turnaround": "FULL BODY VIEWS",
  turnaround: "TURNAROUND", coverage: "ESTABLISHING SHOTS",
  "expression-board": "EXPRESSIONS", "pose-board": "POSES",
  "material-board": "MATERIALS", "variation-board": "VARIATIONS",
  "environment-board": "ENVIRONMENT", "detail-board": "DETAILS", "wardrobe-board": "WARDROBE",
}
/** English structural heading for a section kind (i18n is a later plan). */
export function headingFor(kind: string): string {
  return HEADINGS[kind] ?? kind.replace(/-/g, " ").toUpperCase()
}

const META_FIELDS: Record<EntityKind, string[]> = {
  character: ["gender", "style", "baseOutfit"],
  object: ["category", "style"],
  location: ["category", "style"],
}
const toSnake = (s: string) => s.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase())
const toLabel = (s: string) => s.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())

/** Pull a few display metadata fields from the entity row (camelCase or snake_case). */
export function buildSheetMetadata(kind: EntityKind, row: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of META_FIELDS[kind]) {
    const v = row[f] ?? row[toSnake(f)]
    if (typeof v === "string" && v.length > 0) out[toLabel(f)] = v
  }
  return out
}
