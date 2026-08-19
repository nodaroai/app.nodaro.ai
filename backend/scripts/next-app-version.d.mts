/** Types for the plain-.mjs release engine (runs in CI with zero build). */
export interface Commit { subject: string; body: string }
export interface Classified {
  breaking: number
  breakingSubjects: string[]
  feats: string[]
  fixes: string[]
  others: string[]
}
export interface Semver { major: number; minor: number; patch: number }
export function lastVersionTag(): string | null
export function parseVersion(tag: string): Semver
export function commitsSince(tag: string): Commit[]
export function classify(commits: Commit[]): Classified
export function nextVersion(current: Semver, cls: { breaking: number; feats: string[] }): Semver
export function releaseNotes(fromTag: string, next: string, cls: Classified): string
export function compute(): {
  current: string
  next: string
  bump: "major" | "minor" | "patch"
  commitCount: number
  counts: { feats: number; fixes: number; breaking: number; other: number }
  notes: string
}
