// @test-watches docs/**/*.md backend/skills/**/*.md plugins/nodaro/skills/**/*.md packages/client/src/** packages/cli/src/** packages/client/README.md packages/cli/README.md backend/src/** backend/scripts/** frontend/src/** packages/shared/src/** packages/prompts/src/** packages/render-rules/src/**
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * The product is "Video Remake", and its engines are "Nodaro Prism"
 * (`nodaro-prism`) and "Nodaro Pulse" (`nodaro-pulse`). Every sentence people
 * or agents read names them so: the product's earlier name, the engines'
 * earlier names ("Nodaro Motion Prism" / "Pulse", and "Pro" / "Lite" before
 * them) and names the product never shipped under appear nowhere in the docs,
 * skills, SDK / CLI sources, the MCP tools, the admin pages or the UI strings;
 * and the docs never name the earlier engine ids, the earlier route prefix,
 * MCP tool, SDK member or CLI command (each still accepted, never
 * documented). Tests and changelogs are history and are not read.
 */
const ROOT = join(import.meta.dirname, "../../../..")
const OLD_NAMES = /\bNodaro\s+Motion\b|\bNODARO MOTION\b|\bMotion (Pro|Lite|Prism|Pulse)\b|\bMOTION (PRISM|PULSE)\b|video[\s_-]?(remix|swap)|video(remix|swap)/i
const OLD_IDS = /\bmotion-(pro|lite|prism|pulse)\b|\/v1\/cast-swap\b|\/v1\/admin\/nodaro-motion\b|\bcast_swap\b|\bclient\.castSwap\b|\bnodaro cast-swap\b|\/video\/nodaro-motion\b/
/** Product names never released: in no source of the repo. */
const NEVER_SHIPPED = /video[\s_-]?(remix|swap)|video(remix|swap)/i

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

describe("Video Remake and its engines' names", () => {
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
    ...filesUnder("frontend/src/lib/i18n", /\.ts$/),
  ]

  it("reads the files it guards", () => {
    expect(read.length).toBeGreaterThan(50)
  })

  it("never names the product or an engine by an earlier name", () => {
    expect(offenders(read, OLD_NAMES)).toEqual([])
  })

  it("documents only the current engine ids, route prefix, MCP tool, SDK member and CLI command", () => {
    const docs = [...filesUnder("docs", /\.md$/), ...filesUnder("backend/skills", /\.md$/), ...filesUnder("plugins/nodaro/skills", /\.md$/)]
    expect(offenders(docs, OLD_IDS)).toEqual([])
  })

  it("never names the product by a name it was never released under", () => {
    const sources = [
      ...filesUnder("backend/src", /\.(ts|mts|json)$/),
      ...filesUnder("backend/scripts", /\.(ts|mts|mjs)$/),
      ...filesUnder("frontend/src", /\.(ts|tsx|json)$/),
      ...filesUnder("packages/shared/src", /\.ts$/),
      ...filesUnder("packages/prompts/src", /\.ts$/),
      ...filesUnder("packages/render-rules/src", /\.ts$/),
      ...read,
    ].filter((f) => !f.endsWith("nodaro-motion-wording.test.ts"))
    expect(offenders([...new Set(sources)], NEVER_SHIPPED)).toEqual([])
  })
})
