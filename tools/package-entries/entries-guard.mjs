// The checks behind each published package's subpath-entry guard
// (packages/<pkg>/src/__tests__/package-entries.test.ts). Each returns a list
// of human-readable problems — empty means the invariant holds — so the tests
// stay thin and the failure says what to fix.
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { declaredExportNamesOf, entryNames } from './entries-lib.mjs'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const execFileAsync = promisify(execFile)
const HERE = path.dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = path.resolve(HERE, '..', '..')

const BUILD_HINT = 'run `npm run build:packages` (the guard reads the built dist, which is what consumers load)'

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

/** The exports-map value every subpath must carry (same shape as the root's). */
export function expectedSubpathTarget(name) {
  return { types: `./dist/entries/${name}.d.ts`, import: `./dist/entries/${name}.js`, require: `./dist/entries/${name}.cjs` }
}

/** `src/index.ts` re-exports exactly the entries in `src/entries/`, and nothing else. */
export function indexShapeErrors(pkgDir) {
  const file = path.join(pkgDir, 'src', 'index.ts')
  const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const errors = []
  const listed = []
  for (const st of sf.statements) {
    const ok =
      ts.isExportDeclaration(st) &&
      !st.exportClause &&
      !st.isTypeOnly &&
      ts.isStringLiteral(st.moduleSpecifier) &&
      /^\.\/entries\/[a-z0-9-]+\.js$/.test(st.moduleSpecifier.text)
    if (!ok) {
      errors.push(
        `src/index.ts may only contain \`export * from "./entries/<name>.js"\` — found \`${st.getText().slice(0, 100)}\`. ` +
          'Export from the entry in src/entries/ that owns the module instead (the root re-exports every entry).',
      )
      continue
    }
    listed.push(st.moduleSpecifier.text.slice('./entries/'.length, -'.js'.length))
  }
  const entries = entryNames(pkgDir)
  for (const e of entries) if (!listed.includes(e)) errors.push(`src/index.ts does not re-export the entry "${e}" (src/entries/${e}.ts)`)
  for (const l of listed) if (!entries.includes(l)) errors.push(`src/index.ts re-exports "./entries/${l}.js", which does not exist`)
  const dupes = listed.filter((l, i) => listed.indexOf(l) !== i)
  for (const d of dupes) errors.push(`src/index.ts re-exports the entry "${d}" twice`)
  return errors
}

/** package.json "exports" = the unchanged root + one subpath per entry, nothing else. */
export function exportsMapErrors(pkgDir) {
  const pkg = readJson(path.join(pkgDir, 'package.json'))
  const errors = []
  const root = { types: './dist/index.d.ts', import: './dist/index.js', require: './dist/index.cjs' }
  if (JSON.stringify(pkg.exports?.['.']) !== JSON.stringify(root)) errors.push(`exports["."] must stay ${JSON.stringify(root)}`)
  if (pkg.main !== './dist/index.cjs' || pkg.module !== './dist/index.js' || pkg.types !== './dist/index.d.ts') {
    errors.push('main/module/types must keep pointing at dist/index.{cjs,js,d.ts} (older resolvers read them, not "exports")')
  }
  if ('sideEffects' in pkg) {
    errors.push('"sideEffects" must not be set: @nodaro/prompts entries load picker-catalogs.ts for its side effect (the composed-catalog resolver), and a bundler honouring the field could drop that import')
  }
  const entries = entryNames(pkgDir)
  const keys = Object.keys(pkg.exports ?? {}).filter((k) => k !== '.')
  for (const e of entries) {
    const want = expectedSubpathTarget(e)
    const got = pkg.exports?.[`./${e}`]
    if (!got) errors.push(`package.json exports is missing "./${e}" for src/entries/${e}.ts — add ${JSON.stringify({ [`./${e}`]: want })}`)
    else if (JSON.stringify(got) !== JSON.stringify(want)) errors.push(`exports["./${e}"] must be ${JSON.stringify(want)}`)
  }
  for (const k of keys) if (!entries.includes(k.slice(2))) errors.push(`exports["${k}"] has no src/entries/${k.slice(2)}.ts`)
  return errors
}

/** Every file the exports map names exists in dist. */
export function distFileErrors(pkgDir) {
  const pkg = readJson(path.join(pkgDir, 'package.json'))
  const errors = []
  for (const [key, target] of Object.entries(pkg.exports ?? {})) {
    for (const rel of Object.values(target)) {
      if (!fs.existsSync(path.join(pkgDir, rel))) errors.push(`exports["${key}"] → ${rel} is not built — ${BUILD_HINT}`)
    }
  }
  return errors
}

/** The built root still exports every baseline name: types (d.ts + d.cts) and runtime values (ESM + CJS). */
export async function rootAdditiveErrors(pkgDir) {
  const base = readJson(path.join(pkgDir, 'src', '__tests__', 'fixtures', 'root-exports.baseline.json'))
  const dist = path.join(pkgDir, 'dist')
  const errors = []
  const check = (label, have) => {
    const missing = base[label === 'ESM' || label === 'CJS' ? 'runtime' : 'names'].filter((n) => !have.has(n))
    if (missing.length) errors.push(`root ${label} lost ${missing.length} baseline export(s): ${missing.slice(0, 20).join(', ')}${missing.length > 20 ? ', …' : ''}`)
  }
  const dts = path.join(dist, 'index.d.ts')
  const dcts = path.join(dist, 'index.d.cts')
  const declared = declaredExportNamesOf([dts, dcts])
  check('d.ts', new Set(declared[dts]))
  check('d.cts', new Set(declared[dcts]))
  // Runtime keys come from a child process: importing the dist here would make
  // the vitest worker load (and transform) the whole chunk graph.
  const keys = await runProbe('root-keys-probe.mjs', [pkgDir])
  check('ESM', new Set(keys.esm))
  check('CJS', new Set(keys.cjs))
  return errors
}

/** Declared (d.ts) names of every entry, and of the root. */
export function declaredNamesByEntry(pkgDir) {
  const file = (e) => path.join(pkgDir, 'dist', 'entries', `${e}.d.ts`)
  const rootFile = path.join(pkgDir, 'dist', 'index.d.ts')
  const entries = entryNames(pkgDir)
  const declared = declaredExportNamesOf([rootFile, ...entries.map(file)])
  return { byEntry: Object.fromEntries(entries.map((e) => [e, declared[file(e)]])), root: declared[rootFile] }
}

/**
 * The root's names are exactly the union of the entries' names. A name in more
 * than one entry is allowed only when listed (with the reason) in `allowShared`
 * — the root's `export *` of two entries drops a name they disagree on.
 */
export function unionErrors(pkgDir, allowShared = {}) {
  const { byEntry, root } = declaredNamesByEntry(pkgDir)
  const errors = []
  const owners = new Map()
  for (const [e, names] of Object.entries(byEntry)) {
    if (names.length === 0) errors.push(`entry "${e}" exports nothing`)
    for (const n of names) owners.set(n, [...(owners.get(n) ?? []), e])
  }
  const rootSet = new Set(root)
  for (const n of owners.keys()) if (!rootSet.has(n)) errors.push(`"${n}" (entry ${owners.get(n).join(', ')}) is not exported by the root`)
  for (const n of root) if (!owners.has(n)) errors.push(`root export "${n}" belongs to no entry`)
  for (const [n, es] of owners) {
    if (es.length > 1 && !allowShared[n]) errors.push(`"${n}" is exported by several entries (${es.join(', ')}) — give it one owner, or list it in the guard's allowShared with the reason`)
  }
  for (const n of Object.keys(allowShared)) {
    if ((owners.get(n) ?? []).length < 2) errors.push(`allowShared lists "${n}", which is no longer exported by several entries — drop it`)
  }
  return errors
}

/** Each subpath's types resolve from a consumer file under bundler and NodeNext resolution. */
export function typeResolutionErrors(pkgDir, pkgName) {
  const consumer = path.join(REPO_ROOT, 'backend', 'src', 'app.ts')
  const errors = []
  const modes = [
    ['bundler', { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler }],
    ['nodenext', { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext }],
  ]
  for (const e of entryNames(pkgDir)) {
    for (const [label, options] of modes) {
      const r = ts.resolveModuleName(`${pkgName}/${e}`, consumer, options, ts.sys)
      const file = r.resolvedModule?.resolvedFileName
      if (!file || !fs.realpathSync(file).endsWith(path.join('dist', 'entries', `${e}.d.ts`))) {
        errors.push(`${pkgName}/${e} types do not resolve under ${label} resolution (got ${file ?? 'nothing'})`)
      }
    }
  }
  return errors
}

/** Wall-clock cap for one probe process. CI runners are 2 vCPU; a healthy probe takes well under a second. */
export const PROBE_TIMEOUT_MS = 30_000
/** Probe processes in flight at once — Promise.all over every entry oversubscribes a small runner. */
export const PROBE_CONCURRENCY = 4

/** Run a probe script in a fresh Node process; returns its JSON stdout. A failure names the probe and its arguments. */
export async function runProbe(script, args) {
  try {
    const { stdout } = await execFileAsync(process.execPath, [path.join(HERE, script), ...args], {
      cwd: path.join(REPO_ROOT, 'backend'),
      maxBuffer: 16 * 1024 * 1024,
      timeout: PROBE_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    })
    return JSON.parse(stdout)
  } catch (err) {
    const why = err?.killed ? `timed out after ${PROBE_TIMEOUT_MS} ms` : String(err?.stderr || err?.message || err).slice(0, 2000)
    throw new Error(`probe ${script} ${args.join(' ')} failed: ${why}`)
  }
}

/** Map over items with at most `limit` in flight; results keep the input order. */
export async function mapLimited(items, limit, fn) {
  const out = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

/**
 * Every subpath, loaded ALONE by package name in a fresh process (ESM and CJS):
 * initialises, exports ≥1 value or is type-only by design, and every value is
 * the root's own instance (shared chunks — one module state, not a copy).
 */
export async function consumerLoadErrors(pkgDir, pkgName, typeOnlyEntries = []) {
  const results = await mapLimited(entryNames(pkgDir), PROBE_CONCURRENCY, async (e) => {
    try {
      return [e, await runProbe('consumer-probe.mjs', [pkgName, e])]
    } catch (err) {
      return [e, { error: String(err?.message ?? err) }]
    }
  })
  const errors = []
  for (const [e, r] of results) {
    if (r.error) {
      errors.push(`${pkgName}/${e} failed to load alone: ${r.error}`)
      continue
    }
    const typeOnly = typeOnlyEntries.includes(e)
    if (!typeOnly && (r.esmKeys === 0 || r.cjsKeys === 0)) errors.push(`${pkgName}/${e} has no runtime exports (ESM ${r.esmKeys}, CJS ${r.cjsKeys})`)
    if (r.esmKeys !== r.cjsKeys) errors.push(`${pkgName}/${e}: ESM exports ${r.esmKeys} values but CJS ${r.cjsKeys}`)
    for (const [fmt, cmp] of [['ESM', r.esmVsRoot], ['CJS', r.cjsVsRoot]]) {
      if (cmp.missing.length) errors.push(`${pkgName}/${e} (${fmt}) exports values the root does not: ${cmp.missing.slice(0, 10).join(', ')}`)
      if (cmp.different.length) errors.push(`${pkgName}/${e} (${fmt}) values are NOT the root's instances (duplicated module state): ${cmp.different.slice(0, 10).join(', ')}`)
    }
  }
  return errors
}

/** Relative chunk files a built JS file loads (ESM `import`/`from`, CJS `require`), transitively. */
export function distRuntimeClosure(file) {
  const seen = new Set()
  const stack = [path.resolve(file)]
  const re = /(?:\bfrom\s*|\bimport\s*|\brequire\()\s*['"](\.{1,2}\/[^'"]+)['"]/g
  while (stack.length) {
    const f = stack.pop()
    if (seen.has(f)) continue
    seen.add(f)
    for (const m of fs.readFileSync(f, 'utf8').matchAll(re)) stack.push(path.resolve(path.dirname(f), m[1]))
  }
  return seen
}
