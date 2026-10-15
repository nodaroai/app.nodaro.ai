// tools/__tests__/test-data-readers-guard.test.mjs
// A file in declared-test-data.json selects only its readers (select.mjs),
// so every file that names it must be a reader the engine sees: a module that
// imports it (the graph), a test or helper whose @test-watches matches it, or
// product code whose @reads matches it. Prose (markdown) may mention it.
import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"
import { parseAnnotations, parseReads } from "../test-select/annotations.mjs"
import { matchesAny } from "../test-select/glob.mjs"
import { DECLARED_TEST_DATA } from "../test-select/select.mjs"

const repo = path.resolve(import.meta.dirname, "../..")
const namers = (base) => {
  try {
    return execFileSync("git", ["-C", repo, "grep", "-l", "-F", base], { encoding: "utf8" }).split("\n").filter(Boolean)
  } catch { return [] }
}

test("every declared test-data file is named only by readers the engine sees", () => {
  for (const file of DECLARED_TEST_DATA) {
    const base = path.posix.basename(file)
    const offenders = []
    for (const namer of namers(base)) {
      if (namer === file || namer.endsWith(".md") || namer === "tools/test-select/declared-test-data.json") continue
      const source = readFileSync(path.join(repo, namer), "utf8")
      const imports = new RegExp(`(?:from|import)\\s*\\(?\\s*["'][^"']*${base.replace(/[.]/g, "\\.")}["']`).test(source)
      const watched = matchesAny(file, parseAnnotations(source).watches)
      const read = matchesAny(file, parseReads(source).reads)
      if (!imports && !watched && !read) offenders.push(namer)
    }
    assert.deepEqual(offenders, [], `${file} is named by files the engine cannot see read it — import it, or add \`// @test-watches ${file}\` (\`@reads\` in product code)`)
  }
})

test("declared test data exists and is test data", () => {
  for (const file of DECLARED_TEST_DATA) {
    assert.match(file, /\/(?:__tests__|__goldens__|__fixtures__|fixtures)\//)
    assert.doesNotThrow(() => readFileSync(path.join(repo, file)), file)
  }
})
