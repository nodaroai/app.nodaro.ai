import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  DEFAULTS, buildCell, buildMatrix, parseConfig, parseTimes, parseVitestDuration, planOutputs, renderMarkdown, summarize,
} from '../ci-experiment-plan.mjs'

const script = resolve('tools/ci-experiment-plan.mjs')

test('the checked-in experiment file is valid and states every field', () => {
  const text = readFileSync('tools/ci-experiment.json', 'utf8')
  const config = parseConfig(text)
  assert.deepEqual(Object.keys(JSON.parse(text)).sort(), Object.keys(DEFAULTS).sort())
  assert.deepEqual(config, { ...DEFAULTS, projects: [...DEFAULTS.projects] })
})

test('an empty object takes the defaults', () => {
  assert.deepEqual(parseConfig('{}'), { runsOn: 'ubuntu-latest', workers: 'auto', shards: 1, projects: ['frontend', 'backend'], repeat: 1, maxCells: 32, maxParallel: 4 })
  const { include } = buildMatrix(parseConfig('{}'))
  assert.deepEqual(include, [{ project: 'frontend', shard: 1, repeat: 1 }, { project: 'backend', shard: 1, repeat: 1 }])
})

test('expands projects × repeat × shards', () => {
  const config = parseConfig(JSON.stringify({ shards: 3, repeat: 2, projects: ['backend'] }))
  const { include } = buildMatrix(config)
  assert.equal(include.length, 6)
  assert.deepEqual(include.map(c => `${c.project}:${c.shard}/${c.repeat}`),
    ['backend:1/1', 'backend:2/1', 'backend:3/1', 'backend:1/2', 'backend:2/2', 'backend:3/2'])
  const out = planOutputs(config)
  assert.equal(out.cells, '6')
  assert.deepEqual(JSON.parse(out.expected), { backend: 6 })
  assert.deepEqual(JSON.parse(out.matrix), { include })
})

test('runsOn: a label stays a JSON string, an array stays a JSON array', () => {
  const asString = planOutputs(parseConfig('{"runsOn":"ubuntu-latest-16-cores"}'))
  assert.equal(asString.runsOn, '"ubuntu-latest-16-cores"')
  assert.equal(JSON.parse(asString.runsOn), 'ubuntu-latest-16-cores')
  const labels = ['self-hosted', 'linux', 'x64', 'nodaro-ci']
  const asArray = planOutputs(parseConfig(JSON.stringify({ runsOn: labels, workers: 2 })))
  assert.deepEqual(JSON.parse(asArray.runsOn), labels)
  assert.equal(asArray.runsOnLabel, 'self-hosted,linux,x64,nodaro-ci')
  assert.equal(asArray.workers, '2')
  for (const v of Object.values(asArray)) assert.ok(!v.includes('\n'), 'GITHUB_OUTPUT values must be single-line')
})

test('invalid input fails with a message naming the problem', () => {
  assert.throws(() => parseConfig('{ shards: 2 }'), /tools\/ci-experiment\.json is not valid JSON/)
  assert.throws(() => parseConfig('[]'), /must be a JSON object/)
  assert.throws(() => parseConfig('{"worker": 4}'), /unknown field\(s\) worker/)
  assert.throws(() => parseConfig('{"runsOn": ""}'), /runsOn must be/)
  assert.throws(() => parseConfig('{"runsOn": []}'), /runsOn must be/)
  assert.throws(() => parseConfig('{"runsOn": ["self-hosted", 3]}'), /runsOn must be/)
  assert.throws(() => parseConfig('{"workers": 0}'), /workers must be "auto" or an integer >= 1/)
  assert.throws(() => parseConfig('{"workers": "4"}'), /workers must be/)
  assert.throws(() => parseConfig('{"shards": 1.5}'), /shards must be an integer >= 1/)
  assert.throws(() => parseConfig('{"repeat": 0}'), /repeat must be an integer >= 1/)
  assert.throws(() => parseConfig('{"projects": []}'), /projects must be/)
  assert.throws(() => parseConfig('{"projects": ["remotion"]}'), /projects must be/)
  assert.throws(() => parseConfig('{"projects": ["backend", "backend"]}'), /projects must be/)
  assert.throws(() => parseConfig('{"maxCells": 257}'), /maxCells must be an integer from 1 to 256/)
  assert.throws(() => parseConfig('{"maxParallel": 0}'), /maxParallel must be an integer >= 1/)
})

test('cost cap: more than 32 cells is refused unless maxCells raises it, never past 256', () => {
  assert.equal(planOutputs(parseConfig('{"shards": 8, "repeat": 2}')).cells, '32')
  assert.throws(() => parseConfig('{"shards": 9, "repeat": 2}'),
    /36 cells \(projects × shards × repeat\) exceeds maxCells 32.*raise "maxCells"/)
  assert.equal(planOutputs(parseConfig('{"shards": 9, "repeat": 2, "maxCells": 36}')).cells, '36')
  assert.throws(() => parseConfig('{"shards": 64, "repeat": 3, "maxCells": 256}'), /384 cells .* exceeds maxCells 256/)
})

test('maxParallel caps concurrent cells (default 4)', () => {
  assert.equal(planOutputs(parseConfig('{}')).maxParallel, '4')
  assert.equal(planOutputs(parseConfig('{"maxParallel": 2}')).maxParallel, '2')
})

test('the plan command writes GITHUB_OUTPUT and fails clearly on a bad file', t => {
  const dir = mkdtempSync(join(tmpdir(), 'ci-experiment-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const output = join(dir, 'out')
  writeFileSync(output, '')
  writeFileSync(join(dir, 'ok.json'), '{"shards":2}')
  const ok = spawnSync(process.execPath, [script, 'plan', join(dir, 'ok.json')], { env: { ...process.env, GITHUB_OUTPUT: output }, encoding: 'utf8' })
  assert.equal(ok.status, 0, ok.stderr)
  const written = Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
  assert.equal(JSON.parse(written.matrix).include.length, 4)
  assert.equal(written.runsOn, '"ubuntu-latest"')

  writeFileSync(join(dir, 'bad.json'), '{"shards":2,}')
  const bad = spawnSync(process.execPath, [script, 'plan', join(dir, 'bad.json')], { encoding: 'utf8' })
  assert.equal(bad.status, 1)
  assert.match(bad.stderr, /bad\.json is not valid JSON/)
})

test('parses vitest\'s Duration line in seconds and milliseconds, colour codes included', () => {
  const log = [
    ' Test Files  2061 passed (2061)',
    '\u001b[2m   Duration \u001b[22m 512.34s\u001b[2m (transform 40.10s, setup 812ms, import 1203.55s, tests 2400.00s, environment 3.20s)\u001b[22m',
  ].join('\n')
  assert.deepEqual(parseVitestDuration(log), {
    vitestDurationSeconds: 512.34,
    phases: { transform: 40.1, setup: 0.812, import: 1203.55, tests: 2400, environment: 3.2 },
  })
  assert.deepEqual(parseVitestDuration('   Duration  950ms (transform 12ms, setup 0ms, import 30ms, tests 5ms, environment 0ms, typecheck 1.50s)').phases.typecheck, 1.5)
  assert.equal(parseVitestDuration('no summary here'), null)
})

test('parses bash `times` (children line)', () => {
  assert.deepEqual(parseTimes('0m0.010s 0m0.002s\n12m3.500s 1m0.250s\n'), { user: 723.5, sys: 60.25 })
  assert.equal(parseTimes(''), null)
  assert.equal(parseTimes('garbage'), null)
})

const env = {
  CAPACITY_PROJECT: 'backend', CAPACITY_SHARD: '2', CAPACITY_SHARDS: '4', CAPACITY_REPEAT: '1',
  CAPACITY_RUNS_ON: 'ubuntu-latest', RUNNER_NAME: 'GitHub Actions 7', RUNNER_ENVIRONMENT: 'github-hosted',
  CAPACITY_NPROC: '4', CAPACITY_WORKERS: 'auto', CAPACITY_EFFECTIVE_WORKERS: '',
  CAPACITY_WALL_MS: '123456', CAPACITY_SETUP_MS: '60000', CAPACITY_TIMES: '0m0.0s 0m0.0s\n6m40.000s 0m20.000s',
  CAPACITY_PEAK_BYTES: String(3 * 2 ** 30), CAPACITY_PEAK_SOURCE: 'meminfo', CAPACITY_EXIT_CODE: '0',
  GITHUB_RUN_ID: '987654321', GITHUB_RUN_ATTEMPT: '1',
}
const report = { numPassedTests: 900, numFailedTests: 0, testResults: [{}, {}, {}] }

test('a cell records the measurements and derives ok from exit code and failures', () => {
  const cell = buildCell(env, { log: 'Duration  120.00s (transform 1s, setup 2s, import 3s, tests 4s, environment 5s)', report, cpuMax: 'max 100000\n' })
  assert.equal(cell.wallSeconds, 123.456)
  assert.equal(cell.setupSeconds, 60)
  assert.equal(cell.cpuSeconds, 420)
  assert.equal(cell.peakMemMB, 3072)
  assert.equal(cell.effectiveMaxWorkers, 'vitest default')
  assert.equal(cell.cpuMax, 'max 100000')
  assert.equal(cell.files, 3)
  assert.equal(cell.vitestDuration, 120)
  assert.equal(cell.ok, true)
  assert.equal(cell.stage, 'tests')
  assert.equal(cell.runId, '987654321')
  assert.equal(cell.runAttempt, 1)
  assert.equal(buildCell({ ...env, CAPACITY_EXIT_CODE: '1' }, { log: '', report, cpuMax: null }).ok, false)
  const noReport = buildCell(env, { log: '', report: null, cpuMax: null })
  assert.equal(noReport.ok, false)
  assert.equal(noReport.files, null)
})

const cell = (shard, repeat, wallSeconds, extra = {}) => ({
  project: 'backend', runsOn: 'ubuntu-latest', workers: 'auto', effectiveMaxWorkers: 'vitest default', shards: 2,
  shard, repeat, wallSeconds, setupSeconds: 50, cpuSeconds: wallSeconds * 3, peakMemMB: 1000 + shard,
  nproc: 4, cpuMax: null, memMB: 16000, files: 100, ok: true, phases: {}, runner: `r${shard}${repeat}`, ...extra,
})

test('a setup failure is a failed cell at stage "setup", reported as such rather than missing', () => {
  const setupEnv = { ...env, CAPACITY_STAGE: 'setup', CAPACITY_FAILED_STEP: 'npm ci', CAPACITY_EXIT_CODE: '', CAPACITY_WALL_MS: '', CAPACITY_TIMES: '' }
  const failed = buildCell(setupEnv, { log: '', report: null, cpuMax: null })
  assert.equal(failed.stage, 'setup')
  assert.equal(failed.failedStep, 'npm ci')
  assert.equal(failed.ok, false)
  assert.equal(failed.wallSeconds, null)
  const md = renderMarkdown([{ ...failed, phases: {} }], { backend: 1 })
  assert.match(md, /\*\*Setup failed:\*\* backend shard 2\/4 repeat 1 .* at npm ci/)
  assert.doesNotMatch(md, /Missing/)
})

test('summary: critical path is the slowest shard per repeat; runner-seconds sum the shards', () => {
  const cells = [cell(1, 1, 100), cell(2, 1, 300), cell(1, 2, 200), cell(2, 2, 250)]
  const { rows, missing, failed } = summarize(cells, { backend: 4 })
  assert.equal(rows.length, 1)
  const [r] = rows
  assert.equal(r.repeats, 2)
  assert.equal(r.completeRepeats, 2)
  assert.equal(r.criticalPathMedian, 275) // repeats: max(100,300)=300, max(200,250)=250
  assert.equal(r.criticalPathMin, 250)
  assert.equal(r.criticalPathMax, 300)
  assert.equal(r.shardWallMedian, 225)
  assert.equal(r.runnerSecondsTests, 425) // median(400, 450)
  assert.equal(r.runnerSecondsWithSetup, 525)
  assert.equal(r.peakMemMB, 1002)
  assert.equal(r.files, 200)
  assert.deepEqual(missing, [])
  assert.deepEqual(failed, [])
})

test('summary flags failed and missing cells and groups different configurations apart', () => {
  const cells = [cell(1, 1, 100), cell(2, 1, 120, { ok: false, exitCode: 1, failed: 3 }), cell(1, 1, 400, { shards: 1, project: 'backend' })]
  const { rows, missing, failed } = summarize(cells, { backend: 4, frontend: 2 })
  assert.equal(rows.length, 2)
  assert.deepEqual(missing, [{ project: 'backend', missing: 1 }, { project: 'frontend', missing: 2 }])
  assert.equal(failed.length, 1)
  const md = renderMarkdown(cells, { backend: 4, frontend: 2 })
  assert.match(md, /\*\*Failed cell:\*\* backend shard 2\/2 repeat 1 on r21 — exit 1, 3 failed test\(s\)/)
  assert.match(md, /\*\*Missing:\*\* 2 frontend cell\(s\)/)
  assert.match(renderMarkdown([], { frontend: 1 }), /No cell results were found/)
})

test('timing columns ignore incomplete or failed repeats instead of understating them', () => {
  // Repeat 1 lost its slowest shard (timed out, no artifact); repeat 3 crashed early in shard 2.
  const cells = [cell(1, 1, 100), cell(1, 2, 200), cell(2, 2, 600), cell(1, 3, 150), cell(2, 3, 20, { ok: false })]
  const [r] = summarize(cells, { backend: 6 }).rows
  assert.equal(r.completeRepeats, 1)
  assert.equal(r.repeats, 3)
  assert.equal(r.criticalPathMedian, 600)
  assert.equal(r.shardWallMedian, 400)
  assert.equal(r.runnerSecondsTests, 800)
  assert.equal(r.failedCells, 1)
  const none = summarize([cell(1, 1, 100)], { backend: 2 }).rows[0]
  assert.equal(none.completeRepeats, 0)
  assert.equal(none.criticalPathMedian, null)
  assert.match(renderMarkdown([cell(1, 1, 100)], { backend: 2 }), /\| 0\/1 \| .* \| – \| – \(–––\) \|/)
})

test('two runs of one configuration are two complete repeats, runner-seconds per run (not doubled)', () => {
  const runA = [cell(1, 1, 100, { runId: '111', runAttempt: 1 }), cell(2, 1, 300, { runId: '111', runAttempt: 1 })]
  const runB = [cell(1, 1, 200, { runId: '222', runAttempt: 1 }), cell(2, 1, 250, { runId: '222', runAttempt: 1 })]
  const [r] = summarize([...runA, ...runB]).rows
  assert.equal(r.completeRepeats, 2)
  assert.equal(r.repeats, 2)
  assert.equal(r.criticalPathMedian, 275)
  assert.equal(r.runnerSecondsTests, 425) // median(400, 450), not 850
  // A re-run attempt is its own repeat, never merged with the first attempt's shards.
  const retry = summarize([cell(1, 1, 100, { runId: '111', runAttempt: 1 }), cell(2, 1, 90, { runId: '111', runAttempt: 2 })]).rows[0]
  assert.equal(retry.completeRepeats, 0)
})

test('the summary command reads cell JSON from nested artifact folders', t => {
  const dir = mkdtempSync(join(tmpdir(), 'ci-experiment-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  mkdirSync(join(dir, 'a'))
  writeFileSync(join(dir, 'a', 'cell.json'), JSON.stringify(cell(1, 1, 90, { shards: 1 })))
  const summaryJson = join(dir, 'summary.json')
  const run = spawnSync(process.execPath, [script, 'summary', dir], {
    env: { ...process.env, GITHUB_STEP_SUMMARY: '', CAPACITY_EXPECTED: '{"backend":1}', CAPACITY_SUMMARY_JSON: summaryJson }, encoding: 'utf8',
  })
  assert.equal(run.status, 0, run.stderr)
  assert.match(run.stdout, /\| backend \| `ubuntu-latest` \| auto \(vitest default\) \| 1 \| 1\/1 \|/)
  assert.equal(JSON.parse(readFileSync(summaryJson, 'utf8')).rows[0].criticalPathMedian, 90)
})
