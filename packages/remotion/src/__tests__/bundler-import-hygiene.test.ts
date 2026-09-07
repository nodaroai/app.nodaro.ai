import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, dirname, relative } from "node:path"
import { fileURLToPath } from "node:url"

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..")

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      // Tests are read by Vitest, never by webpack, so the rule does not apply
      // to them (several predate this guard and use the .js form).
      if (entry === "__tests__") continue
      out.push(...sourceFiles(full))
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

/**
 * Relative imports in this package must stay EXTENSIONLESS.
 *
 * Unlike `backend/src` (Node ESM, where every relative import must end in
 * `.js`), packages/remotion is compiled by WEBPACK — both by the render
 * worker's `@remotion/bundler` call and by the frontend's Vite alias. Webpack
 * has no `extensionAlias` configured here, so `./sampler.js` is looked up
 * literally, misses, and the whole bundle fails with
 * "Field 'browser' doesn't contain a valid alias configuration" — at render
 * time, on a real job, long after tests and tsc pass (`moduleResolution:
 * "bundler"` and Vitest both accept the `.js` form happily).
 */
describe("bundler import hygiene", () => {
  it("has no relative import ending in .js", () => {
    const pattern = /(?:from\s*|import\s*\(\s*)["'](\.[^"']*\.js)["']/g
    const offenders: string[] = []

    for (const file of sourceFiles(SRC)) {
      const contents = readFileSync(file, "utf8")
      for (const match of contents.matchAll(pattern)) {
        offenders.push(`${relative(SRC, file)} -> ${match[1]}`)
      }
    }

    expect(offenders).toEqual([])
  })
})
