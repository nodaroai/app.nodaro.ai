/**
 * `JOB_STATUSES` ↔ the public reference ↔ the published SDK type.
 *
 * `lib/job-status.ts` is the single source of truth for `jobs.status`, but two
 * copies of that vocabulary are hand-written and public: the `JobStatus` line
 * in docs/sdk-reference.md and the `JobStatus` union in
 * packages/client/src/resources/jobs.ts (the npm-published type). When a
 * status lands in the database and neither copy learns it, an integrator's
 * `switch` on status falls through to "unknown failure" — the exact drift
 * `pending_review` (a job held for human review: in-flight, NOT terminal)
 * would otherwise cause.
 *
 * Direction: code → docs. Every member of `JOB_STATUSES` must appear in both
 * hand-written copies. Anti-vacuity guards keep a broken regex from passing
 * silently.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { JOB_STATUSES } from "../job-status.js"

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(here, "..", "..", "..", "..")
const SDK_REFERENCE = resolve(REPO_ROOT, "docs", "sdk-reference.md")
const CLIENT_JOBS = resolve(REPO_ROOT, "packages", "client", "src", "resources", "jobs.ts")

/** The `"…"` string literals inside one span of text. */
function quotedLiterals(span: string): string[] {
  return [...span.matchAll(/"([a-z_]+)"/g)].map((m) => m[1])
}

/** docs/sdk-reference.md — the `- \`JobStatus\` — \`"pending" | …\`` bullet.
 *  Only the FIRST backtick code span after the name is the union; the prose
 *  that follows may name statuses in other contexts (e.g. "resolves to
 *  `completed`"), so it must not count. */
function docsJobStatusUnion(): string[] {
  const doc = readFileSync(SDK_REFERENCE, "utf8")
  const line = doc.split("\n").find((l) => /^- `JobStatus` — /.test(l))
  if (!line) throw new Error("docs/sdk-reference.md has no `- `JobStatus` — ` bullet")
  const span = line.match(/^- `JobStatus` — `([^`]+)`/)?.[1]
  if (!span) throw new Error("docs/sdk-reference.md `JobStatus` bullet has no code span")
  return quotedLiterals(span)
}

/** packages/client/src/resources/jobs.ts — `export type JobStatus = | "…" …`. */
function clientJobStatusUnion(): string[] {
  const src = readFileSync(CLIENT_JOBS, "utf8")
  const block = src.match(/export type JobStatus\s*=([\s\S]*?)\n\n/)?.[1]
  if (!block) throw new Error("packages/client/src/resources/jobs.ts has no `export type JobStatus =` block")
  return quotedLiterals(block)
}

describe("JOB_STATUSES is mirrored by the public reference and the published SDK type", () => {
  it("scans something real (anti-vacuity)", () => {
    expect(JOB_STATUSES.length).toBeGreaterThanOrEqual(6)
    expect(docsJobStatusUnion().length).toBeGreaterThanOrEqual(6)
    expect(clientJobStatusUnion().length).toBeGreaterThanOrEqual(6)
  })

  it("docs/sdk-reference.md's `JobStatus` union names every JOB_STATUSES member", () => {
    const documented = new Set(docsJobStatusUnion())
    const missing = JOB_STATUSES.filter((s) => !documented.has(s))
    expect(
      missing,
      `statuses in lib/job-status.ts with no mention in docs/sdk-reference.md's \`JobStatus\` line: ${missing.join(", ")}`,
    ).toEqual([])
  })

  it("the published SDK `JobStatus` union names every JOB_STATUSES member", () => {
    const published = new Set(clientJobStatusUnion())
    const missing = JOB_STATUSES.filter((s) => !published.has(s))
    expect(
      missing,
      `statuses in lib/job-status.ts absent from packages/client/src/resources/jobs.ts's \`JobStatus\`: ${missing.join(", ")}`,
    ).toEqual([])
  })
})
