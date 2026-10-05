import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const script = resolve('tools/ci-build-artifact.mjs')
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'ci-artifact-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(join(root, 'package-lock.json'), 'lockfile')
  for (const p of ['shared', 'prompts', 'client', 'picker-ui', 'render-rules']) {
    mkdirSync(join(root, 'packages', p, 'dist'), { recursive: true })
    writeFileSync(join(root, 'packages', p, 'dist', 'index.js'), `export default '${p}'`)
  }
  const env = { ...process.env, GITHUB_SHA: 'a'.repeat(40), GITHUB_RUN_ID: '123' }
  const run = (command, overrides = {}) => spawnSync(process.execPath,
    [script, command, 'packages', join(root, 'artifact')],
    { cwd: root, env: { ...env, ...overrides }, encoding: 'utf8' })
  return { root, run }
}
test('current-run package outputs survive a clean restore', t => {
  const { root, run } = fixture(t)
  const packed = run('pack')
  assert.equal(packed.status, 0, packed.stderr)
  rmSync(join(root, 'packages'), { recursive: true })
  const restored = run('restore')
  assert.equal(restored.status, 0, restored.stderr)
  assert.equal(readFileSync(join(root, 'packages/shared/dist/index.js'), 'utf8'), "export default 'shared'")
})
for (const [label, overrides] of [
  ['another commit', { GITHUB_SHA: 'b'.repeat(40) }],
  ['another run', { GITHUB_RUN_ID: '124' }],
]) test(`rejects outputs from ${label}`, t => {
  const { run } = fixture(t)
  assert.equal(run('pack').status, 0)
  const r = run('restore', overrides)
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /identity mismatch/)
})
test('rejects changed dependencies before extraction', t => {
  const { root, run } = fixture(t)
  assert.equal(run('pack').status, 0)
  writeFileSync(join(root, 'package-lock.json'), 'changed lockfile')
  const r = run('restore')
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /identity mismatch/)
})
test('rejects a corrupt archive', t => {
  const { root, run } = fixture(t)
  assert.equal(run('pack').status, 0)
  writeFileSync(join(root, 'artifact/outputs.tgz'), 'corrupt')
  const r = run('restore')
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /checksum mismatch/)
})
test('missing output cannot produce a successful artifact', t => {
  const { root, run } = fixture(t)
  rmSync(join(root, 'packages/prompts/dist'), { recursive: true })
  assert.notEqual(run('pack').status, 0)
})
