// Types for tools/units/manifest.mjs, for the TypeScript callers that have no
// allowJs (backend/scripts/lib/gen-skills/parse-node-definitions.ts).
export interface UnitStrings {
  keys?: Record<string, Record<string, string>>
  labels?: Record<string, Record<string, string>>
}
export interface Unit {
  type: string
  dirs: { frontend: string; backend: string }
  files: { frontend: string[]; backend: string[] }
  // The parsed unit.json (validated by validateUnits); null when missing or unreadable.
  manifest: any
  manifestError: string | null
  strings: UnitStrings | null
  stringsError: string | null
  typesSource: string | null
}
export interface ValidationContext {
  legacyTypes: Set<string>
  families: Set<string>
  live: Set<string>
  capabilities: Record<string, { seam: string; why?: string }>
  exists: (repoPath: string) => boolean
}
export const TYPE_ID: RegExp
export function pascalCase(type: string): string
export function dataInterfaceName(type: string): string
export function unitBinding(type: string): string
export function loadUnits(root: string): Unit[]
export function familyIdsFrom(source: string): string[]
export function repoContext(root: string): ValidationContext
export function validateUnit(unit: Unit, ctx: ValidationContext, knownTypes: Set<string>): string[]
export function validateUnits(units: Unit[], ctx: ValidationContext): string[]
export function insertAtPositions(base: string[], units: Array<{ type: string; after: string | null }>): string[]
