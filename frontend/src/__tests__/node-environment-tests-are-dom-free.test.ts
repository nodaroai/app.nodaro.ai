// @test-watches frontend/src/**/*.test.ts frontend/src/**/*.test.tsx
import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"

/**
 * Pure-logic test files opt out of jsdom with a first-line environment
 * docblock (the Vitest per-file environment comment naming `node`). jsdom
 * stays the default; the opt-out skips building a DOM per file, which is most
 * of the frontend suite's environment cost.
 *
 * A file earned the opt-out by passing under node with the same tests as under
 * jsdom while touching no DOM-only global, transitively. This guard keeps that
 * true by reading the source: a node-environment test file may not name a DOM
 * global or reach for Testing Library. Its runtime twin is the trap at the end
 * of src/test/setup.ts, which throws when node-environment code reads one. It is a cheap, over-strict text check —
 * a mention in a comment or a string fails it too. That is deliberate: it only
 * ever blocks an opt-out, and a file that needs the word simply stays on jsdom
 * (drop its docblock).
 *
 * The docblock must be the file's first line: Vitest takes the first
 * environment marker it finds anywhere in a file, so line one is the only
 * place a later mention cannot override. This file spells the marker in
 * pieces so Vitest never reads one here.
 */

const MARKER = "@vitest" + "-environment"
const DOCBLOCK = `// ${MARKER} node`
// Vitest's own detection (cli-api `getEnvironment`): the first match in the file.
const ENV_RE = new RegExp(`@(?:vitest|jest)-environment\\s+([\\w-]+)\\b`)

const FORBIDDEN: ReadonlyArray<{ re: RegExp; why: string }> = [
  {
    re: /\b(window|document|navigator|localStorage|sessionStorage|Element|HTMLElement|requestAnimationFrame|getComputedStyle|matchMedia|jsdom)\b/,
    why: "names a DOM global",
  },
  {
    // `self` and `location` are also everyday words (self-host, a Location entity),
    // so they are caught where they are used as the globals: a property read.
    re: /\b(self|location)\.[A-Za-z_$]|\bglobalThis\.(self|location)\b/,
    why: "uses the self/location global",
  },
  { re: /@testing-library\//, why: "imports Testing Library (render/screen/renderHook need a DOM)" },
  { re: /\brenderHook\b/, why: "renders a hook" },
]

const SRC = path.resolve(__dirname, "..")

function testFiles(): string[] {
  return (fs.readdirSync(SRC, { recursive: true }) as string[])
    .filter((p) => /\.test\.tsx?$/.test(p) && !p.split(path.sep).includes("node_modules"))
    .map((p) => p.split(path.sep).join("/"))
    .sort()
}

function nodeEnvironmentFiles(): Array<{ file: string; source: string }> {
  return testFiles()
    .map((file) => ({ file, source: fs.readFileSync(path.join(SRC, file), "utf8") }))
    .filter(({ source }) => source.match(ENV_RE)?.[1] === "node")
}

describe("node-environment test files", () => {
  it("there are some (the scan matches how Vitest reads the docblock)", () => {
    expect(nodeEnvironmentFiles().length).toBeGreaterThan(0)
  })

  it("declare the environment on their first line", () => {
    const misplaced = nodeEnvironmentFiles()
      .filter(({ source }) => source.split("\n", 1)[0].trim() !== DOCBLOCK)
      .map(({ file }) => `src/${file}`)
    expect(misplaced).toEqual([])
  })

  it("never reach for the DOM", () => {
    const violations: string[] = []
    for (const { file, source } of nodeEnvironmentFiles()) {
      source.split("\n").forEach((line, i) => {
        for (const { re, why } of FORBIDDEN) {
          if (re.test(line)) violations.push(`src/${file}:${i + 1} ${why} — keep this file on jsdom (remove its first-line docblock): ${line.trim()}`)
        }
      })
    }
    expect(violations).toEqual([])
  })
})
