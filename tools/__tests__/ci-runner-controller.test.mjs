import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createController, MAX_SLOTS } from '../ci-runner/controller.mjs'

const service = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const env = { CI_REPOSITORY: 'example/private', RAILWAY_PROJECT_ID: 'project',
  RAILWAY_ENVIRONMENT_ID: 'ci', CI_GITHUB_TOKEN: 'github-secret', CI_RAILWAY_TOKEN: 'railway-secret',
  CI_RUNNER_SERVICES: service }
test('pool configuration supports thirty-two distinct slots and rejects excess or duplicate capacity', () => {
  assert.equal(MAX_SLOTS, 32)
  const ids = Array.from({ length: 33 }, (_, i) => `${i.toString(16).padStart(8, '0')}-aaaa-aaaa-aaaa-aaaaaaaaaaaa`)
  assert.doesNotThrow(() => createController({ env: { ...env, CI_RUNNER_SERVICES: ids.slice(0, 32).join(',') } }))
  assert.throws(() => createController({ env: { ...env, CI_RUNNER_SERVICES: ids.join(',') } }), /Invalid runner slots/)
  assert.throws(() => createController({ env: { ...env, CI_RUNNER_SERVICES: `${service},${service}` } }), /Invalid runner slots/)
})
function harness({ fork = false, busy = false, badGithub = false, badRailway = false, race = false, offline = false, deploymentStatus = 'SUCCESS', noQueued = false } = {}) {
  const calls = [], logs = []
  let discoveries = 0
  const request = async (url, options) => {
    const body = options.body ? JSON.parse(options.body) : null
    calls.push({ url, options, body })
    const respond = (value, status = 200) => new Response(JSON.stringify(value), { status })
    if (url.includes('railway.com')) {
      assert.equal(options.headers['Project-Access-Token'], env.CI_RAILWAY_TOKEN)
      assert.ok(!JSON.stringify(options).includes(env.CI_GITHUB_TOKEN))
      if (body.query.startsWith('query')) return respond({ data: { serviceInstance: {
        latestDeployment: { id: 'old-image', status: deploymentStatus, createdAt: '2026-01-01T00:00:00Z' },
      } } })
      if (badRailway) return respond({ errors: [{ message: 'DO NOT LOG SECRET' }] })
      return respond({ data: { done: true } })
    }
    assert.equal(options.headers.Authorization, `Bearer ${env.CI_GITHUB_TOKEN}`)
    assert.ok(!JSON.stringify(options).includes(env.CI_RAILWAY_TOKEN))
    if (badGithub) return respond({ message: 'DO NOT LOG SECRET' }, 403)
    if (url.includes('actions/runs?status=queued')) return respond({ workflow_runs: [
      { id: 1, head_repository: { full_name: fork ? 'outsider/fork' : env.CI_REPOSITORY } },
    ] })
    if (url.includes('actions/runs?status=in_progress')) return respond({ workflow_runs: [] })
    if (url.includes('actions/runs/1/jobs')) return respond({ jobs: noQueued ? [] : [{ status: 'queued', labels: ['nodaro-ci'] }] })
    if (url.includes('generate-jitconfig')) return respond({ runner: { id: 123 }, encoded_jit_config: 'single-use-jit' })
    if (options.method === 'DELETE') return new Response(null, { status: 204 })
    if (url.includes('actions/runners?')) {
      discoveries++
      if (offline) return respond({ runners: [{ id: 77, name: `nodaro-ci-${service}-pending`, busy: false, status: 'offline' }] })
      return respond({ runners: busy || (race && discoveries > 1)
        ? [{ name: `nodaro-ci-${service}-existing`, busy: true, status: 'online' }] : [] })
    }
    throw new Error(`Unexpected test request: ${url}`)
  }
  return { calls, logs, cycle: createController({ env, request, log: s => logs.push(s) }).cycle }
}
test('queued trusted work receives only a single-use credential in a fresh deployment', async () => {
  const h = harness()
  await h.cycle()
  const jit = h.calls.find(c => c.url.includes('generate-jitconfig'))
  assert.ok(jit.body.name.length <= 64, 'GitHub runner names must fit its API limit')
  assert.ok(jit.body.name.startsWith(`nodaro-ci-${service}-`))
  assert.deepEqual(jit.body.labels, ['self-hosted', 'linux', 'x64', 'nodaro-ci'])
  const update = h.calls.find(c => c.body?.query?.includes('variableCollectionUpsert'))
  assert.deepEqual(update.body.variables.input, { projectId: 'project', environmentId: 'ci',
    serviceId: service, skipDeploys: true, variables: { RUNNER_JIT_CONFIG: 'single-use-jit' } })
  const redeploy = h.calls.find(c => c.body?.query?.includes('deploymentRedeploy'))
  assert.deepEqual(redeploy.body.variables, { id: 'old-image' })
  assert.match(redeploy.body.query, /usePreviousImageTag:true/)
  assert.ok(!h.logs.join().includes('secret'))
})
test('fork work never provisions a runner', async () => {
  const h = harness({ fork: true }); await h.cycle()
  assert.ok(h.calls.every(c => c.options.method === 'GET' || c.body?.query?.startsWith('query')))
  assert.ok(h.calls.every(c => !c.url.includes('/1/jobs')))
})
test('an already busy slot is never redeployed', async () => {
  const h = harness({ busy: true }); await h.cycle()
  assert.ok(h.calls.every(c => !c.url.includes('generate-jitconfig')))
})
test('a job assigned during scheduling protects the slot on the second read', async () => {
  const h = harness({ race: true }); await h.cycle()
  assert.ok(h.calls.every(c => !c.url.includes('generate-jitconfig')))
})
test('GitHub failure stops provisioning and excludes response bodies from errors', async () => {
  const h = harness({ badGithub: true })
  await assert.rejects(h.cycle(), error => /403/.test(error.message) && !/SECRET/.test(error.message))
  assert.ok(h.calls.every(c => c.options.method === 'GET'))
})
test('failed provisioning removes exactly its new identity and reports no secrets', async () => {
  const h = harness({ badRailway: true })
  await assert.rejects(h.cycle(), /Railway request failed/)
  assert.deepEqual(h.calls.filter(c => c.options.method === 'DELETE').map(c => c.url),
    ['https://api.github.com/repos/example/private/actions/runners/123'])
})
test('an identity whose slot is still deploying is never retired, however long the deploy takes', async () => {
  // A Railway deploy slower than five minutes used to lose its runner: the
  // identity was deleted before the container could connect, the runner
  // exited ("registration has been deleted"), and the slot looped.
  for (const deploymentStatus of ['BUILDING', 'DEPLOYING', 'INITIALIZING', 'QUEUED', 'WAITING']) {
    const h = harness({ offline: true, deploymentStatus, noQueued: true }); await h.cycle()
    assert.ok(h.calls.every(c => c.options.method !== 'DELETE'), deploymentStatus)
  }
})
test('an offline identity on a finished, older deployment is still retired', async () => {
  const h = harness({ offline: true, noQueued: true }); await h.cycle()
  assert.deepEqual(h.calls.filter(c => c.options.method === 'DELETE').map(c => c.url),
    ['https://api.github.com/repos/example/private/actions/runners/77'])
})
