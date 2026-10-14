/**
 * Derive per-second provider rates for duration composites.
 *
 * Joins per-task KIE billing (scripts/kie-actual-billing.mts --per-task) to our
 * jobs by provider_task_id, then to the composite identifier via
 * usage_logs.action. That yields (duration, real cost) pairs — the only source
 * that can produce a per-second RATE:
 *   - jobs.provider_cost is the reserve ESTIMATE for fixed-priced KIE providers
 *     (flat across every duration), so it cannot expose a rate
 *   - aggregated kie-actual averages across durations, so neither can it
 *
 * Read-only. Run:
 *   cd backend && set -a && source .env && set +a
 *   npx tsx scripts/per-second-rates.mts kie-per-task.json > per-second-rates.json
 */
// @reads-none reads only the JSON file named on its command line
import { readFileSync } from "node:fs"

const URL = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY || URL === "http://stub") throw new Error("real SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required")

const perTaskPath = process.argv[2]
if (!perTaskPath) throw new Error("usage: per-second-rates.mts <kie-per-task.json>")
const perTask = JSON.parse(readFileSync(perTaskPath, "utf8")) as {
  tasks: { taskId: string; kieModel: string; ourKeys: string[]; kieCredits: number; usd: number }[]
}
const costByTask = new Map(perTask.tasks.map(t => [t.taskId, t]))
console.error(`[rates] per-task cost records: ${costByTask.size}`)

type JobRow = { provider_task_id: string | null; usage_logs: { action: string | null }[] | { action: string | null } | null }
const jobs: JobRow[] = []
for (let offset = 0; ; offset += 1000) {
  const res = await fetch(
    `${URL}/rest/v1/jobs?select=provider_task_id,usage_logs(action)&provider_task_id=not.is.null&limit=1000&offset=${offset}`,
    { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } },
  )
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  const page = (await res.json()) as JobRow[]
  jobs.push(...page)
  if (page.length < 1000) break
}
console.error(`[rates] jobs with a provider_task_id: ${jobs.length}`)

const actionOf = (j: JobRow) => {
  const ul = j.usage_logs
  return (Array.isArray(ul) ? ul[0]?.action : ul?.action) ?? null
}

/** Pull the duration in seconds out of a composite id (`:8s`, `:12s:720p`). */
const durationOf = (id: string): number | null => {
  const m = /:(\d+)s(?::|$)/.exec(id)
  return m ? Number(m[1]) : null
}

/** The variant key with the duration removed: `seedance-2:8s:480p` ->
 *  `seedance-2:*:480p`. Grouping on the BASE alone merges resolutions, which
 *  makes a genuinely per-second model look flat (seedance-2's 480p and 1080p
 *  rows averaged together read as "NOT per-second"). */
const variantKey = (id: string) => id.replace(/:(\d+)s(?=:|$)/, ":*s")

interface Pair { id: string; base: string; duration: number; usd: number }
const pairs: Pair[] = []
let joined = 0
for (const j of jobs) {
  const id = actionOf(j)
  const cost = j.provider_task_id ? costByTask.get(j.provider_task_id) : undefined
  if (!id || !cost) continue
  joined++
  const d = durationOf(id)
  if (d && d > 0) pairs.push({ id, base: variantKey(id), duration: d, usd: cost.usd })
}
console.error(`[rates] taskId joins: ${joined}   with a parsed duration: ${pairs.length}`)
if (joined === 0) throw new Error("VACUOUS — no taskId joined; do not report a result")

// Per (base, duration): the modal cost — the real price of that exact variant.
const byCell = new Map<string, number[]>()
for (const p of pairs) {
  const k = `${p.base}|${p.duration}`
  ;(byCell.get(k) ?? byCell.set(k, []).get(k)!).push(p.usd)
}
const modal = (xs: number[]) => {
  const c = new Map<number, number>()
  for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1)
  return [...c.entries()].reduce((b, e) => (e[1] > b[1] ? e : b))[0]
}

const byBase = new Map<string, { duration: number; usd: number; n: number }[]>()
for (const [k, xs] of byCell) {
  const [base, d] = k.split("|")
  ;(byBase.get(base) ?? byBase.set(base, []).get(base)!).push({ duration: Number(d), usd: modal(xs), n: xs.length })
}

const out = [...byBase.entries()]
  .map(([base, cells]) => {
    cells.sort((a, b) => a.duration - b.duration)
    // Least-squares through the origin: rate = sum(d*usd) / sum(d^2). Weighted
    // by observation count so a one-off duration cannot swing the fit.
    const num = cells.reduce((s, c) => s + c.n * c.duration * c.usd, 0)
    const den = cells.reduce((s, c) => s + c.n * c.duration * c.duration, 0)
    const rate = den > 0 ? num / den : null
    // Does a pure per-second model actually explain the data?
    const maxErr = rate
      ? Math.max(...cells.map(c => Math.abs(c.usd - rate * c.duration) / Math.max(c.usd, 1e-9)))
      : 1
    return {
      base,
      usdPerSecond: rate ? Math.round(rate * 1e6) / 1e6 : null,
      fit: maxErr < 0.10 ? "per-second" : maxErr < 0.30 ? "approx-per-second" : "NOT-per-second (flat or tiered)",
      maxRelError: Math.round(maxErr * 1000) / 10,
      observations: cells.reduce((s, c) => s + c.n, 0),
      cells,
    }
  })
  .sort((a, b) => b.observations - a.observations)

console.error(`[rates] duration-bearing families: ${out.length}`)

// PRIMARY PRODUCT: the modal real cost of each EXACT composite that was
// observed. This beats a fitted per-second rate wherever it exists — it is the
// price that variant actually billed, with no model assumption at all. The
// fitted rate below is only a fallback for durations never observed.
const observedCells: Record<string, { usd: number; n: number }> = {}
for (const [k, xs] of byCell) {
  const [variant, d] = k.split("|")
  const id = variant.replace(":*s", `:${d}s`)
  observedCells[id] = { usd: modal(xs), n: xs.length }
}
console.error(`[rates] exact composites priced from observation: ${Object.keys(observedCells).length}`)

console.log(JSON.stringify({
  collectedAt: new Date().toISOString(),
  joinedTasks: joined,
  observedCells,
  families: out,
}, null, 2))
