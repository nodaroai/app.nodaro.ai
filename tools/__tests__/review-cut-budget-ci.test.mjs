import assert from 'node:assert/strict'
import { test } from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

/**
 * The review inspector's real-browser cut budget runs in CI (decided
 * 2026-10-07): on every PR that touches the inspector or its model, in
 * Playwright's bundled Chromium, asserting 2× the 16 ms budget as a
 * regression tripwire. It is not a required check, so it lives in its own
 * workflow with a `paths:` filter, never in ci.yml.
 */
const WORKFLOW = '.github/workflows/review-cut-budget.yml'

test('the cut budget has its own workflow, not a ci.yml job', () => {
  assert.ok(existsSync(WORKFLOW), `${WORKFLOW} exists`)
  assert.doesNotMatch(readFileSync('.github/workflows/ci.yml', 'utf8'), /test:perf/)
})

test('it runs on PRs touching the inspector or the review model', () => {
  const workflow = readFileSync(WORKFLOW, 'utf8')
  assert.match(workflow, /^on:\n  pull_request:\n/m)
  for (const path of [
    'frontend/src/components/edl-review/**',
    'frontend/src/lib/edl-review/**',
    'frontend/src/hooks/use-review-*',
    'frontend/playwright/perf/**',
    'frontend/playwright.perf.config.ts',
    WORKFLOW,
  ]) assert.ok(workflow.includes(`- "${path}"`), `paths includes ${path}`)
})

test('it installs the bundled Chromium and asserts 2x the budget', () => {
  const workflow = readFileSync(WORKFLOW, 'utf8')
  assert.match(workflow, /npx playwright install --with-deps chromium/)
  assert.match(workflow, /run: npm run test:perf/)
  assert.match(workflow, /PERF_BUDGET_ALLOWANCE: "2"/)
  assert.doesNotMatch(workflow, /PERF_BROWSER_CHANNEL/)
})

test('the budget is 16 ms by default, scaled by the allowance', async () => {
  const { cutBudgetMs } = await import('../../frontend/playwright/perf/budget.mjs')
  assert.equal(cutBudgetMs({}), 16)
  assert.equal(cutBudgetMs({ PERF_BUDGET_ALLOWANCE: '' }), 16)
  assert.equal(cutBudgetMs({ PERF_BUDGET_ALLOWANCE: '2' }), 32)
  for (const bad of ['abc', '0', '-1', '0.5', 'Infinity']) {
    assert.throws(() => cutBudgetMs({ PERF_BUDGET_ALLOWANCE: bad }), /PERF_BUDGET_ALLOWANCE/)
  }
})
