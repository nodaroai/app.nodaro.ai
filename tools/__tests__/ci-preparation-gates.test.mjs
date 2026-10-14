import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8')
const jobs = Object.fromEntries([...workflow.matchAll(/^  ([\w-]+):\n([\s\S]*?)(?=^  [\w-]+:\n|$(?![\s\S]))/gm)]
  .map(([, name, body]) => [name, body]))
const consumers = ['frontend-tests', 'backend-tests', 'typecheck', 'remotion-tests', 'characterize', 'build-backend', 'backend-boot-smoke']

for (const name of consumers) test(`${name} fails closed when preparation fails or is skipped`, () => {
  const job = jobs[name]
  const condition = job.match(/^    if: \$\{\{ (.+) \}\}$/m)?.[1]
  assert.ok(condition?.includes('!cancelled()'), 'must run its failure assertion after failed dependencies')
  const command = job.match(/- name: Require successful preparation\n[\s\S]*?        run: (.+)/)?.[1]
  assert.ok(command, 'failure assertion must precede checkout and expensive work')
  assert.ok(job.indexOf('Require successful preparation') < job.indexOf('actions/checkout'))
  for (const result of ['success', 'failure', 'skipped', 'cancelled']) {
    const needs = {
      changes: { result: 'success', outputs: { frontend: 'false', backend: 'false' } },
      'prepare-packages': { result }, typecheck: { result }, 'build-backend': { result },
    }
    const shouldRun = Function('needs', 'cancelled', `return (${condition.replace(/needs\.([a-z-]+)/g, "needs['$1']")})`)(needs, () => false)
    if (['frontend-tests', 'backend-tests'].includes(name) && result === 'success') {
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
    'check-locale-completeness', 'check-ee-imports', 'check-pricing-leaks', 'check-billing-dumps',
    'check-public-surface', 'check-surface-funnel', 'i18n-completeness', 'backend-boot-smoke',
    'migration-behavior', 'prepare-packages', 'build-backend']) assert.ok(needs.includes(name), name)
  assert.match(jobs.migrate, /github\.ref == 'refs\/heads\/main' && github\.event_name == 'push'/)
})

test('both edition probes and coverage commands survive preparation sharing', () => {
  assert.match(jobs['backend-boot-smoke'], /edition: \[cloud, community\]/)
  assert.match(jobs['backend-boot-smoke'], /WEBHOOK_STATUS.*404/)
  // Both suites run through the shared runner, whose post-merge mode is the
  // full suite on every dev commit; coverage moved to the nightly workflow,
  // which must still measure both projects.
  for (const name of ['frontend-tests', 'backend-tests']) assert.match(jobs[name], /run: bash \.\.\/tools\/test-select\/run-suite\.sh/)
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
  for (const name of ['frontend-tests', 'backend-tests', 'typecheck']) {
    assert.doesNotMatch(jobs[name], /always\(\) && steps\.build-packages/)
    assert.match(jobs[name], /!cancelled\(\) && steps\.build-packages/)
  }
})

for (const name of ['frontend-tests', 'backend-tests']) test(`${name} preserves hosted fallback and excludes untrusted routing`, () => {
  const expression = jobs[name].match(/^    runs-on: \$\{\{ (.+) \}\}$/m)[1]
  const repository = 'nodaroai/app.nodaro.ai-internal'
  const base = { repository, event_name: 'pull_request', ref: 'refs/pull/1/merge', head_ref: 'feat/pilot',
    event: { pull_request: { head: { repo: { full_name: repository } } } } }
  const route = (github, vars, mode = 'affected') => Function('github', 'vars', 'fromJSON', 'needs', `return (${expression})`)(github,
    { CI_RAILWAY_ENABLED: '', CI_RAILWAY_PILOT_BRANCH: '', ...vars }, JSON.parse, { changes: { outputs: { mode } } })
  assert.equal(route(base, {}), 'ubuntu-latest')
  assert.equal(route(base, { CI_RAILWAY_PILOT_BRANCH: 'another-branch' }), 'ubuntu-latest')
  assert.deepEqual(route(base, { CI_RAILWAY_PILOT_BRANCH: 'feat/pilot' }), ['self-hosted', 'linux', 'x64', 'nodaro-ci'])
  assert.deepEqual(route(base, { CI_RAILWAY_ENABLED: 'true' }), ['self-hosted', 'linux', 'x64', 'nodaro-ci'])
  assert.equal(route({ ...base, repository: 'public/mirror' }, { CI_RAILWAY_ENABLED: 'true' }), 'ubuntu-latest')
  assert.equal(route({ ...base, event: { pull_request: { head: { repo: { full_name: 'outsider/fork' } } } } },
    { CI_RAILWAY_ENABLED: 'true', CI_RAILWAY_PILOT_BRANCH: 'feat/pilot' }), 'ubuntu-latest')
  const main = { ...base, event_name: 'push', ref: 'refs/heads/main', head_ref: '', event: {} }
  assert.equal(route(main, { CI_RAILWAY_PILOT_BRANCH: 'feat/pilot' }), 'ubuntu-latest')
  assert.deepEqual(route(main, { CI_RAILWAY_ENABLED: 'true' }), ['self-hosted', 'linux', 'x64', 'nodaro-ci'])
  assert.equal(route({ ...main, ref: 'refs/heads/other' }, { CI_RAILWAY_ENABLED: 'true' }), 'ubuntu-latest')
  // The post-merge dev run uses the same pool as main.
  assert.deepEqual(route({ ...main, ref: 'refs/heads/dev' }, { CI_RAILWAY_ENABLED: 'true' }, 'post-merge'), ['self-hosted', 'linux', 'x64', 'nodaro-ci'])
  // A verified tree only prints its reason: the cheapest runner, whatever the routing.
  assert.equal(route(main, { CI_RAILWAY_ENABLED: 'true' }, 'verified'), 'ubuntu-slim')
  assert.equal(route(base, { CI_RAILWAY_ENABLED: 'true' }, 'verified'), 'ubuntu-slim')
})

// decided 2026-10-13: PRs into dev run in shadow mode until the repository
// variable flips; shadow never changes a result; post-merge re-runs only label.
test('shadow mode is wired end to end and can never redden or shorten a run', () => {
  assert.match(jobs.changes, /TEST_SELECT_ENFORCE: \$\{\{ vars\.TEST_SELECT_ENFORCE \}\}\n        run: node tools\/test-select\/ci-mode\.mjs/)
  for (const project of ['frontend', 'backend']) {
    const job = jobs[`${project}-tests`]
    // the selector runs with --shadow, and a selector failure falls back to a full run
    assert.match(job, new RegExp(`elif \\[ "\\$MODE" = "shadow" \\]; then[\\s\\S]*?if ! node tools/test-select/cli\\.mjs --project ${project} [\\s\\S]*?--shadow 2> "\\$RUNNER_TEMP/select-${project}\\.err"; then\\n(?:\\s*cat .*\\n)\\s*echo "selection=full" >> "\\$GITHUB_OUTPUT"`))
    // ...and the crash is recorded where the shadow check writes, for the shadow artifact
    assert.match(job, new RegExp(`error: "selector crashed: " \\+ msg, crashed: true[\\s\\S]*?"\\$RUNNER_TEMP/shadow-${project}\\.json" \\|\\| true`))
    assert.match(job, /case "\$MODE" in post-merge\) sel=post-merge ;; \*\) sel=full ;; esac/)
    assert.match(job, new RegExp(`SHADOW_SELECTION: \\$\\{\\{ steps\\.select\\.outputs\\.shadow_selection \\}\\}\\n\\s*SHADOW_OUT: \\$\\{\\{ runner\\.temp \\}\\}/shadow-${project}\\.json\\n\\s*PROJECT: ${project}\\n\\s*run: bash \\.\\./tools/test-select/run-suite\\.sh`))
    // gated on the mode, so a crash (selection fell back to full) is uploaded too
    assert.match(job, new RegExp(`if: \\$\\{\\{ env\\.VERIFIED != 'true' && always\\(\\) && needs\\.changes\\.outputs\\.mode == 'shadow' \\}\\}\\n\\s*uses: actions/upload-artifact@v5\\n\\s*with:\\n\\s*name: shadow-${project}\\n`))
    assert.match(job, new RegExp(`failed-${project}\\.txt\\n\\s*\\$\\{\\{ runner\\.temp \\}\\}/failed-${project}\\.txt\\.flaky\\n\\s*\\$\\{\\{ runner\\.temp \\}\\}/failed-${project}\\.txt\\.unknown\\n\\s*if-no-files-found: ignore`))
  }
  assert.match(readFileSync('tools/test-select/run-suite.sh', 'utf8'), /^  shadow\)$/m)
  assert.match(jobs['attribute-dev-failure'], /flaky: \{ frontend: split\(process\.env\.FLAKY_FRONTEND\), backend: split\(process\.env\.FLAKY_BACKEND\) \}/)
  assert.match(jobs['attribute-dev-failure'], /unknown: \{ frontend: split\(process\.env\.UNKNOWN_FRONTEND\), backend: split\(process\.env\.UNKNOWN_BACKEND\) \}/)
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
