import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8')
const jobs = Object.fromEntries([...workflow.matchAll(/^  ([\w-]+):\n([\s\S]*?)(?=^  [\w-]+:\n|$(?![\s\S]))/gm)]
  .map(([, name, body]) => [name, body]))
const consumers = ['frontend-test-shards', 'backend-test-shards', 'typecheck', 'remotion-tests', 'characterize', 'ffmpeg-ledger-redis', 'build-backend', 'backend-boot-smoke']
// Skipped on an unrelated diff once preparation succeeded: the suites by the
// Diff Gate's tree classification, the gated jobs by tools/ci/job-inputs.json.
const diffGated = ['frontend-test-shards', 'backend-test-shards', 'remotion-tests', 'characterize', 'ffmpeg-ledger-redis']

for (const name of consumers) test(`${name} fails closed when preparation fails or is skipped`, () => {
  const job = jobs[name]
  const condition = job.match(/^    if: \$\{\{ (.+) \}\}$/m)?.[1]
  assert.ok(condition?.includes('!cancelled()'), 'must run its failure assertion after failed dependencies')
  const command = job.match(/- name: Require successful preparation\n[\s\S]*?        run: (.+)/)?.[1]
  assert.ok(command, 'failure assertion must precede checkout and expensive work')
  assert.ok(job.indexOf('Require successful preparation') < job.indexOf('actions/checkout'))
  for (const result of ['success', 'failure', 'skipped', 'cancelled']) {
    const needs = {
      changes: { result: 'success', outputs: { frontend: 'false', backend: 'false', remotion: 'false', characterize: 'false', ffmpeg_ledger: 'false' } },
      'prepare-packages': { result }, typecheck: { result }, 'build-backend': { result },
    }
    const shouldRun = Function('needs', 'cancelled', `return (${condition.replace(/needs\.([a-z-]+)/g, "needs['$1']")})`)(needs, () => false)
    if (diffGated.includes(name) && result === 'success') {
      assert.equal(shouldRun, false, 'unrelated diff still skips')
    } else assert.equal(shouldRun, true, 'failed preparation cannot skip a required check')
    const r = spawnSync('bash', ['-c', command], { env: { ...process.env,
      DEPENDENCIES: JSON.stringify({ prepare: { result } }), PREPARE_RESULT: result,
    } })
    assert.equal(r.status === 0, result === 'success')
  }
})

test('independent security guards do not inherit unrelated suite skips', () => {
  for (const name of ['check-ee-imports', 'check-pricing-leaks', 'check-surface-funnel']) {
    assert.doesNotMatch(jobs[name], /^    needs:/m)
  }
})

test('production migrations retain every original prerequisite', () => {
  const needs = jobs.migrate.match(/^    needs: \[(.+)\]/m)[1].split(', ')
  for (const name of ['frontend-tests', 'backend-tests', 'typecheck', 'tenant-scope-lint',
    'check-ee-imports', 'check-pricing-leaks', 'check-billing-dumps',
    'check-public-surface', 'check-surface-funnel', 'backend-boot-smoke',
    'migration-behavior', 'prepare-packages', 'build-backend']) assert.ok(needs.includes(name), name)
  for (const name of needs) assert.ok(jobs[name], `migrate needs a job that no longer exists: ${name}`)
  assert.match(jobs.migrate, /github\.ref == 'refs\/heads\/main' && github\.event_name == 'push'/)
})

// The i18n Locale Completeness and Check Locale Completeness jobs were
// folded into the shared suite (decided 2026-10-16): it is the one owner now,
// so it must keep running the matrix test whole, on every Backend Tests run,
// selection or not.
test('locale completeness has one owner: the whole @nodaro/shared suite in Backend Tests', () => {
  const step = jobs['backend-test-shards'].match(/- name: Run @nodaro\/shared test suite\n {8}if: (.+)\n {8}run: (.+)/)
  assert.ok(step, 'the @nodaro/shared suite step moved — the locale completeness test runs nowhere else')
  assert.equal(step[2].trim(), 'npm run test --workspace=@nodaro/shared', 'the whole suite, no file filter')
  assert.doesNotMatch(step[1], /steps\.select/, 'not gated on test selection')
  const pkg = JSON.parse(readFileSync('packages/shared/package.json', 'utf8'))
  assert.equal(pkg.scripts.test, 'vitest run')
  assert.match(readFileSync('packages/shared/vitest.config.ts', 'utf8'), /include: \["src\/\*\*\/\*\.test\.ts"\]/)
  const locale = readFileSync('packages/shared/src/__tests__/i18n-locale-completeness.test.ts', 'utf8')
  assert.match(locale, /const EXPECTED_LOCALES = \[/, 'the hand-pinned locale list stays (a locale gone from the registry and every catalog)')
  assert.match(locale, /toEqual\(\[\.\.\.EXPECTED_LOCALES\]\.sort\(\)\)/)
  for (const gone of ['i18n-completeness', 'check-locale-completeness']) assert.equal(jobs[gone], undefined, gone)
})

// The owner above runs only when the Diff Gate sets backend=true; a sidecar
// edit must, so its classification is run here, out of ci.yml itself.
test('the Diff Gate routes an i18n sidecar change to Backend Tests', () => {
  // Every `case "$f"` block of the loop, in order: the routing one is not the
  // only one (the test de-dup block comes first).
  const blocks = [...jobs.changes.matchAll(/\n( +)case "\$f" in\n[\s\S]*?\n\1esac/g)].map((m) => m[0])
  assert.ok(blocks.some((b) => /\bbackend=true\b/.test(b)), "the Diff Gate's classification moved")
  const gate = blocks.join('\n')
  const classify = (f) => spawnSync('bash', ['-c', `frontend=false backend=false; f="$1"; ${gate}\necho "$frontend $backend"`, '_', f], { encoding: 'utf8' }).stdout.trim()
  assert.equal(classify('packages/shared/src/i18n/seasons.fr.ts').split(' ')[1], 'true', 'packages/shared/src/i18n/* must set backend=true')
  assert.equal(classify('packages/shared/src/i18n/types.ts').split(' ')[1], 'true')
  assert.equal(classify('docs/x.md'), 'false false', 'the classification really ran')
})

test('both edition probes and coverage commands survive preparation sharing', () => {
  assert.match(jobs['backend-boot-smoke'], /edition: \[cloud, community\]/)
  assert.match(jobs['backend-boot-smoke'], /WEBHOOK_STATUS.*404/)
  // Both suites run through the shared runner, whose post-merge mode is the
  // full suite on every dev commit; coverage moved to the nightly workflow,
  // which must still measure both projects.
  for (const name of ['frontend-test-shards', 'backend-test-shards']) assert.match(jobs[name], /run: bash \.\.\/tools\/test-select\/run-suite\.sh/)
  assert.match(readFileSync('tools/test-select/run-suite.sh', 'utf8'), /^  post-merge\) ;;$/m)
  assert.match(workflow, /case "\$MODE" in post-merge\) sel=post-merge ;; \*\) sel=full ;; esac/)
  assert.doesNotMatch(workflow, /full-coverage|test:coverage/)
  const nightly = readFileSync('.github/workflows/nightly-coverage.yml', 'utf8')
  for (const dir of ['frontend', 'backend']) {
    assert.match(nightly, new RegExp(`working-directory: ${dir}\\n        run: npm run test:coverage`), dir)
    assert.match(nightly, new RegExp(`name: ${dir}-coverage`), dir)
  }
  assert.match(nightly, /ref: dev/)
  // never in the public mirror, which receives the file with dev and main
  assert.equal(nightly.match(/^    if: github\.repository == 'nodaroai\/app\.nodaro\.ai-internal'$/gm)?.length, 2)
  assert.match(nightly, /sudo bash tools\/install-pinned-ffmpeg\.sh --from-dockerfile Dockerfile --arch amd64/)
  assert.equal(workflow.match(/run: npm run build:packages/g)?.length, 1)
  assert.equal(workflow.match(/run: npx tsc -p tsconfig.build.json && node scripts\/copy-build-assets.mjs/g)?.length, 1)
})

test('failed-job reruns can restore preparation from an earlier attempt', () => {
  const action = readFileSync('.github/actions/restore-ci-build/action.yml', 'utf8')
  assert.doesNotMatch(action, /github\.run_attempt/)
  for (const name of ['prepare-packages', 'build-backend']) {
    assert.doesNotMatch(jobs[name], /github\.run_attempt/)
    assert.match(jobs[name], /overwrite: true/)
  }
})

test('expensive test steps stop on superseding cancellation', () => {
  for (const name of ['frontend-test-shards', 'backend-test-shards', 'typecheck']) {
    assert.doesNotMatch(jobs[name], /always\(\) && steps\.build-packages/)
    assert.match(jobs[name], /!cancelled\(\) && steps\.build-packages/)
  }
})

// Runners (decided 2026-10-20): every job either routes to the Railway pool
// through the one shared expression, or is listed here as hosted, with why.
// The value of a Railway job is its GitHub-hosted fallback — today's label, so
// clearing CI_RAILWAY_ENABLED restores the hosted runners exactly.
const RAILWAY_JOBS = {
  'prepare-packages': 'ubuntu-latest',
  'frontend-test-shards': 'ubuntu-latest',
  'backend-test-shards': 'ubuntu-latest',
  'test-dedup-harness': 'ubuntu-latest',
  typecheck: 'ubuntu-latest',
  'build-backend': 'ubuntu-latest',
  'backend-boot-smoke': 'ubuntu-latest',
}
// Only jobs that do nothing on a verified tree may drop to ubuntu-slim in that
// mode: Type Check and the builds do their full work on a verified main push.
const VERIFIED_ON_SLIM = ['frontend-test-shards', 'backend-test-shards']
// A hosted job keeps exactly its own runner (decided 2026-10-20: the pool gets
// the heavy jobs only). Key: job, value: [its runner, why it stays hosted].
const SHORT = 'short: a pool hop queues longer than the job runs'
const HOSTED_JOBS = {
  'frontend-tests': ['ubuntu-slim', `the fan-in check, at the tail of every run; ${SHORT}`],
  'backend-tests': ['ubuntu-slim', `the fan-in check, at the tail of every run; ${SHORT}`],
  'tenant-scope-lint': ['ubuntu-slim', SHORT],
  'chrome-i18n-coverage': ['ubuntu-slim', SHORT],
  'check-no-internal-specs': ['ubuntu-slim', SHORT],
  'check-ee-imports': ['ubuntu-slim', `${SHORT}; it reads secrets.PRIVATE_LEAK_SYMBOLS, and no secret reaches the pool`],
  'check-surface-funnel': ['ubuntu-slim', SHORT],
  'check-pricing-leaks': ['ubuntu-slim', SHORT],
  'check-public-surface': ['ubuntu-slim', SHORT],
  'check-billing-dumps': ['ubuntu-slim', SHORT],
  'changeset-guard': ['ubuntu-slim', SHORT],
  changes: ['ubuntu-slim', 'runs the gh CLI (the runner image has none) and heads every path'],
  'attribute-dev-failure': ['ubuntu-latest', 'runs the gh CLI (the runner image has none)'],
  'remotion-tests': ['ubuntu-latest', "renders with the hosted runner's Chrome; the image has neither Chrome nor its shared libraries"],
  'ffmpeg-ledger-redis': ['ubuntu-latest', 'a Redis service container (no Docker on the pool)'],
  'migration-behavior': ['ubuntu-latest', 'a Postgres service container (no Docker on the pool)'],
  characterize: ['ubuntu-latest', 'a job container (no Docker on the pool)'],
  migrate: ['ubuntu-latest', 'production database credentials'],
}
const POOL = `fromJSON('["self-hosted", "linux", "x64", "nodaro-ci"]')`
const VERIFIED_PREFIX = "needs.changes.outputs.mode == 'verified' && 'ubuntu-slim' || "
const runsOn = (name) => jobs[name].match(/^    runs-on: (.+)$/m)?.[1]
const expressionOf = (name) => runsOn(name).match(/^\$\{\{ (.+) \}\}$/)?.[1]
// The routing condition with the verified prefix and the hosted fallback removed.
const coreOf = (name) => {
  let expression = expressionOf(name)
  if (VERIFIED_ON_SLIM.includes(name)) expression = expression.slice(VERIFIED_PREFIX.length)
  return expression.slice(0, -` || '${RAILWAY_JOBS[name]}'`.length)
}

test('every job is either routed to the Railway pool or listed as hosted, with a reason', () => {
  const all = Object.keys(jobs).filter((name) => runsOn(name))
  for (const name of all) assert.ok((name in RAILWAY_JOBS) !== (name in HOSTED_JOBS), `${name}: list it in exactly one of RAILWAY_JOBS / HOSTED_JOBS`)
  for (const name of [...Object.keys(RAILWAY_JOBS), ...Object.keys(HOSTED_JOBS)]) assert.ok(all.includes(name), `${name} is listed but is not a job`)
  for (const [name, [label, why]] of Object.entries(HOSTED_JOBS)) assert.equal(runsOn(name), label, `${name} stays on ${label}: ${why}`)
  // What the pool cannot do keeps a job hosted: Docker (services, a job
  // container) and the gh CLI.
  for (const name of Object.keys(RAILWAY_JOBS)) {
    assert.doesNotMatch(jobs[name], /^    (services|container):/m, `${name} needs Docker, which the pool lacks`)
    assert.doesNotMatch(jobs[name], /\bgh (api|pr|run)\b|ci-mode\.mjs/, `${name} runs the gh CLI, which the runner image lacks`)
    // No repository secret reaches the pool (decided 2026-10-20); github.token
    // is the job's own short-lived token, not a repository secret.
    assert.doesNotMatch(jobs[name], /secrets\./, `${name} reads a repository secret; keep it hosted`)
  }
})

test('every Railway job routes through the one shared expression', () => {
  const reference = coreOf('frontend-test-shards')
  assert.ok(reference.startsWith("github.repository == 'nodaroai/app.nodaro.ai-internal' && "), reference)
  assert.ok(reference.endsWith(` && ${POOL}`), reference)
  for (const name of Object.keys(RAILWAY_JOBS)) {
    const expression = expressionOf(name)
    assert.ok(expression, `${name}: runs-on must be a single expression`)
    assert.equal(expression.startsWith(VERIFIED_PREFIX), VERIFIED_ON_SLIM.includes(name),
      `${name}: only ${VERIFIED_ON_SLIM.join(', ')} drop to ubuntu-slim on a verified tree`)
    assert.ok(expression.endsWith(` || '${RAILWAY_JOBS[name]}'`), `${name}: its hosted fallback stays ${RAILWAY_JOBS[name]}`)
    assert.equal(coreOf(name), reference, `${name}: copy the routing expression verbatim from frontend-test-shards`)
  }
})

// Prepare Shared Packages keeps the npm download cache current (setup-node
// saves it on a miss, hosted or not); every other job only restores it, so a
// Railway runner never uploads a second copy on its completion path.
test('one job saves the npm download cache; Railway jobs restore it', () => {
  assert.match(jobs['prepare-packages'], /^          cache: npm$/m)
  for (const name of Object.keys(RAILWAY_JOBS).filter((n) => n !== 'prepare-packages' && /run: npm ci$/m.test(jobs[n]))) {
    assert.doesNotMatch(jobs[name], /^          cache: npm$/m, `${name}: cache only on hosted runners`)
    assert.match(jobs[name], /^          cache: \$\{\{ runner\.environment == 'github-hosted' && 'npm' \|\| '' \}\}\n          package-manager-cache: false$/m, name)
    assert.match(jobs[name], /- name: Restore npm downloads on Railway\n(?: {8}if: .*\n)? {8}uses: actions\/cache\/restore@v4\n {8}continue-on-error: true\n {8}timeout-minutes: 2\n {8}with:\n {10}path: ~\/\.npm\n {10}key: node-cache-\$\{\{ runner\.os \}\}-x64-npm-\$\{\{ hashFiles\('package-lock\.json'\) \}\}\n/, name)
  }
})

for (const name of Object.keys(RAILWAY_JOBS)) test(`${name} preserves hosted fallback and excludes untrusted routing`, () => {
  const expression = expressionOf(name)
  const hosted = RAILWAY_JOBS[name]
  const repository = 'nodaroai/app.nodaro.ai-internal'
  const base = { repository, event_name: 'pull_request', ref: 'refs/pull/1/merge', head_ref: 'feat/pilot',
    event: { pull_request: { head: { repo: { full_name: repository } } } } }
  const route = (github, vars, mode = 'affected') => Function('github', 'vars', 'fromJSON', 'needs', `return (${expression})`)(github,
    { CI_RAILWAY_ENABLED: '', CI_RAILWAY_PILOT_BRANCH: '', ...vars }, JSON.parse, { changes: { outputs: { mode } } })
  assert.equal(route(base, {}), hosted)
  assert.equal(route(base, { CI_RAILWAY_PILOT_BRANCH: 'another-branch' }), hosted)
  assert.deepEqual(route(base, { CI_RAILWAY_PILOT_BRANCH: 'feat/pilot' }), ['self-hosted', 'linux', 'x64', 'nodaro-ci'])
  assert.deepEqual(route(base, { CI_RAILWAY_ENABLED: 'true' }), ['self-hosted', 'linux', 'x64', 'nodaro-ci'])
  assert.equal(route({ ...base, repository: 'public/mirror' }, { CI_RAILWAY_ENABLED: 'true' }), hosted)
  assert.equal(route({ ...base, event: { pull_request: { head: { repo: { full_name: 'outsider/fork' } } } } },
    { CI_RAILWAY_ENABLED: 'true', CI_RAILWAY_PILOT_BRANCH: 'feat/pilot' }), hosted)
  const main = { ...base, event_name: 'push', ref: 'refs/heads/main', head_ref: '', event: {} }
  assert.equal(route(main, { CI_RAILWAY_PILOT_BRANCH: 'feat/pilot' }), hosted)
  assert.deepEqual(route(main, { CI_RAILWAY_ENABLED: 'true' }), ['self-hosted', 'linux', 'x64', 'nodaro-ci'])
  assert.equal(route({ ...main, ref: 'refs/heads/other' }, { CI_RAILWAY_ENABLED: 'true' }), hosted)
  // The post-merge dev run uses the same pool as main.
  assert.deepEqual(route({ ...main, ref: 'refs/heads/dev' }, { CI_RAILWAY_ENABLED: 'true' }, 'post-merge'), ['self-hosted', 'linux', 'x64', 'nodaro-ci'])
  if (VERIFIED_ON_SLIM.includes(name)) {
    // A verified tree only prints its reason: the cheapest runner, whatever the routing.
    assert.equal(route(main, { CI_RAILWAY_ENABLED: 'true' }, 'verified'), 'ubuntu-slim')
    assert.equal(route(base, { CI_RAILWAY_ENABLED: 'true' }, 'verified'), 'ubuntu-slim')
  } else {
    // Everything else does its full work on a verified main push.
    assert.deepEqual(route(main, { CI_RAILWAY_ENABLED: 'true' }, 'verified'), ['self-hosted', 'linux', 'x64', 'nodaro-ci'])
    assert.equal(route(main, {}, 'verified'), hosted)
  }
})

// decided 2026-10-13: PRs into dev run in shadow mode until the repository
// variable flips; shadow never changes a result; post-merge re-runs only label.
test('shadow mode is wired end to end and can never redden or shorten a run', () => {
  assert.match(jobs.changes, /TEST_SELECT_ENFORCE: \$\{\{ vars\.TEST_SELECT_ENFORCE \}\}\n        run: node tools\/test-select\/ci-mode\.mjs/)
  for (const project of ['frontend', 'backend']) {
    const job = jobs[`${project}-test-shards`]
    // the selector runs with --shadow, and a selector failure falls back to a full run
    assert.match(job, new RegExp(`elif \\[ "\\$MODE" = "shadow" \\]; then[\\s\\S]*?if ! node tools/test-select/cli\\.mjs --project ${project} [\\s\\S]*?--shadow 2> "\\$RUNNER_TEMP/select-${project}\\.err"; then\\n(?:\\s*cat .*\\n)\\s*echo "selection=full" >> "\\$GITHUB_OUTPUT"`))
    // ...and the crash is recorded where the shadow check writes, for the shadow artifact
    assert.match(job, new RegExp(`error: "selector crashed: " \\+ msg, crashed: true[\\s\\S]*?"\\$RUNNER_TEMP/shadow-${project}\\.json" \\|\\| true`))
    assert.match(job, /case "\$MODE" in post-merge\) sel=post-merge ;; \*\) sel=full ;; esac/)
    assert.match(job, new RegExp(`SHADOW_SELECTION: \\$\\{\\{ steps\\.select\\.outputs\\.shadow_selection \\}\\}\\n\\s*SHADOW_OUT: \\$\\{\\{ runner\\.temp \\}\\}/shadow-${project}\\.json\\n\\s*PROJECT: ${project}\\n\\s*SHARD: \\$\\{\\{ matrix\\.shard \\}\\}/4\\n\\s*RUN_LIST: \\$\\{\\{ runner\\.temp \\}\\}/run-${project}\\.txt\\n\\s*run: bash \\.\\./tools/test-select/run-suite\\.sh`))
    // gated on the mode, so a crash (selection fell back to full) is uploaded too
    assert.match(job, new RegExp(`if: \\$\\{\\{ env\\.VERIFIED != 'true' && always\\(\\) && needs\\.changes\\.outputs\\.mode == 'shadow' \\}\\}\\n\\s*uses: actions/upload-artifact@v5\\n\\s*with:\\n\\s*name: shadow-${project}-\\$\\{\\{ matrix\\.shard \\}\\}\\n`))
    assert.match(job, new RegExp(`failed-${project}\\.txt\\n\\s*\\$\\{\\{ runner\\.temp \\}\\}/failed-${project}\\.txt\\.flaky\\n\\s*\\$\\{\\{ runner\\.temp \\}\\}/failed-${project}\\.txt\\.unknown\\n\\s*if-no-files-found: ignore`))
  }
  assert.match(readFileSync('tools/test-select/run-suite.sh', 'utf8'), /^  shadow\)$/m)
  // failed / flaky / unknown all reach the comment (failed-lists.mjs reads the three).
  assert.match(jobs['attribute-dev-failure'], /\.\.\.readFailedLists\(process\.env\.FAILED_DIR\),/)
})

test('nightly coverage can never mark main red (its checks land on main HEAD, which gates deploys)', () => {
  const nightly = readFileSync('.github/workflows/nightly-coverage.yml', 'utf8')
  // job level: a failed setup step cannot turn the run red either
  assert.equal(nightly.match(/^    timeout-minutes: 90\n    continue-on-error: true\n/gm)?.length, 2)
  assert.equal(nightly.match(/^    runs-on: /gm)?.length, 2, 'every job is covered')
  const steps = [...nightly.matchAll(/- name: Run tests with coverage\n        id: coverage\n        continue-on-error: true\n(?:        #.*\n)*        timeout-minutes: (\d+)\n/g)]
  assert.equal(steps.length, 2)
  for (const [, minutes] of steps) assert.ok(Number(minutes) < 90, 'the step times out before the job')
  assert.equal(nightly.match(/TESTS_OUTCOME: \$\{\{ steps\.coverage\.outcome \}\}/g)?.length, 2)
  // a job that hits its own timeout can conclude cancelled, which
  // continue-on-error does not cover: every step has a cap, and the caps sum
  // to well under the job's 90 minutes
  const nightlyJobs = nightly.split(/^  (?=[a-z]+:\n    name: )/m).slice(1)
  assert.equal(nightlyJobs.length, 2)
  for (const job of nightlyJobs) {
    const steps = job.split(/^      - /m).slice(1)
    assert.ok(steps.length >= 7, 'the job has its steps')
    const caps = steps.map((step) => Number(step.match(/^        timeout-minutes: (\d+)$/m)?.[1]))
    assert.ok(caps.every(Number.isFinite), `every step has a timeout:\n${steps.filter((_, i) => !Number.isFinite(caps[i])).join('')}`)
    assert.ok(caps.reduce((a, b) => a + b, 0) <= 80, `step timeouts sum to ${caps.reduce((a, b) => a + b, 0)}`)
  }
  // skipped (setup failed) is never reported as failed tests
  assert.equal(nightly.match(/outcome === "skipped" \|\| !outcome \? "⚠️ no tests ran/g)?.length, 2)
})

test('Type Check runs its four checks concurrently, type checking on TypeScript 7', () => {
  const job = jobs.typecheck
  assert.match(job, /^    name: Type Check$/m, 'the required check keeps its name')
  for (const check of ['typecheck nice -n 19 env GOMEMLIMIT=4GiB npm run typecheck -- --serial', 'gen-skills nice -n 10 npm -w backend run gen:skills:check',
    'parity cross_tree_parity', 'surfaces nice -n 10 timeout 300 npm -w backend run check:surfaces -- --all']) {
    assert.match(job, new RegExp(`^          start ${check.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}`, 'm'), check)
  }
  assert.match(job, /npx vitest run --testTimeout=30000 "\$\{files\[@\]\}"/, 'parity tests get room next to the checker')
  assert.match(job, /wait "\$\{pid\[\$name\]\}"/, 'each check is waited on by PID for its own exit status')
  assert.match(job, /if \[ "\$name" = surfaces \]; then\n\s+echo "::warning::/, 'the surface report never fails the job')
  assert.doesNotMatch(job, /npx tsc/, 'type checking goes through `npm run typecheck`, not the root .bin/tsc (TS 5.9)')
})

test('boot smoke waits only for the compiled backend, not for Type Check', () => {
  assert.match(jobs['backend-boot-smoke'], /^    needs: \[build-backend\]$/m)
})


// Four shards per suite (decided 2026-10-14): the work runs in a matrix, and the
// required checks keep their names through a fan-in job that fails unless every
// shard passed or the whole suite was skipped by the Diff Gate.
for (const project of ['frontend', 'backend']) test(`${project}: four shards, one required check`, () => {
  const shards = jobs[`${project}-test-shards`]
  assert.match(shards, /^      fail-fast: false$/m)
  assert.match(shards, /^        shard: \[1, 2, 3, 4\]$/m)
  for (const kind of ['shadow', 'failed']) assert.match(shards, new RegExp(`name: ${kind}-${project}-\\$\\{\\{ matrix\\.shard \\}\\}\\n`))
  const fanIn = jobs[`${project}-tests`]
  const name = project === 'frontend' ? 'Frontend Tests' : 'Backend Tests'
  assert.match(fanIn, new RegExp(`^    name: ${name}$`, 'm'))
  assert.match(fanIn, new RegExp(`^    needs: \\[changes, ${project}-test-shards\\]$`, 'm'))
  assert.match(fanIn, /^    if: \$\{\{ !cancelled\(\) \}\}$/m)
  // the deciding check is the job's LAST step (the pass-cache steps before it are best-effort)
  const command = [...fanIn.matchAll(/        run: \|\n([\s\S]*?)(?=\n      - |\n\S|\n?$)/g)].at(-1)[1]
  assert.match(command, /RESULT/)
  const passes = (RESULT, GATE = 'success', SUITE = 'true') =>
    spawnSync('bash', ['-c', command], { env: { ...process.env, RESULT, GATE, SUITE } }).status === 0
  assert.equal(passes('success'), true)
  assert.equal(passes('failure'), false)
  assert.equal(passes('cancelled'), false)
  // skipped is green only when the Diff Gate ran and said the suite is not needed
  assert.equal(passes('skipped', 'success', 'false'), true)
  assert.equal(passes('skipped', 'success', 'true'), false)
  assert.equal(passes('skipped', 'failure', 'false'), false)
  assert.equal(passes('skipped', 'success', ''), false)
})

// One matching artifact is extracted straight into the download path, several
// into a subdirectory each — the reader is layout-free (failed-lists.mjs; the
// fixtures are in test-select-reporting.test.mjs), and the step must use it
// rather than a glob that assumes the subdirectories.
test('the dev failure attribution reads every shard\'s failed files', () => {
  const job = jobs['attribute-dev-failure']
  assert.match(job, /pattern: failed-\*\n\s*path: \$\{\{ runner\.temp \}\}\/failed\n/)
  assert.match(job, /FAILED_DIR: \$\{\{ runner\.temp \}\}\/failed\n/)
  assert.match(job, /import \{ readFailedLists \} from "\.\/tools\/test-select\/failed-lists\.mjs"/)
  assert.doesNotMatch(job, /failed-"\$1"-\*/)
})

// The pass cache (§5.6): only a pull request outside shadow mode may skip a
// file — a push is evidence, and shadow mode is the selector's evidence
// (decided 2026-10-14).
for (const project of ['frontend', 'backend']) test(`${project}: only an enforced PR run skips cached files`, () => {
  const shards = jobs[`${project}-test-shards`]
  const restore = shards.match(/- name: Restore the pass cache\n {8}if: \$\{\{ (.+) \}\}/)[1]
  assert.match(restore, /github\.event_name == 'pull_request'/)
  assert.match(restore, /steps\.select\.outputs\.selection != 'shadow'/)
  assert.match(shards, /if \[ "\$\{\{ github\.event_name \}\}" = pull_request \] && \[ "\$SELECTION" != shadow \]; then cp "\$RUNNER_TEMP\/planned-/)
  const suite = readFileSync('tools/test-select/run-suite.sh', 'utf8')
  assert.match(suite, /\[ "\$\{GITHUB_EVENT_NAME:-\}" = pull_request \] && \[ "\$\{SELECTION:-\}" != post-merge \]/)
})
