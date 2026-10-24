import { randomUUID } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { chooseSlots, DEPLOYMENT_IN_PROGRESS, runnerPrefix } from './pool.mjs'

// One Railway status query per slot every 30 s cycle: 32 slots is ~3,840
// requests an hour, well inside the Pro plan's 10,000 an hour
// (docs.railway.com/integrations/api#rate-limits), with room for the
// provisioning mutations. Raised from 20 for four test shards per suite.
export const MAX_SLOTS = 32

// This process never executes repository code and has no HTTP listener.
// Only this controller receives the scoped GitHub and Railway admin tokens.
export function createController({ env = process.env, request = fetch, log = console.log } = {}) {
  const required = name => {
    const value = env[name]
    if (!value) throw new Error(`Missing ${name}`)
    return value
  }
  const repo = required('CI_REPOSITORY')
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Invalid CI_REPOSITORY')
  const projectId = required('RAILWAY_PROJECT_ID')
  const environmentId = required('RAILWAY_ENVIRONMENT_ID')
  const githubToken = required('CI_GITHUB_TOKEN')
  const railwayToken = required('CI_RAILWAY_TOKEN')
  const slots = required('CI_RUNNER_SERVICES').split(',')
  if (!slots.length || slots.length > MAX_SLOTS || new Set(slots).size !== slots.length || slots.some(id => !/^[a-f0-9-]{36}$/.test(id))) throw new Error('Invalid runner slots')

  async function gh(path, method = 'GET', body) {
    const response = await request(`https://api.github.com/repos/${repo}/${path}`, {
      method, headers: { Authorization: `Bearer ${githubToken}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) throw new Error(`GitHub ${method} ${path.split('?')[0]}: ${response.status}`)
    return response.status === 204 ? null : response.json()
  }
  async function list(path, key) {
    const result = []
    for (let page = 1; page <= 10; page++) {
      const data = await gh(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`)
      if (!Array.isArray(data[key])) throw new Error('Incomplete GitHub response')
      result.push(...data[key])
      if (data[key].length < 100) return result
    }
    throw new Error('GitHub pagination limit: refusing incomplete scheduling snapshot')
  }
  async function railway(query, variables) {
    const response = await request('https://backboard.railway.com/graphql/v2', {
      method: 'POST', headers: { 'Project-Access-Token': railwayToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) throw new Error(`Railway HTTP ${response.status}`)
    const data = await response.json()
    if (data.errors?.length || !data.data) throw new Error('Railway request failed')
    return data.data
  }
  async function cycle() {
    const snapshots = (await Promise.all(['queued', 'in_progress'].map(status => list(`actions/runs?status=${status}`, 'workflow_runs')))).flat()
    const runs = [...new Map(snapshots.map(run => [run.id, run])).values()]
    const jobs = []
    for (const run of runs) {
      // Fork code never provisions private compute, even if it asks for the label.
      if (run.head_repository?.full_name !== repo) continue
      jobs.push(...await list(`actions/runs/${run.id}/jobs`, 'jobs'))
    }
    const queued = jobs.filter(j => j.status === 'queued' && j.labels?.includes('nodaro-ci')).length
    const runners = await list('actions/runners', 'runners')
    const state = await Promise.all(slots.map(async id => {
      const data = await railway('query($serviceId:String!,$environmentId:String!){serviceInstance(serviceId:$serviceId,environmentId:$environmentId){latestDeployment{id status createdAt}}}', { serviceId: id, environmentId })
      return { id, deployment: data.serviceInstance.latestDeployment }
    }))
    const selected = chooseSlots({ slots: state, runners, jobs, queued })
    for (const id of selected) {
      // Re-check immediately before touching a slot; an idle runner may just
      // have received a job since the initial snapshot.
      const current = await list('actions/runners', 'runners')
      if (current.some(r => r.name.startsWith(runnerPrefix(id)) && (r.busy || r.status === 'online'))) continue
      const jit = await gh('actions/runners/generate-jitconfig', 'POST', {
        // GitHub caps names at 64 characters; the slot prefix uses 47.
        name: `${runnerPrefix(id)}${randomUUID().replaceAll('-', '').slice(0, 16)}`, runner_group_id: 1,
        labels: ['self-hosted', 'linux', 'x64', 'nodaro-ci'], work_folder: '_work',
      })
      try {
        await railway('mutation($input:VariableCollectionUpsertInput!){variableCollectionUpsert(input:$input)}', {
          input: { projectId, environmentId, serviceId: id, skipDeploys: true,
            variables: { RUNNER_JIT_CONFIG: jit.encoded_jit_config } },
        })
        const deployment = state.find(s => s.id === id).deployment
        await railway('mutation($id:String!){deploymentRedeploy(id:$id,usePreviousImageTag:true){id}}', { id: deployment.id })
        log(`Provisioned runner slot ${id}`)
      } catch (error) {
        // Remove only the JIT identity created by this failed provisioning.
        await gh(`actions/runners/${jit.runner.id}`, 'DELETE').catch(() => {})
        throw error
      }
    }
    // Retire disconnected identities belonging to this pool, never other runners.
    for (const runner of runners) {
      const slot = state.find(s => runner.name.startsWith(runnerPrefix(s.id)))
      if (!slot || runner.busy || runner.status !== 'offline' || selected.includes(slot.id)) continue
      // A slot still deploying has not had its chance to connect yet: retiring
      // its identity now makes the runner exit on arrival ("registration has
      // been deleted") and the slot loops while Railway is slow.
      if (DEPLOYMENT_IN_PROGRESS.includes(slot.deployment?.status)) continue
      if (Date.now() - Date.parse(slot.deployment?.createdAt) < 300_000) continue
      if (jobs.some(j => j.status === 'in_progress' && j.runner_name === runner.name)) continue
      await gh(`actions/runners/${runner.id}`, 'DELETE')
    }
  }
  return { cycle }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { cycle } = createController()
  let stopped = false
  process.on('SIGTERM', () => { stopped = true })
  process.on('SIGINT', () => { stopped = true })
  while (!stopped) {
    try { await cycle() } catch (error) { console.error(error.message) }
    if (!stopped) await setTimeout(30_000)
  }
}
