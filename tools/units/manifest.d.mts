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
  /** Each hand-written family's member types (picker.after must name one, or a unit of that family). */
  familyTypes?: Map<string, string[]>
  /** Ids a unit may not take, with why (Object.prototype names are refused regardless). */
  reserved?: Map<string, string>
  live: Set<string>
  /** The seam that reads each capability, or each tree's seam when both trees read it. */
  capabilities: Record<string, { seam: string | string[]; why?: string }>
  exists: (repoPath: string) => boolean
}
export const TYPE_ID: RegExp
export function pascalCase(type: string): string
export function dataInterfaceName(type: string): string
export function unitBinding(type: string): string
export function loadUnits(root: string): Unit[]
export function familyIdsFrom(source: string): string[]
export function familyTypesFrom(source: string): Map<string, string[]>
export function reservedIdsFrom(sources?: { credits?: string; options?: string; macros?: string[]; codeBuiltCreditIds?: string[] }): Map<string, string>
export function repoContext(root: string): ValidationContext
export function validateUnit(unit: Unit, ctx: ValidationContext, knownTypes: Set<string>, unitFamilies?: Map<string, string>): string[]
export function validateUnits(units: Unit[], ctx: ValidationContext): string[]
export function insertAtPositions(base: string[], units: Array<{ type: string; after: string | null }>): string[]
