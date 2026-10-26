// @test-watches docs/**/*.md backend/skills/**/*.md plugins/nodaro/skills/**/*.md packages/client/src/** packages/cli/src/** packages/client/README.md packages/cli/README.md backend/src/lib/mcp/tools/** frontend/src/ee/app/**
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Nodaro Motion's engines are "Nodaro Motion Prism" (`motion-prism`) and
 * "Nodaro Motion Pulse" (`motion-pulse`), renamed 2026-10-26 from "Pro" /
 * "Lite". Every sentence people or agents read names them so: the old names
 * appear nowhere in the docs, skills, SDK / CLI sources or the admin pages,
 * and the docs never name the earlier ids (still accepted, never documented).
 * Tests and changelogs are history and are not read.
 */
const ROOT = join(import.meta.dirname, "../../../..")
const OLD_NAMES = /\bMotion (Pro|Lite)\b/
const OLD_IDS = /\bmotion-(pro|lite)\b/

function filesUnder(dir: string, ext: RegExp): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      if (name === "node_modules" || name === "__tests__" || name === "dist") continue
      const p = join(d, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (ext.test(name) && !/CHANGELOG\.md$|\.test\.tsx?$/.test(name)) out.push(p)
    }
  }
  walk(join(ROOT, dir))
  return out
}

function offenders(files: string[], pattern: RegExp): string[] {
  return files.flatMap((f) =>
    readFileSync(f, "utf8")
      .split("\n")
      .flatMap((line, i) => (pattern.test(line) ? [`${relative(ROOT, f)}:${i + 1}: ${line.trim()}`] : [])),
  )
}

describe("Nodaro Motion engine names", () => {
  const read = [
    ...filesUnder("docs", /\.md$/),
    ...filesUnder("backend/skills", /\.md$/),
    ...filesUnder("plugins/nodaro/skills", /\.md$/),
    ...filesUnder("packages/client/src", /\.ts$/),
    ...filesUnder("packages/cli/src", /\.ts$/),
    join(ROOT, "packages/client/README.md"),
    join(ROOT, "packages/cli/README.md"),
    ...filesUnder("backend/src/lib/mcp/tools", /\.ts$/),
    ...filesUnder("frontend/src/ee/app/(admin)/admin/nodaro-motion", /\.tsx?$/),
    ...filesUnder("frontend/src/ee/app/(admin)/admin/trends", /\.tsx?$/),
  ]

  it("reads the files it guards", () => {
    expect(read.length).toBeGreaterThan(50)
  })

  it('never says "Nodaro Motion Pro" or "Nodaro Motion Lite"', () => {
    expect(offenders(read, OLD_NAMES)).toEqual([])
  })

  it("documents only the current engine ids", () => {
    const docs = [...filesUnder("docs", /\.md$/), ...filesUnder("backend/skills", /\.md$/), ...filesUnder("plugins/nodaro/skills", /\.md$/)]
    expect(offenders(docs, OLD_IDS)).toEqual([])
  })
})
