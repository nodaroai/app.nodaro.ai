#!/usr/bin/env node
// `npm run typecheck` — type-checks every project CI type-checks, all at once.
//
// Two compilers live in this repo on purpose (decided 2026-10-13):
//   - TypeScript 7 (the native Go compiler, ~6x faster here) is the
//     TYPE-CHECKER. It sits in its own workspace, tools/typescript-native, so
//     its `tsc` bin is linked only into tools/typescript-native/node_modules/.bin
//     and never into the root node_modules/.bin.
//   - TypeScript 5.9 stays `typescript` at the root: every build that EMITS
//     (backend tsconfig.build.json, the Dockerfile, packages/remotion) and every
//     tool that uses the TypeScript JS API (guard tests, ts-morph in gen-skills,
//     typescript-eslint, tsup dts) keeps running it. TS 7.0 has no stable JS API.
// `npm run typecheck:ts5` runs the same projects on 5.9, for comparison.
//
// Compilers are resolved from their package directories, never through
// `npx`/.bin, and their major version is asserted before anything runs. The
// root `.bin/tsc` is asserted to be 5.9 too: the first attempt (an npm alias of
// typescript@7 at the root) silently re-pointed it at 7 on an incremental
// `npm install`, which would have switched every emitting build to TS 7.
//
// Usage: node tools/typecheck-all.mjs [--ts5] [--serial] [project...] [-- <tsc args>]
//   project   any of PROJECTS (default: all); --serial runs one at a time
//             (for timing); args after `--` go to every tsc invocation.
import { spawn } from "node:child_process"
import { existsSync, readFileSync, realpathSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")

/** The projects CI type-checks (the Type Check job). Paths are repo-relative. */
export const PROJECTS = ["frontend", "backend", "packages/cli", "packages/shared"]

/** 5.9's tsc runs in Node; frontend needs more than the default ~4 GB heap. */
const TS5_HEAP_MB = 6144

/**
 * TS 7 must never check a project against MORE lib declarations than 5.9 does:
 * builds and the frontend bundle are still made with 5.9, and nothing else in
 * CI type-checks the frontend on 5.9. frontend/tsconfig.json says
 * `lib: ["dom", "dom.iterable", "esnext"]`, and TS 7's `esnext` is wider than
 * 5.9's (es2025.regexp/intl, esnext.temporal/date/typedarrays, a newer
 * collection lib): `Temporal.Now.instant()`, `RegExp.escape`,
 * `Uint8Array#toBase64`, `Map#getOrInsert` and `Intl.DurationFormat` would pass
 * on 7 and fail on 5.9. So TS 7 gets 5.9's `esnext` content spelled out under
 * TS 7's lib names. Backend (default lib for ES2022), packages/cli and
 * packages/shared resolve the same lib files on both (renames aside), so they
 * need no override. If frontend/tsconfig.json's `lib` changes, this list must
 * be revisited: the script refuses to run until it is.
 */
export const FRONTEND_TSCONFIG_LIB = ["dom", "dom.iterable", "esnext"]
export const FRONTEND_TS7_LIB = [
  "dom", "dom.iterable", "es2024", "es2025.collection", "es2025.float16", "es2025.iterator",
  "es2025.promise", "esnext.array", "esnext.decorators", "esnext.disposable", "esnext.error",
  "esnext.sharedmemory",
]

/** Extra args TS 7 (never 5.9) gets per project. */
export const TS7_PROJECT_ARGS = { frontend: ["--lib", FRONTEND_TS7_LIB.join(",")] }

/** Throws if frontend/tsconfig.json's `lib` no longer matches what FRONTEND_TS7_LIB mirrors. */
export function assertFrontendLibUnchanged(tsconfigText) {
  const lib = JSON.parse(tsconfigText).compilerOptions?.lib
  if (JSON.stringify(lib) !== JSON.stringify(FRONTEND_TSCONFIG_LIB)) {
    throw new Error(
      `frontend/tsconfig.json lib is ${JSON.stringify(lib)}, but tools/typecheck-all.mjs pins TS 7 to 5.9's ` +
        `content of ${JSON.stringify(FRONTEND_TSCONFIG_LIB)} — update FRONTEND_TS7_LIB to match the new lib on 5.9`,
    )
  }
}

export function parseArgs(argv) {
  const opts = { ts5: false, serial: false, projects: [], passthrough: [] }
  const dash = argv.indexOf("--")
  const own = dash === -1 ? argv : argv.slice(0, dash)
  if (dash !== -1) opts.passthrough = argv.slice(dash + 1)
  for (const arg of own) {
    if (arg === "--ts5") opts.ts5 = true
    else if (arg === "--serial") opts.serial = true
    else if (arg.startsWith("-")) throw new Error(`unknown option ${arg}`)
    else if (!PROJECTS.includes(arg)) throw new Error(`unknown project ${arg} (one of: ${PROJECTS.join(", ")})`)
    else opts.projects.push(arg)
  }
  if (opts.projects.length === 0) opts.projects = [...PROJECTS]
  return opts
}

/** Throws unless `version` is the expected TypeScript major. */
export function assertMajor(version, major, where) {
  if (Number.parseInt(String(version).split(".")[0], 10) !== major) {
    throw new Error(`expected TypeScript ${major}.x at ${where}, found ${version}`)
  }
}

function packageDir(fromPackageJson, name) {
  return dirname(createRequire(fromPackageJson).resolve(`${name}/package.json`))
}

function versionOf(dir) {
  return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version
}

/** The compiler a mode runs: `{ label, version, command, args }`. */
export function resolveCompiler(ts5) {
  if (ts5) {
    const dir = packageDir(join(ROOT, "package.json"), "typescript")
    const version = versionOf(dir)
    assertMajor(version, 5, relative(ROOT, dir))
    return {
      label: `TypeScript ${version}`,
      version,
      command: process.execPath,
      args: [`--max-old-space-size=${TS5_HEAP_MB}`, join(dir, "lib", "tsc.js")],
    }
  }
  const dir = packageDir(join(ROOT, "tools", "typescript-native", "package.json"), "typescript")
  const version = versionOf(dir)
  assertMajor(version, 7, relative(ROOT, dir))
  // bin/tsc is a small Node launcher that finds the platform binary
  // (@typescript/typescript-<platform>-<arch>) and execve()s into it.
  // `--incremental false`: frontend sets `incremental`, and 5.9's
  // tsconfig.tsbuildinfo must never be read or rewritten by another compiler.
  return {
    label: `TypeScript ${version} (native)`,
    version,
    projectArgs: TS7_PROJECT_ARGS,
    command: process.execPath,
    args: [join(dir, "bin", "tsc"), "--incremental", "false"],
  }
}

/** Guard: the root `.bin/tsc` (what `npx tsc` and npm scripts run) is 5.x. */
export function assertRootTscIsTs5() {
  const link = join(ROOT, "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc")
  if (!existsSync(link) || process.platform === "win32") return
  const target = realpathSync(link)
  const pkgDir = resolve(dirname(target), "..")
  const version = versionOf(pkgDir)
  assertMajor(version, 5, `node_modules/.bin/tsc (-> ${relative(ROOT, target)})`)
}

/** The full argument list one project's check runs with. */
export function tscArgs(compiler, project, passthrough = []) {
  return [...compiler.args, "--noEmit", ...(compiler.projectArgs?.[project] ?? []), ...passthrough]
}

/** Prefixes each complete line of a stream with `[project] `. */
function pipePrefixed(stream, prefix, out) {
  let pending = ""
  stream.setEncoding("utf8")
  stream.on("data", (chunk) => {
    const lines = (pending + chunk).split("\n")
    pending = lines.pop()
    for (const line of lines) out.write(`${prefix}${line}\n`)
  })
  stream.on("end", () => {
    if (pending) out.write(`${prefix}${pending}\n`)
  })
}

function runOne(project, compiler, passthrough, width) {
  const prefix = `[${project.padEnd(width)}] `
  const started = performance.now()
  return new Promise((done) => {
    const child = spawn(compiler.command, tscArgs(compiler, project, passthrough), {
      cwd: join(ROOT, project),
      stdio: ["ignore", "pipe", "pipe"],
    })
    pipePrefixed(child.stdout, prefix, process.stdout)
    pipePrefixed(child.stderr, prefix, process.stderr)
    const finish = (code, signal, error) => {
      const seconds = (performance.now() - started) / 1000
      done({ project, ok: code === 0 && !signal && !error, code, signal, error, seconds })
    }
    child.on("error", (error) => finish(null, null, error))
    child.on("close", (code, signal) => finish(code, signal, null))
  })
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  assertRootTscIsTs5()
  assertFrontendLibUnchanged(readFileSync(join(ROOT, "frontend", "tsconfig.json"), "utf8"))
  const compiler = resolveCompiler(opts.ts5)
  const width = Math.max(...opts.projects.map((p) => p.length))
  console.log(`typecheck: ${compiler.label} — ${opts.projects.join(", ")}${opts.serial ? " (serial)" : ""}`)
  const started = performance.now()
  const results = []
  if (opts.serial) {
    for (const p of opts.projects) results.push(await runOne(p, compiler, opts.passthrough, width))
  } else {
    results.push(...(await Promise.all(opts.projects.map((p) => runOne(p, compiler, opts.passthrough, width)))))
  }
  const total = (performance.now() - started) / 1000
  console.log(`\ntypecheck summary (${compiler.label}):`)
  for (const r of results) {
    const status = r.ok ? "ok" : r.error ? `FAILED (${r.error.message})` : r.signal ? `FAILED (signal ${r.signal})` : `FAILED (exit ${r.code})`
    console.log(`  ${r.project.padEnd(width)}  ${status.padEnd(18)} ${r.seconds.toFixed(1)}s`)
  }
  console.log(`  ${"total".padEnd(width)}  ${"".padEnd(18)} ${total.toFixed(1)}s wall`)
  if (results.some((r) => !r.ok)) process.exitCode = 1
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`typecheck: ${error.message}`)
    process.exitCode = 1
  })
}
