// @reads backend/src/nodes/*/*.ts
/**
 * The one door to a node unit's source files on the server
 * (backend/src/nodes/<type>/, tools/units/README.md) for code that READS
 * sources — the route inventory and every test that walks the route or worker
 * trees. A unit's route and worker live in its own folder, so a walk of
 * backend/src/routes or workers/handlers alone never sees them;
 * src/__tests__/unit-walkers-guard.test.ts fails a test that walks those trees
 * without one of these.
 */
import { existsSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

/** Where node units live, relative to the repo root. */
export const UNIT_SOURCE_ROOT = "backend/src/nodes"

/** Every node unit's file named one of `names` (absolute), sorted by unit, then by `names` order. */
export function unitSourceFiles(repoRoot: string, names: ReadonlyArray<string>): string[] {
  const dir = join(repoRoot, UNIT_SOURCE_ROOT)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((n) => !n.startsWith("_") && statSync(join(dir, n)).isDirectory())
    .sort()
    .flatMap((n) => names.map((f) => join(dir, n, f)))
    .filter((f) => existsSync(f))
}

/** Every node unit's route file (absolute): route.ts, or route.ee.ts when Cloud-only. */
export const unitRouteFiles = (repoRoot: string): string[] => unitSourceFiles(repoRoot, ["route.ts", "route.ee.ts"])

/** Every node unit's queue worker (absolute): worker.ts. */
export const unitWorkerFiles = (repoRoot: string): string[] => unitSourceFiles(repoRoot, ["worker.ts"])
