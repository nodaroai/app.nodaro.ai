import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import {
  FRONTEND_TS7_LIB, FRONTEND_TSCONFIG_LIB, PROJECTS, TS7_PROJECT_ARGS,
  assertFrontendLibUnchanged, assertMajor, parseArgs, tscArgs,
} from "../typecheck-all.mjs"

test("defaults to every project CI type-checks, on TypeScript 7", () => {
  assert.deepEqual(parseArgs([]), { ts5: false, serial: false, projects: PROJECTS, passthrough: [] })
  assert.deepEqual(PROJECTS, ["frontend", "backend", "packages/cli", "packages/shared"])
})

test("selects projects and modes, forwards args after --", () => {
  const opts = parseArgs(["--ts5", "--serial", "backend", "--", "--listFilesOnly"])
  assert.equal(opts.ts5, true)
  assert.equal(opts.serial, true)
  assert.deepEqual(opts.projects, ["backend"])
  assert.deepEqual(opts.passthrough, ["--listFilesOnly"])
})

test("rejects unknown projects and options instead of checking less", () => {
  assert.throws(() => parseArgs(["packages/clii"]), /unknown project/)
  assert.throws(() => parseArgs(["--strict"]), /unknown option/)
})

test("a compiler of the wrong major version is refused", () => {
  assert.doesNotThrow(() => assertMajor("7.0.2", 7, "x"))
  assert.doesNotThrow(() => assertMajor("5.9.3", 5, "x"))
  assert.throws(() => assertMajor("5.9.3", 7, "x"), /expected TypeScript 7\.x/)
  assert.throws(() => assertMajor("7.0.2", 5, "x"), /expected TypeScript 5\.x/)
})

test("TypeScript 7 stays out of the root: only its own workspace declares it", () => {
  const root = JSON.parse(readFileSync("package.json", "utf8"))
  const native = JSON.parse(readFileSync("tools/typescript-native/package.json", "utf8"))
  assert.match(root.devDependencies.typescript, /^5\./, "root typescript (builds + API users) is 5.x")
  assert.ok(root.workspaces.includes("tools/typescript-native"))
  assert.match(native.devDependencies.typescript, /^7\./)
  for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
    for (const [name, spec] of Object.entries(root[field] ?? {})) {
      assert.doesNotMatch(String(spec), /typescript@7|^7\./, `root ${field}.${name} would link TS 7's tsc into node_modules/.bin`)
    }
  }
  assert.equal(root.scripts.typecheck, "node tools/typecheck-all.mjs")
  assert.equal(root.scripts["typecheck:ts5"], "node tools/typecheck-all.mjs --ts5")
})

test("TS 7 checks the frontend against 5.9's lib, never TS 7's wider esnext", () => {
  // frontend/tsconfig.json still says exactly this; a change must revisit FRONTEND_TS7_LIB.
  const tsconfig = readFileSync("frontend/tsconfig.json", "utf8")
  assert.deepEqual(JSON.parse(tsconfig).compilerOptions.lib, ["dom", "dom.iterable", "esnext"])
  assert.deepEqual(FRONTEND_TSCONFIG_LIB, ["dom", "dom.iterable", "esnext"])
  assert.doesNotThrow(() => assertFrontendLibUnchanged(tsconfig))
  const changed = JSON.stringify({ compilerOptions: { lib: ["dom", "dom.iterable", "es2024"] } })
  assert.throws(() => assertFrontendLibUnchanged(changed), /update FRONTEND_TS7_LIB/)
  // Nothing beyond 5.9's esnext content (Temporal, RegExp.escape, toBase64, getOrInsert, DurationFormat).
  for (const wider of ["esnext", "es2025", "es2025.regexp", "es2025.intl", "esnext.date", "esnext.temporal",
    "esnext.typedarrays", "esnext.collection"]) assert.ok(!FRONTEND_TS7_LIB.includes(wider), wider)
})

test("the frontend lib override is applied to TS 7 only, and to the frontend only", () => {
  const ts7 = { args: ["tsc"], projectArgs: TS7_PROJECT_ARGS }
  const ts5 = { args: ["tsc.js"] }
  assert.deepEqual(tscArgs(ts7, "frontend"), ["tsc", "--noEmit", "--lib", FRONTEND_TS7_LIB.join(",")])
  assert.deepEqual(tscArgs(ts7, "backend", ["--listFilesOnly"]), ["tsc", "--noEmit", "--listFilesOnly"])
  assert.deepEqual(tscArgs(ts5, "frontend"), ["tsc.js", "--noEmit"])
})
