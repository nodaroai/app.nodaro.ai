#!/usr/bin/env node
// Print the runtime export keys of a built package root, ESM and CJS, as JSON —
// in its own process, so the caller (a vitest worker) never loads or transforms
// the package's chunk graph itself.
//   node tools/package-entries/root-keys-probe.mjs <pkgDir>
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const dist = path.join(path.resolve(process.argv[2] ?? ''), 'dist')
const esm = Object.keys(await import(pathToFileURL(path.join(dist, 'index.js')).href))
const cjs = Object.keys(createRequire(import.meta.url)(path.join(dist, 'index.cjs')))
process.stdout.write(JSON.stringify({ esm, cjs }))
