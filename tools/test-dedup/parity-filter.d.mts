// Types for tools/test-dedup/parity-filter.mjs, for TypeScript callers (the backend has no allowJs).
export type ParityEntry = {
  file: string
  deps: string[]
  watches: string[]
  always: string | null
  scanner: boolean
  reads: string[]
  undeclaredReader: string | null
  computedImport: boolean
  runsCommand: boolean
}
export type ParityClassified = { file: string; category: string; importsFrontend: boolean; watches: string[] }
export function staticEntry(file: string, read: (path: string) => string | null): ParityEntry
export function parityRun(discovered: readonly string[], read: (path: string) => string | null): {
  run: string[]
  skipped: string[]
  classified: ParityClassified[]
}
