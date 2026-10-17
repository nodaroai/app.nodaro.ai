// Types for tools/test-select/glob.mjs, for TypeScript callers (the backend has no allowJs).
export function globToRegExp(glob: string): RegExp
export function matchesAny(path: string, globs: readonly string[]): boolean
