#!/usr/bin/env node
/**
 * The use-case routes the boot smoke probes (`backend-boot-smoke` in
 * .github/workflows/ci.yml): each registered use-case node's run and continue,
 * on every edition.
 *
 * Derived from the use-case registry (`@nodaro/render-rules`), the same one
 * the run and continue route factories loop over — so a new use-case node is
 * probed the moment it is registered, and nobody keeps a list. The probe's
 * expectation comes from the registry and its answer from the booted app, so a
 * factory that stops registering a type fails the boot (404), which a list
 * read off the route files could not show.
 *
 * Usage: `node backend/scripts/use-case-probe-paths.mjs` prints the paths, one
 * space between them (for a shell `for` loop). Exits 1 when the registry
 * yields none: an empty list would turn the probe into a silent no-op.
 * Guarded by backend/src/__tests__/use-case-probe-paths.test.ts.
 */
// @reads-none derives the paths from the use-case registry in code; reads no file
import { realpathSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { USE_CASE_NODE_TYPES, usecaseContinuePath, usecaseDescriptor } from "@nodaro/render-rules"

/** Every registered use-case node's run route, then its continue route, in registry order. */
export function usecaseProbePaths() {
  return USE_CASE_NODE_TYPES.flatMap((type) => [usecaseDescriptor(type).route, usecaseContinuePath(type)])
}

function isMain() {
  if (!process.argv[1]) return false
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isMain()) {
  const paths = usecaseProbePaths()
  if (paths.length === 0) {
    process.stderr.write("use-case-probe-paths: the use-case registry yields no routes — the boot probe would check nothing\n")
    process.exit(1)
  }
  process.stdout.write(`${paths.join(" ")}\n`)
}
