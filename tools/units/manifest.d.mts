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
  /** The add-node option types of LEGACY_NODE_OPTIONS (node-options.tsx); a unit first in its family must follow one (or a picker unit). */
  optionTypes?: Set<string>
  /** The builder keys of USE_CASE_SPECS (packages/render-rules/src/use-case-specs.ts); a use-case unit's execution.builder must be one. */
  useCaseBuilders?: Set<string>
  live: Set<string>
  /** Each capability with every seam that reads it (tools/units/capabilities.mjs). */
  capabilities: Record<string, { seams: string[]; why?: string }>
  exists: (repoPath: string) => boolean
  /** A repo file's text, or null; the checks that read files skip without it. */
  readText?: (repoPath: string) => string | null
}
export const TYPE_ID: RegExp
export function pascalCase(type: string): string
export function dataInterfaceName(type: string): string
export function unitBinding(type: string): string
export function loadUnits(root: string): Unit[]
export function familyIdsFrom(source: string): string[]
export function familyTypesFrom(source: string): Map<string, string[]>
export function optionTypesFrom(options: string): Set<string>
export function reservedIdsFrom(sources?: { credits?: string; options?: string; macros?: string[]; codeBuiltCreditIds?: string[] }): Map<string, string>
export function repoContext(root: string): ValidationContext
export function validateUnit(unit: Unit, ctx: ValidationContext, knownTypes: Set<string>, unitFamilies?: Map<string, string>): string[]
export function validateUnits(units: Unit[], ctx: ValidationContext): string[]
export function insertAtPositions(base: string[], units: Array<{ type: string; after: string | null }>): string[]
