/**
 * A4 — rounding-impact replay.
 *
 * Replays every real production job through OLD pricing and the NEW prices in
 * the A2 sheet, to answer the migration's headline claim: "small jobs are no
 * longer harmed by ceil() rounding."
 *
 * Cost authority is jobs.provider_cost joined to the identifier via
 * usage_logs.action — NOT usage_logs.cost_usd, which is 0 in every production
 * row. For KIE-backed fixed-price models provider_cost is the reserve estimate
 * rather than a meter, so rows whose sheet entry came from the per-task join
 * are additionally replayed against that exact cost.
 *
 * Read-only. Run:
 *   cd backend && set -a && source .env && set +a
 *   npx tsx scripts/a4-replay.mts --sheet <a2-sheet.json> [--rates <rates.json>]
 */
import { readFileSync } from "node:fs"

const URL = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY || URL === "http://stub") throw new Error("real SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required")

const arg = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined }
const OLD_BASE = 0.02, NEW_BASE = 0.002

const sheet = JSON.parse(readFileSync(arg("--sheet")!, "utf8")) as {
  rows: { identifier: string; new_credits: number; old_credits: number | null; provider_usd: number | null; flag: string }[]
}
const byId = new Map(sheet.rows.map(r => [r.identifier, r]))

const ratesPath = arg("--rates")
const exact = new Map<string, number>()
if (ratesPath) {
  const cells = JSON.parse(readFileSync(ratesPath, "utf8")).observedCells as Record<string, { usd: number }>
  for (const [id, v] of Object.entries(cells)) exact.set(id, v.usd)
}

type Row = { credits: number | null; provider_cost: number | string | null; usage_logs: { action: string | null }[] | { action: string | null } | null }
const jobs: Row[] = []
for (let o = 0; ; o += 1000) {
  const r = await fetch(
    `${URL}/rest/v1/jobs?select=credits,provider_cost,usage_logs(action)&provider_cost=gt.0&limit=1000&offset=${o}`,
    { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  const p = (await r.json()) as Row[]
  jobs.push(...p)
  if (p.length < 1000) break
}
const actionOf = (j: Row) => { const u = j.usage_logs; return (Array.isArray(u) ? u[0]?.action : u?.action) ?? null }

interface Replay { id: string; cost: number; oldCr: number; newCr: number; oldRatio: number; newRatio: number }
const replays: Replay[] = []
let noSheet = 0
for (const j of jobs) {
  const id = actionOf(j)
  if (!id) continue
  const row = byId.get(id)
  if (!row) { noSheet++; continue }
  // Prefer the exact per-task cost where we have it; else the recorded one.
  const cost = exact.get(id) ?? Number(j.provider_cost)
  if (!Number.isFinite(cost) || cost <= 0) continue
  const oldCr = j.credits ?? row.old_credits ?? 0
  if (!oldCr) continue
  replays.push({
    id, cost, oldCr, newCr: row.new_credits,
    oldRatio: (oldCr * OLD_BASE) / cost,
    newRatio: (row.new_credits * NEW_BASE) / cost,
  })
}
console.error(`[a4] jobs=${jobs.length} replayed=${replays.length} no-sheet-row=${noSheet}`)
if (replays.length === 0) throw new Error("VACUOUS — nothing replayed")

const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }
const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(p * (s.length - 1))] }
const r2 = (n: number) => Math.round(n * 100) / 100

// The headline: small jobs (the ones ceil() hurt most) vs everything else.
const SMALL = 0.05 // provider cost under 5c — where a 1-credit floor bites hardest
const small = replays.filter(r => r.cost < SMALL)
const large = replays.filter(r => r.cost >= SMALL)

function band(label: string, rs: Replay[]) {
  if (!rs.length) return { label, n: 0 }
  return {
    label, n: rs.length,
    oldMedian: r2(med(rs.map(r => r.oldRatio))),
    newMedian: r2(med(rs.map(r => r.newRatio))),
    oldP95: r2(q(rs.map(r => r.oldRatio), 0.95)),
    newP95: r2(q(rs.map(r => r.newRatio), 0.95)),
    oldWorst: r2(Math.max(...rs.map(r => r.oldRatio))),
    newWorst: r2(Math.max(...rs.map(r => r.newRatio))),
  }
}

const bands = [band(`small (< $${SMALL})`, small), band(`large (>= $${SMALL})`, large), band("ALL", replays)]

// Per-identifier: where does the charge move most?
const byIdent = new Map<string, Replay[]>()
for (const r of replays) (byIdent.get(r.id) ?? byIdent.set(r.id, []).get(r.id)!).push(r)
const perId = [...byIdent.entries()].map(([id, rs]) => ({
  id, n: rs.length,
  oldRatio: r2(med(rs.map(r => r.oldRatio))),
  newRatio: r2(med(rs.map(r => r.newRatio))),
  oldUsd: r2(rs.reduce((s, r) => s + r.oldCr * OLD_BASE, 0)),
  newUsd: r2(rs.reduce((s, r) => s + r.newCr * NEW_BASE, 0)),
})).sort((a, b) => b.n - a.n)

// Rows whose ratio falls under 1 after the change.
const underRatio = perId.filter(p => p.newRatio < 1)

const totalOld = r2(replays.reduce((s, r) => s + r.oldCr * OLD_BASE, 0))
const totalNew = r2(replays.reduce((s, r) => s + r.newCr * NEW_BASE, 0))
const totalCost = r2(replays.reduce((s, r) => s + r.cost, 0))

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  replayed: replays.length,
  smallJobThresholdUsd: SMALL,
  bands,
  totals: { providerCostUsd: totalCost, chargedOldUsd: totalOld, chargedNewUsd: totalNew,
            oldRecovery: r2(totalOld / totalCost), newRecovery: r2(totalNew / totalCost) },
  belowCostAfter: belowCost,
  perIdentifier: perId,
}, null, 2))
