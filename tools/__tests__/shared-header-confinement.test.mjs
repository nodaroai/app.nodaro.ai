import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"

/**
 * The shared site header is a private, cloud-only package. This repo is
 * mirrored publicly, so its name is confined to frontend/src/ee/shell/ (the
 * resolver, the stub, the install script and the internal-only contract
 * check); the Dockerfile and every core file reach it only through
 * `virtual:site-header` and that script. tools/ is excluded (this file has to
 * describe what it looks for), and the patterns are built from fragments so
 * the test does not trip its own search.
 */

const repo = new URL("../../", import.meta.url)
const ALLOWED = /^frontend\/src\/ee\/shell\//

function trackedFilesMatching(pattern, flags = []) {
  try {
    return execFileSync("git", ["grep", "-l", ...flags, "-e", pattern, "--", ".", ":!tools/"], { cwd: repo, encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
  } catch (error) {
    if (error.status === 1) return [] // no match
    throw error
  }
}

test("the header package is named only under frontend/src/ee/shell/", () => {
  const name = ["@nodaroai", "shell"].join("/")
  const files = trackedFilesMatching(name, ["-F"])
  assert.ok(files.some((f) => ALLOWED.test(f)), "expected the resolver under frontend/src/ee/shell/ to name it")
  assert.deepEqual(files.filter((f) => !ALLOWED.test(f)), [])
})

test("no VITE_* variable carries the program's internal name", () => {
  const word = ["WOR", "LDS"].join("")
  assert.deepEqual(trackedFilesMatching(`VITE_[A-Z0-9_]*${word}`, ["-E", "-i"]), [])
})
