/**
 * `lib/job-policy.ts` is a REGISTRY, not an applier: it must stay
 * dependency-light (spec §5.1, invariant I5).
 *
 * What fails without this guard: the first convenience import. `workers/shared.js`
 * pulls `sharp`, `youtube-dl-exec` and `@remotion/*` at its top; `lib/queue.js`
 * constructs an IORedis connection at module scope. Either one dragged into the
 * registry lands in all eight reconcile modules (which import only supabase +
 * credits today), in every one of their test suites, and in the pipeline
 * worker's cold start — and a Redis connection at import time turns a unit test
 * into an integration test that hangs on a machine with no Redis.
 *
 * The applier that IS allowed to touch supabase, storage and credits is
 * `lib/job-policy-gate.ts`. The direction is one-way: `workers/shared.ts`
 * imports the seam, never the reverse.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const REGISTRY = join(__dirname, "..", "job-policy.ts")

/** Every `from "..."` / `import("...")` specifier in the file. */
function specifiersOf(src: string): string[] {
  return [
    ...[...src.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1]!),
    ...[...src.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]!),
  ]
}

describe("lib/job-policy.ts stays a dependency-light registry", () => {
  const src = readFileSync(REGISTRY, "utf8")
  const specs = specifiersOf(src)

  it("imports nothing from workers/, lib/queue.js or ee/", () => {
    const banned = specs.filter(
      (s) => /(^|\/)workers\//.test(s) || /(^|\/)queue\.js$/.test(s) || /(^|\/)ee\//.test(s),
    )
    expect(
      banned,
      `lib/job-policy.ts must not import ${banned.join(", ")}. workers/shared.js drags sharp + ` +
        `youtube-dl-exec + @remotion into every reconcile module and its tests; lib/queue.js opens ` +
        `a Redis connection at import time. Put the dependency in lib/job-policy-gate.ts instead.`,
    ).toEqual([])
  })

  it("imports no runtime module at all (the registry is types + arrays)", () => {
    // `import type` is fine — it is erased. Anything else is a runtime edge.
    const runtime = [...src.matchAll(/^\s*import\s+(?!type\b)[^\n]*from\s+["']([^"']+)["']/gm)].map((m) => m[1]!)
    expect(
      runtime,
      `lib/job-policy.ts gained a runtime import (${runtime.join(", ")}). Registries in this repo ` +
        `(upload-policy.ts, prompt-policy.ts) have none — that is what makes them safe to import ` +
        `from a route, a worker and a cron alike.`,
    ).toEqual([])
  })

  it("the guard is wired to a file that exists and declares the registry", () => {
    expect(src).toContain("export function registerJobPolicy")
    expect(src).toContain("export function hasJobPolicyFor")
  })
})
