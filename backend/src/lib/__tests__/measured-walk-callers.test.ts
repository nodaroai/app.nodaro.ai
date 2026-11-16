// @test-watches backend/src/**/*.ts frontend/src/**/*.ts frontend/src/**/*.tsx packages/render-rules/src/**/*.ts
/**
 * The measured walk is read with a slack ONLY through a measuring step's row
 * (`measuringStepReadOptions(step)`, `MEASURING_STEP_ALLOWANCES`), so every
 * step that reads it is a row the overshoot guard holds — a new step cannot
 * bypass the table. Derived from the code, not a list of steps:
 *
 * - no product file outside the walk's own module and the table names the
 *   walk's slack option (`plannedClipSlackSec`);
 * - the walk's two entry points that take a slack — `measuredWireLengthSec`
 *   and `plannedVideoLengthSec`, a made clip's planned length — are only
 *   CALLED by name: never imported, exported or destructured under another
 *   name, never passed or stored as a value (so no caller escapes the scan);
 * - every call of either in a product file reads only what the graph knows
 *   (`knownOnly: true`, the walk's own: no slack) or spreads its step's row
 *   (`...measuringStepReadOptions(`) — last, so nothing passed before it can
 *   set a slack or a reading.
 *
 * The rule itself (`walkReadOffences`) is held by its own cases below: each
 * way past it that the reviews found must be an offence.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = join(__dirname, "../../../..")
const SOURCE_DIRS = ["backend/src", "frontend/src", "packages/render-rules/src"]
/** The walk itself and the table of rows: the only files that name the slack option. */
const WALK_MODULE = "packages/render-rules/src/measured-wire-length.ts"
const WALK_MODULES = new Set([WALK_MODULE, "packages/render-rules/src/measured-step-allowances.ts"])
/** The walk's entry points that take a slack. */
const WALK_FUNCTIONS = ["measuredWireLengthSec", "plannedVideoLengthSec"] as const

function productFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (name === "node_modules" || name === "dist" || name === "__tests__" || name === "__characterization__") continue
    if (statSync(path).isDirectory()) out.push(...productFiles(path))
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec|e2e\.test)\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) out.push(path)
  }
  return out
}

/** `code` without its comments (a name in a doc comment is no use of it). */
function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1")
}

/** The text of each call of `fn(` in `code`, up to its closing parenthesis. */
function callsOf(code: string, fn: string): string[] {
  const calls: string[] = []
  const at = new RegExp(`\\b${fn}\\s*\\(`, "g")
  for (let m = at.exec(code); m; m = at.exec(code)) {
    // A declaration of the function is not a call.
    if (/function\s+$/.test(code.slice(Math.max(0, m.index - 20), m.index))) continue
    let depth = 0
    let end = m.index + m[0].length - 1
    for (; end < code.length; end++) {
      if (code[end] === "(") depth++
      else if (code[end] === ")" && --depth === 0) break
    }
    calls.push(code.slice(m.index, end + 1))
  }
  return calls
}

/** Whether a call reads only what the graph knows, or spreads its step's row as its options' last entry. */
function callKeepsItsRow(fn: (typeof WALK_FUNCTIONS)[number], call: string): boolean {
  if (fn === "measuredWireLengthSec" && /\bknownOnly:\s*true\b/.test(call)) return true
  const stepAt = call.lastIndexOf("...measuringStepReadOptions(")
  if (stepAt < 0) return false
  // After the row's spread: only the closing of the options object and of the call.
  return /^\s*,?\s*\}\s*\)$/.test(call.slice(call.indexOf(")", stepAt) + 1))
}

/** Every way a product file reads the walk past a measuring step's row. */
function walkReadOffences(rel: string, source: string): string[] {
  if (rel === WALK_MODULE) return []
  const code = withoutComments(source)
  const offences: string[] = []
  for (const fn of WALK_FUNCTIONS) {
    if (!new RegExp(`\\b${fn}\\b`).test(code)) continue
    // Another name for it: an import or export alias, or a destructured rename.
    if (new RegExp(`\\b${fn}\\s+as\\s+[A-Za-z_$]`).test(code)) offences.push(`${rel}: ${fn} under another name (as)`)
    if (new RegExp(`\\b${fn}\\s*:\\s*[A-Za-z_$]`).test(code)) offences.push(`${rel}: ${fn} destructured under another name`)
    // Every other mention, outside the import and export lists, must be a call.
    const outsideLists = code.replace(/\b(?:import|export)\s+(?:type\s+)?\{[^}]*\}(?:\s*from\s*["'][^"']+["'])?/g, "")
    const asValue = new RegExp(`\\b${fn}\\b(?!\\s*\\()`, "g")
    if (asValue.test(outsideLists)) offences.push(`${rel}: ${fn} used as a value (stored or passed, not called)`)
    for (const call of callsOf(code, fn)) {
      if (!callKeepsItsRow(fn, call)) offences.push(`${rel}: ${call.replace(/\s+/g, " ").slice(0, 160)}`)
    }
  }
  return offences
}

const FILES = SOURCE_DIRS.flatMap((d) => productFiles(join(ROOT, d))).map((path) => ({ rel: relative(ROOT, path), code: readFileSync(path, "utf8") }))

describe("the measured walk is read with a slack only through a measuring step's row", () => {
  it("scans the product code (backend, frontend, render-rules)", () => {
    expect(FILES.length).toBeGreaterThan(500)
    expect(FILES.some((f) => f.rel === "backend/src/ee/billing/credits.ts")).toBe(true)
    expect(FILES.some((f) => f.rel === "frontend/src/lib/video-utility-estimate.ts")).toBe(true)
  })

  it("no product file but the walk and the table names the slack option", () => {
    const naming = FILES.filter((f) => !WALK_MODULES.has(f.rel) && /\bplannedClipSlackSec\b/.test(f.code)).map((f) => f.rel)
    expect(naming).toEqual([])
  })

  it("every read of the walk is a call by name that reads only what the graph knows, or spreads its step's row last", () => {
    const calls = FILES.reduce((n, f) => n + (f.rel === WALK_MODULE ? 0 : callsOf(withoutComments(f.code), "measuredWireLengthSec").length), 0)
    expect(calls).toBeGreaterThanOrEqual(4)
    expect(FILES.flatMap((f) => walkReadOffences(f.rel, f.code))).toEqual([])
  })
})

describe("the rule catches each way past a step's row", () => {
  const F = "backend/src/lib/new-step.ts"
  const IMPORT = `import { measuredWireLengthSec, measuringStepReadOptions } from "@nodaro/render-rules"\n`

  it.each([
    ["its own slack", `${IMPORT}measuredWireLengthSec(s, n, e, r, { plannedClipSlackSec: 0.1 })`],
    ["no slack at all", `${IMPORT}measuredWireLengthSec(s, n, e, r, {})`],
    ["a row, then an override", `${IMPORT}measuredWireLengthSec(s, n, e, r, { ...measuringStepReadOptions("dubbing"), reading: "video-stream" })`],
    ["plannedVideoLengthSec with no row", `import { plannedVideoLengthSec } from "@nodaro/render-rules"\nplannedVideoLengthSec(origin, sec, nodes, edges, { reading: "video-stream" })`],
    ["an aliased import", `import { measuredWireLengthSec as walk, measuringStepReadOptions } from "@nodaro/render-rules"\nwalk(s, n, e, r, {})`],
    ["an aliased re-export", `export { plannedVideoLengthSec as plan } from "./measured-wire-length"`],
    ["a value stored under another name", `${IMPORT}const walk = measuredWireLengthSec\nwalk(s, n, e, r, {})`],
    ["a value passed on", `${IMPORT}readWith(measuredWireLengthSec)`],
    ["a destructured rename", `const { measuredWireLengthSec: walk } = await import("@nodaro/render-rules")\nwalk(s, n, e, r, {})`],
    ["a namespace call with no row", `import * as rr from "@nodaro/render-rules"\nrr.plannedVideoLengthSec(origin, sec, nodes, edges)`],
  ])("%s is an offence", (_name, code) => {
    expect(walkReadOffences(F, code).length).toBeGreaterThan(0)
  })

  it.each([
    ["the step's row, last", `${IMPORT}measuredWireLengthSec(s, n, e, r, { openSourceIds, ...extra, ...measuringStepReadOptions("dubbing") })`],
    ["what the graph knows", `${IMPORT}measuredWireLengthSec(s, n, e, r, { knownOnly: true })`],
    ["plannedVideoLengthSec with the step's row", `import { plannedVideoLengthSec, measuringStepReadOptions } from "@nodaro/render-rules"\nplannedVideoLengthSec(o, sec, n, e, { ...measuringStepReadOptions("video-overlay") })`],
    ["a plain re-export", `export { measuredWireLengthSec, plannedVideoLengthSec } from "./measured-wire-length"`],
    ["a name in a comment", `/** read through \`measuredWireLengthSec\` */\n// measuredWireLengthSec(s, n, e, r, {})\nexport const x = 1`],
  ])("%s is not", (_name, code) => {
    expect(walkReadOffences(F, code)).toEqual([])
  })
})
