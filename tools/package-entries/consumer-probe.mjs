#!/usr/bin/env node
// Load ONE subpath of a published package the way a consumer does — by its
// package name, through node_modules and the package's "exports" map — in a
// FRESH process, then report what it saw as JSON on stdout.
//
//   node tools/package-entries/consumer-probe.mjs <pkg> <subpath>
//
// It imports the subpath alone first (so its modules initialise without any
// other entry having run), touches every export, then loads the root and
// compares instances. ESM and CJS are separate module graphs, so both are
// probed in the same process without contaminating each other.
import { createRequire } from 'node:module'

const [pkg, subpath] = process.argv.slice(2)
const spec = `${pkg}/${subpath}`
const require = createRequire(import.meta.url)

function touchAll(ns) {
  // Reading every binding forces CJS getters and surfaces a TDZ/initialisation
  // error that a lazy export would otherwise hide.
  for (const k of Object.keys(ns)) void ns[k]
}

function compare(sub, root) {
  const missing = []
  const different = []
  for (const k of Object.keys(sub)) {
    if (k === 'default' || k === '__esModule') continue
    if (!(k in root)) missing.push(k)
    else if (sub[k] !== root[k]) different.push(k)
  }
  return { missing, different }
}

const out = { spec }
const esm = await import(spec)
touchAll(esm)
out.esmKeys = Object.keys(esm).length
const cjs = require(spec)
touchAll(cjs)
out.cjsKeys = Object.keys(cjs).filter((k) => k !== '__esModule').length
out.esmVsRoot = compare(esm, await import(pkg))
out.cjsVsRoot = compare(cjs, require(pkg))
process.stdout.write(JSON.stringify(out))
