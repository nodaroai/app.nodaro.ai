// tools/test-select/package-chunks.mjs
// Which built files of a workspace package a changed source file ends up in.
// Tests load a package through its build (packages/<name>/dist/…), so the graph
// sees dist files, never src. tsup (esbuild) writes, with `metafile: true`,
// dist/metafile-<format>.json: every output file and the inputs bundled into
// it, and every input and the inputs it imports. With that, a src change
// selects only the tests that load an output it can reach; without it (or with
// any doubt about it) select.mjs keeps the whole-package rule.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"

const FORMATS = ["esm", "cjs"]
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v)
// An import esbuild left external is safe to ignore only when it names a
// package: a bare name (`react`, `@nodaro/shared`, `lodash/fp`) or a `node:`
// builtin. Anything else — `./x`, `../x`, `/abs`, `#internal`, `~/x`, `@/x` —
// may be a file of this package that esbuild did not follow (tsup's treeshake
// records an unused relative import as `{ path: "./x", external: true }`), so
// what it brings in is unknown.
const PACKAGE_SPECIFIER = /^(?:node:.+|@[a-z0-9][\w.-]*\/[\w.-][^\s]*|[a-z0-9][\w.-]*(?:\/[^\s]*)?)$/i

// Pure. `metafiles`: the parsed metafiles of ONE package's build (esm, cjs —
// merged). Keys are relative to the directory tsup ran in: the package
// directory under `npm -w`. A key from anywhere else normalizes to a path no
// test loads, and no change resolves to it — the whole-package rule again.
// Returns null — the whole-package rule — when anything is not the shape
// esbuild writes, or when the input graph cannot be trusted (below).
//
// An output's own `inputs` list is esbuild's byte attribution: a module that
// contributes no bytes to an output is not in it, although changing it can
// change that output — a TS enum inlined at its use sites, or a module
// tree-shaken out of one output and kept in another. So a change is also
// followed through the INPUT graph (`metafile.inputs[*].imports`), which
// records the edge whether or not bytes came along.
export function chunkMapFromMetafiles(pkgDir, metafiles) {
  if (!Array.isArray(metafiles) || metafiles.length === 0) return null
  const at = (key) => path.posix.normalize(path.posix.join(pkgDir, key))
  const outputs = new Set()
  const byInput = new Map() // input → outputs it is bundled into
  const importers = new Map() // output → outputs that import it (statically or not)
  const inputImporters = new Map() // input → inputs that import it
  const add = (map, key, value) => map.set(key, (map.get(key) ?? new Set()).add(value))
  for (const meta of metafiles) {
    if (!isObject(meta) || !isObject(meta.outputs) || !isObject(meta.inputs)) return null
    for (const [key, input] of Object.entries(meta.inputs)) {
      if (!isObject(input) || !Array.isArray(input.imports)) return null
      for (const imp of input.imports) {
        if (!isObject(imp) || typeof imp.path !== "string") return null
        if (imp.external) {
          // a file of this package esbuild did not follow: what it reaches is unknown
          if (!PACKAGE_SPECIFIER.test(imp.path)) return null
          continue
        }
        // an edge to a file the metafile does not describe: its imports are unknown
        if (!Object.hasOwn(meta.inputs, imp.path)) return null
        add(inputImporters, at(imp.path), at(key))
      }
    }
    for (const [key, output] of Object.entries(meta.outputs)) {
      if (!isObject(output) || !isObject(output.inputs)) return null
      if (output.imports !== undefined && !Array.isArray(output.imports)) return null
      const out = at(key)
      outputs.add(out)
      for (const input of Object.keys(output.inputs)) {
        if (!Object.hasOwn(meta.inputs, input)) return null
        add(byInput, at(input), out)
      }
      for (const imp of output.imports ?? []) {
        if (!isObject(imp) || typeof imp.path !== "string") return null
        if (!imp.external) add(importers, at(imp.path), out)
      }
    }
  }
  return { outputs, byInput, importers, inputImporters }
}

// Pure. The outputs a change to `file` reaches: those built from it or from
// any input that (transitively) imports it — its bytes may be inlined there
// with no entry of its own — and, transitively, every output importing one of
// those, so a test is selected through the entry it loads even if the graph
// did not list the chunk. Returns null when no output is reached (a new file,
// a type-only module, one nothing bundled).
export function outputsBuiltFrom(chunkMap, file) {
  // a map without the input graph cannot see inlined inputs: never narrow on it
  if (!(chunkMap.inputImporters instanceof Map)) return null
  const inputs = new Set([file])
  const pending = [file]
  while (pending.length > 0) {
    for (const importer of chunkMap.inputImporters.get(pending.shift()) ?? []) {
      if (!inputs.has(importer)) {
        inputs.add(importer)
        pending.push(importer)
      }
    }
  }
  const reached = new Set()
  for (const input of inputs) for (const out of chunkMap.byInput.get(input) ?? []) reached.add(out)
  if (reached.size === 0) return null
  const queue = [...reached]
  while (queue.length > 0) {
    for (const importer of chunkMap.importers.get(queue.shift()) ?? []) {
      if (!reached.has(importer)) {
        reached.add(importer)
        queue.push(importer)
      }
    }
  }
  return reached
}

// Reads packages/*/dist/metafile-{esm,cjs}.json. Returns { "packages/<name>/":
// chunkMap } for the packages whose metafiles can be trusted; a package left
// out is judged by the whole-package rule. Never throws for one package.
export function loadPackageChunks(repoRoot) {
  const result = {}
  const packagesDir = path.join(repoRoot, "packages")
  for (const name of existsSync(packagesDir) ? readdirSync(packagesDir) : []) {
    try {
      const map = loadOne(path.join(packagesDir, name), `packages/${name}`)
      if (map) result[`packages/${name}/`] = map
    } catch {
      // unreadable or inconsistent: the whole-package rule decides
    }
  }
  return result
}

function loadOne(absDir, pkgDir) {
  const files = FORMATS.map((f) => path.join(absDir, "dist", `metafile-${f}.json`)).filter((f) => existsSync(f))
  if (files.length === 0) return null
  const metafiles = files.map((f) => JSON.parse(readFileSync(f, "utf8")))
  const map = chunkMapFromMetafiles(pkgDir, metafiles)
  if (!map) return null
  // tsup writes the metafile after its outputs. A listed output that is
  // missing, or newer than the metafile, means the dist on disk is not the
  // build the metafile describes.
  for (const [i, file] of files.entries()) {
    const written = statSync(file).mtimeMs
    for (const key of Object.keys(metafiles[i].outputs)) {
      const out = path.join(absDir, key)
      if (!existsSync(out) || statSync(out).mtimeMs > written) return null
    }
  }
  return map
}
