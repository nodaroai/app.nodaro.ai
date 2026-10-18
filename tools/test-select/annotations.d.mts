// Types for tools/test-select/annotations.mjs, for TypeScript callers (the backend has no allowJs).
export interface TestAnnotations {
  watches: string[]
  always: string | null
  forCaller: string | null
  readsNone: string | null
}
export function parseAnnotations(source: string): TestAnnotations
export function parseReads(source: string): { reads: string[]; readsNone: string | null }
export function isScanner(source: string): boolean
export interface RegistryAnnotations {
  members: string[]
  exports: { aggregate: string; names: string[] }[]
  lookup: string | null
  enumerates: string | null
  unitsByName: string | null
}
export function parseRegistryAnnotations(source: string): RegistryAnnotations
