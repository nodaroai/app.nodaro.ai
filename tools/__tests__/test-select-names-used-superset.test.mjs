// tools/__tests__/test-select-names-used-superset.test.mjs
// namesUsed (tools/test-select/registry.mjs) decides which tests and modules
// G4 asks to declare and which modules the registry rule counts as
// enumerators. A name it stops finding narrows selection silently, so over
// every tracked source file it must find at least every registry name the
// reader before the balanced-pattern rewrite found (frozen below).
// @test-always walks every tracked file with git ls-files
import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { collectRegistries, namesUsed } from "../test-select/registry.mjs"

const root = new URL("../../", import.meta.url)
const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8", maxBuffer: 64 << 20 }).split("\n").filter(Boolean)
const read = (f) => readFileSync(new URL(f, root), "utf8")
const SOURCE = /^(?:frontend|backend|packages|tools)\/.*\.[cm]?[jt]sx?$/
const SKIP = /(?:^|\/)(?:node_modules|dist)\//
const files = tracked.filter((f) => SOURCE.test(f) && !SKIP.test(f))

const escape = (s) => s.replace(/[$]/g, "\\$")
const UPPER = /^[A-Z][A-Z0-9_]*$/

/** The reader as it was before the balanced-pattern rewrite — frozen; never edit. */
function legacyNamesUsed(source, names) {
  const used = new Set()
  if (!source || names.size === 0) return used
  const bound = new Set()
  const take = (list) => {
    for (const part of list.split(",")) {
      const p = part.trim().replace(/^type\s+/, "\0")
      if (!p || p.startsWith("\0")) continue
      const original = p.split(/\s+as\s+/)[0].split(":")[0].trim()
      bound.add(original)
    }
  }
  for (const m of source.matchAll(/\bimport\s+(?!type\b)(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from\b/g)) take(m[1])
  for (const m of source.matchAll(/\bexport\s+(?!type\b)\{([^}]*)\}\s*from\b/g)) take(m[1])
  for (const m of source.matchAll(/\{([^}]*)\}\s*=\s*(?:await\s+)?(?:import|vi\.importActual)\b/g)) take(m[1])
  const namespaces = new Set()
  for (const m of source.matchAll(/\bimport\s+\*\s+as\s+([\w$]+)\s+from\b/g)) namespaces.add(m[1])
  for (const m of source.matchAll(/\b(?:const|let|var)\s+([\w$]+)\s*(?::[^=]+)?=\s*(?:await\s+)?(?:import\s*\(|vi\.importActual\b|vi\.importMock\b|importOriginal\b)/g)) namespaces.add(m[1])
  for (const m of source.matchAll(/\bimport\s*\([^)]*\)\s*\.then\(\s*(?:\(\s*)?([\w$]+)\s*\)?\s*=>/g)) namespaces.add(m[1])
  for (const m of source.matchAll(/\bimport\s*\([^)]*\)\s*\.then\(\s*\(\s*\{([^}]*)\}\s*\)\s*=>/g)) take(m[1])
  for (const m of source.matchAll(/\(\s*await\s+(?:import|importOriginal|vi\.importActual|vi\.importMock)\s*(?:<[^>]*>)?\s*\([^)]*\)\s*\)\s*\.\s*([\w$]+)/g)) bound.add(m[1])
  for (const n of names) {
    if (bound.has(n)) used.add(n)
    else if (UPPER.test(n) && new RegExp(`\\.${escape(n)}\\b`).test(source)) used.add(n)
    else if ([...namespaces].some((ns) => new RegExp(`\\b${escape(ns)}\\??\\.${escape(n)}\\b`).test(source))) used.add(n)
  }
  return used
}

test("namesUsed finds at least every registry name the legacy reader found, in every tracked source file", () => {
  const composers = JSON.parse(read("tools/units/registry-composers.json")).composers
  const declaring = files.filter((f) => /^(frontend|backend)\//.test(f)).map((path) => ({ path, source: read(path) })).filter((f) => f.source.includes("@registry-exports"))
  const names = new Set([...collectRegistries(declaring, composers).exportsById.values()].flatMap((s) => [...s]))
  assert.ok(names.size > 10, "the registry names are known (an empty set would make this vacuous)")
  const lost = []
  for (const f of files) {
    const src = read(f)
    const now = namesUsed(src, names)
    const missing = [...legacyNamesUsed(src, names)].filter((n) => !now.has(n))
    if (missing.length) lost.push(`${f}: ${missing.join(" ")}`)
  }
  assert.deepEqual(lost, [], "namesUsed lost names the legacy reader found — a silent narrowing of G4 and the registry rule")
})

test("the legacy floor on fixtures: the reader never reports fewer names than the legacy reader", () => {
  const names = new Set(["STATIC_CREDIT_COSTS", "nodeTypes", "getNodeOptions"])
  const shapes = [
    'const {\n  STATIC_CREDIT_COSTS, // 1) legacy rows\n} = await import("x")\n',
    'const {\n  STATIC_CREDIT_COSTS, // :)\n} = await import("x")\n',
    'const { nodeTypes, getNodeOptions = ")" } = await import("x")\n',
    'const { nodeTypes, getNodeOptions = "[" } = await import("x")\n',
    'const { nodeTypes, getNodeOptions: g = /\\[/ } = await import("x")\n',
    'import("x").then(({\n  nodeTypes, // 1) a\n}) => 1)\n',
    'import("x").then(({ nodeTypes, getNodeOptions = "(" }) => 1)\n',
  ]
  for (const src of shapes) {
    const now = namesUsed(src, names)
    for (const n of legacyNamesUsed(src, names)) assert.ok(now.has(n), `${JSON.stringify(src)} lost ${n}`)
  }
})
