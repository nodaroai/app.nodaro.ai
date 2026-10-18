#!/usr/bin/env node
// tools/test-dedup/parity-filter.mjs
// Which of the cross-tree parity tests Type Check re-runs (ci.yml →
// cross_tree_parity). The parity grep discovers every backend test that names
// a frontend path; each of them also runs in Backend Tests. A frontend-only
// PR skips Backend Tests, so the re-run exists for the tests a frontend change
// can break. A test that reads no file at run time and whose module graph
// reaches nothing under frontend/ cannot change result on a frontend-only
// change: the grep matched a `frontend/` string only (a comment, a message,
// an `import type` erased before Vitest runs). The re-run skips exactly those
// — section (d)'s `neither` category — and keeps everything else, a category
// nobody has thought of yet included.
//
// It classifies with the report's own classifier (cross-tree.mjs), over a
// graph-shaped entry built here statically: Type Check cannot afford Vitest's
// graph (~140 s on its 2 vCPU, more than the re-run it saves). The walk errs
// towards keeping a test: only whole-line comments are stripped, an inline
// `{ type X }` import counts as a runtime import, a dynamic `import()` /
// `require()` of anything but a string literal anywhere on the walk keeps the
// test, and so does a child process (other than git) the test starts. report.mjs
// checks this static `neither` set against Vitest's graph and fails if they
// differ; backend/src/__tests__/cross-tree-selection-guard.test.ts fails a
// skipped test that starts reaching the other tree. Pure apart from main();
// Node built-ins only (the tools self-tests run with no npm install).
//
//   cd backend && node ../tools/test-dedup/parity-filter.mjs --out <list> <files…>
//   (file arguments relative to the working directory; the list written is too)
// @reads backend/** tools/** packages/*/src/**
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { isScanner, parseAnnotations, parseReads } from "../test-select/annotations.mjs"
import { isTestSideHelper, undeclaredTestReader } from "../test-select/test-node.mjs"
import { classifyCrossTree } from "./cross-tree.mjs"

const OTHER_TREE = "frontend/"
// The other tree is also an npm workspace: `npm ci` links
// node_modules/<its name> → ../frontend, so a bare `<name>/…` specifier loads it.
const otherTreeName = (read) => {
  const manifest = read(`${OTHER_TREE}package.json`)
  if (manifest === null) throw new Error(`parity-filter: ${OTHER_TREE}package.json not found — cannot tell its workspace name`)
  return JSON.parse(manifest).name
}

// Comments, only where one starts a line: a `//` line or a block comment
// opening at a line start. A comment after code stays (and can only keep a
// test); stripping one that a string merely looks like (`" // "`, a
// `"src/**/*.ts"` glob) could hide an import after it on the same line.
const stripComments = (source) => source.replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, "").replace(/^[ \t]*\/\/[^\n]*/gm, "")
// Type-only imports and re-exports are erased before Vitest runs.
const TYPE_ONLY = /\b(?:import|export)\s+type\s+(?:\{[^}]*\}|[\w$]+|\*\s+as\s+[\w$]+)\s+from\s*(["'])[^"'\n]+\1/g
// Every module specifier: `from "x"`, `import "x"`, `import("x")`, `require("x")`,
// `vi.importActual("x")` / `vi.importMock("x")` / `vi.mock("x")`, generic or not.
const SPECIFIER = /(?:\bfrom|\bimport|\brequire|\bimportActual|\bimportMock|\bmock|\bdoMock)\s*(?:<[^>()]*>)?\s*\(?\s*(["'`])([^"'`$\n]+)\1/g
// A dynamic import or require whose argument is not a plain string literal.
// (The lookahead holds the whitespace itself: `\(\s*(?!…)` would backtrack
// over it and call a literal on the next line computed.)
const COMPUTED = /\b(?:import|require|importActual|importMock)\s*(?:<[^>()]*>)?\s*\((?!\s*["'`][^"'`$\n]*["'`]\s*[,)])/g
// A child process other than git (git is a read, isScanner's): the command
// can read anything (`execFileSync("npx", ["tsx", script])`). `exec` counts
// only as a bare call — `re.exec(…)` is a RegExp.
export const RUNS_COMMAND = /(?:\b(?:execSync|execFile|execFileSync|spawn|spawnSync|fork|execa|execaSync|execaNode)|(?<![.\w$])exec)\s*\((?!\s*["'`]git["'`\s])/

const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs", ".json"]

// The repo-relative file a specifier names (or the path it would name, for a
// file of the other tree that need not exist), or null for a package.
function resolveSpecifier(importer, spec, exists, treeName) {
  const bare = spec.replace(/[?#].*$/, "")
  let base
  if (bare.startsWith("./") || bare.startsWith("../") || bare === "." || bare === "..") base = path.posix.normalize(path.posix.join(path.posix.dirname(importer), bare))
  else if (bare.startsWith("@/")) base = path.posix.join(`${importer.split("/")[0]}/src`, bare.slice(2))
  else if (bare === treeName || bare.startsWith(`${treeName}/`)) return `${OTHER_TREE}${bare.slice(treeName.length + 1)}`
  else return null
  if (base.startsWith(OTHER_TREE)) return base
  if (base === OTHER_TREE.slice(0, -1)) return OTHER_TREE
  const stem = base.replace(/\.(?:[cm]?js|jsx)$/, "")
  const candidates = [base, ...EXTENSIONS.map((e) => `${stem}${e}`), ...EXTENSIONS.map((e) => `${base}/index${e}`)]
  return candidates.find(exists) ?? null
}

// The static graph-shaped entry of one test (the fields classifyCrossTree and
// test-node.mjs's summarizeTest use). read(p) → source or null.
export function staticEntry(file, read) {
  const source = read(file) ?? ""
  const exists = (p) => read(p) !== null
  const treeName = otherTreeName(read)
  const own = parseAnnotations(source)
  const declaresOwnReads = own.watches.length > 0 || own.always !== null || own.readsNone !== null
  const watches = [...own.watches]
  let always = own.always
  let scanner = isScanner(source) && !own.always && !own.readsNone && own.watches.length === 0
  const reads = []
  let undeclaredReader = null
  let computedImport = false
  let runsCommand = false
  const deps = []
  const seen = new Set([file])
  const queue = [file]
  while (queue.length > 0) {
    const at = queue.shift()
    const text = at === file ? source : read(at)
    if (text === null) continue
    if (at !== file) {
      if (isTestSideHelper(at)) {
        const a = parseAnnotations(text)
        watches.push(...a.watches)
        always ??= a.always
        if (undeclaredTestReader(at, text, a)) scanner = true
        if (a.forCaller && !declaresOwnReads) scanner = true
      } else {
        const r = parseReads(text)
        reads.push(...r.reads)
        if (!undeclaredReader && isScanner(text) && r.reads.length === 0 && !r.readsNone) undeclaredReader = at
      }
    }
    const code = stripComments(text).replace(TYPE_ONLY, "")
    // A computed path anywhere on the walk (a product module included) may lead
    // into the other tree; a child process only counts in the test's own code.
    computedImport ||= COMPUTED.test(code)
    COMPUTED.lastIndex = 0
    if (at === file || isTestSideHelper(at)) runsCommand ||= RUNS_COMMAND.test(code)
    for (const m of code.matchAll(SPECIFIER)) {
      const target = resolveSpecifier(at, m[2], exists, treeName)
      if (!target || seen.has(target)) continue
      seen.add(target)
      deps.push(target)
      if (!target.startsWith(OTHER_TREE)) queue.push(target)
    }
  }
  return { file, deps, watches, always, scanner, reads, undeclaredReader, computedImport, runsCommand }
}

// The parity re-run: { run, skipped, classified } over repo-relative files.
export function parityRun(discovered, read) {
  const classified = classifyCrossTree(discovered, discovered.map((f) => staticEntry(f, read)))
  return {
    run: classified.filter((c) => c.category !== "neither").map((c) => c.file),
    skipped: classified.filter((c) => c.category === "neither").map((c) => c.file),
    classified,
  }
}

function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
  const { values: o, positionals } = parseArgs({ options: { out: { type: "string" } }, allowPositionals: true })
  if (!o.out || positionals.length === 0) {
    process.stderr.write("usage: parity-filter.mjs --out <list> <test files…>\n")
    process.exit(2)
  }
  const cache = new Map()
  const read = (p) => {
    if (!cache.has(p)) { try { cache.set(p, readFileSync(path.join(repoRoot, p), "utf8")) } catch { cache.set(p, null) } }
    return cache.get(p)
  }
  const prefix = path.relative(repoRoot, process.cwd()).split(path.sep).join("/")
  const toRepo = (f) => path.posix.join(prefix, f)
  const fromRepo = (f) => path.posix.relative(prefix || ".", f)
  const discovered = positionals.map(toRepo)
  const missing = discovered.filter((f) => read(f) === null)
  if (missing.length) throw new Error(`parity-filter: not found: ${missing.join(", ")}`)
  const { run, skipped } = parityRun(discovered, read)
  writeFileSync(o.out, run.map((f) => `${fromRepo(f)}\n`).join(""))
  process.stderr.write(`Skipped ${skipped.length} of ${discovered.length} (they read no frontend file and load no frontend module; Backend Tests runs them):\n${skipped.map((f) => `  ${fromRepo(f)}\n`).join("")}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
