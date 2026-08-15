#!/usr/bin/env node
/**
 * Copies the non-TypeScript assets the compiled backend reads at runtime into
 * `dist/`, mirroring their `src/` location.
 *
 * `tsc -p tsconfig.build.json` emits JavaScript only. Anything the runtime
 * resolves RELATIVE TO ITS COMPILED FILE — the tutorial-seed templates, read
 * with `readdir(join(dirname(import.meta.url), "templates"))` — therefore
 * never reaches the image unless something copies it. Nothing did: every
 * community boot logged `[tutorial-seed] skipped: ENOENT`, the seeder swallowed
 * it, and the Tutorials tab read "No tutorials yet" on every install while CI
 * stayed green (2026-08-16 fresh-install test).
 *
 * This script is the single place that knows which assets exist. It runs
 * from THREE build entry points, all of which invoke tsc directly rather than
 * `npm run build` (the Docker stage skips the `prebuild` hook on purpose):
 *   - backend/package.json  `build`
 *   - Dockerfile            backend-build stage
 *   - .github/workflows/ci.yml  backend-boot-smoke
 * so add new assets HERE, not at the call sites.
 *
 * It fails loudly — non-zero exit — when a declared asset directory is
 * missing, empty, or its file count in `dist/` does not match `src/`. A path
 * typo must be a red build, never a quiet skip.
 *
 * Usage: node scripts/copy-build-assets.mjs   (cwd = backend/)
 */

import { copyFile, mkdir, readdir, stat } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

/** Directories under src/ whose matching files must ship under dist/. */
export const BUILD_ASSETS = Object.freeze([
  {
    // Tutorial workflow templates — read by src/lib/tutorial-seed/index.ts at
    // boot; each *.json becomes a workflow_templates row on a fresh install.
    dir: "lib/tutorial-seed/templates",
    match: /\.json$/i,
  },
])

/**
 * Copy every declared asset from `<rootDir>/src` to `<rootDir>/dist` and
 * verify the result. Returns one entry per asset with the copied file names.
 * Throws when an asset directory is missing/empty or the copy is incomplete.
 */
export async function copyBuildAssets({ rootDir, assets = BUILD_ASSETS } = {}) {
  if (!rootDir) throw new Error("copyBuildAssets: rootDir is required")
  const srcRoot = resolve(rootDir, "src")
  const distRoot = resolve(rootDir, "dist")
  const report = []

  for (const asset of assets) {
    const from = join(srcRoot, asset.dir)
    const to = join(distRoot, asset.dir)
    const files = await listMatching(from, asset.match)
    if (files.length === 0) {
      throw new Error(
        `copy-build-assets: no files matching ${asset.match} in ${relative(rootDir, from)} — ` +
          `the asset directory moved or is empty; update BUILD_ASSETS or restore the files`,
      )
    }
    await mkdir(to, { recursive: true })
    await Promise.all(files.map((f) => copyFile(join(from, f), join(to, f))))

    const shipped = await listMatching(to, asset.match)
    const missing = files.filter((f) => !shipped.includes(f))
    if (missing.length > 0) {
      throw new Error(
        `copy-build-assets: ${missing.length} of ${files.length} files did not land in ${relative(rootDir, to)}: ${missing.join(", ")}`,
      )
    }
    report.push({ dir: asset.dir, files })
  }
  return report
}

async function listMatching(dir, match) {
  let entries
  try {
    entries = await readdir(dir)
  } catch (err) {
    if (err && err.code === "ENOENT") return []
    throw err
  }
  const files = []
  for (const name of entries) {
    if (!match.test(name)) continue
    const info = await stat(join(dir, name))
    if (info.isFile()) files.push(name)
  }
  return files.sort()
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
  copyBuildAssets({ rootDir: backendRoot })
    .then((report) => {
      for (const { dir, files } of report) {
        console.log(`[copy-build-assets] ${files.length} file(s) -> dist/${dir}`)
      }
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err)
      process.exit(1)
    })
}
