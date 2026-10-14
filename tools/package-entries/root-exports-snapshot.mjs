#!/usr/bin/env node
// Write the root export-name baseline of a built package:
//   node tools/package-entries/root-exports-snapshot.mjs packages/shared
// → packages/shared/src/__tests__/fixtures/root-exports.baseline.json
//
// The baseline is what external consumers (which pin older versions and import
// only the package root) may rely on. The package-entries guard asserts the
// built root still exports every name in it — additive only. Re-run this ONLY
// to record a deliberate change to the public root (a removal is a breaking
// change: major version), never to make the guard pass.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { declaredExportNames } from './entries-lib.mjs'

const pkgDir = path.resolve(process.argv[2] ?? '')
const dist = path.join(pkgDir, 'dist')
if (!fs.existsSync(path.join(dist, 'index.d.ts'))) {
  console.error(`No build at ${dist} — run \`npm run build:packages\` first.`)
  process.exit(1)
}
const names = declaredExportNames(path.join(dist, 'index.d.ts'))
const runtime = Object.keys(await import(pathToFileURL(path.join(dist, 'index.js')).href)).sort()
const out = path.join(pkgDir, 'src', '__tests__', 'fixtures', 'root-exports.baseline.json')
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, `${JSON.stringify({ names, runtime }, null, 1)}\n`)
console.log(`${path.relative(process.cwd(), out)}: ${names.length} names, ${runtime.length} runtime values`)
