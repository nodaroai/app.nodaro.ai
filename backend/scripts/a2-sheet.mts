/**
 * A2 sheet generator — the credit re-denomination repricing sheet.
 *
 * Emits one row per priced identifier (union of STATIC_CREDIT_COSTS and
 * model_pricing): basis classification, provider-$ authority, old credits,
 * new credits at the target base, delta vs mechanical x10, and flags.
 *
 * Policy (adjudicated 2026-07-30):
 *   - public identifiers re-derive to the base value at the new base
 *   - platform-compute (FFmpeg/utility) keeps the same $ (x10 credits)
 *   - worst-case reserve ceilings keep the same $ (x10) — they are holds,
 *     not prices; commit meters down
 *   - margin is runtime configuration (global + per-service), never baked in
 *
 * Authorities, per row (first available wins):
 *   1 kie-actual   — backend/kie-actual.json (dashboard-token collection)
 *   2 observed     — jobs.provider_cost per identifier (observed-costs.json)
 *   3 formula      — in-repo USD formulas (flux2 / ai-avatar / cinematic / switchx)
 *   4 models.ts    — KIE credit fields via buildModelMap (LAST resort, §5.2)
 *   5 EST          — no $ source; value-preserving x10, flagged EST
 * (Formula families are listed as authority 3 but actually rank FIRST for
 * their rows — the formula IS the price definition.)
 *
 * Check mode: --check-old-base re-derives every $-backed row at the CURRENT
 * base and compares to the shipped table — formula rows must reproduce
 * exactly (hard fail otherwise: the id parse is wrong); authority rows that
 * differ are the audit's findings, listed.
 *
 * Run (repo backend/):
 *   set -a; source .env; set +a   # real Supabase for the model_pricing join
 *   npx tsx scripts/a2-sheet.mts \
 *     --observed <observed-costs.json> --kie-actual <kie-actual.json> \
 *     [--check-old-base] [--csv] > a2-sheet.json
 */
import { readFileSync } from "node:fs"
import { STATIC_CREDIT_COSTS } from "../src/ee/billing/credits.js"
import { buildModelMap } from "../src/ee/routes/admin-credit-audit.js"
import { flux2CostUsd } from "../src/lib/pricing/flux2-cost.js"
import { aiAvatarUsdCost } from "../src/lib/pricing/ai-avatar-cost.js"
import { cinematicUsdCost } from "../src/lib/pricing/cinematic-avatar-cost.js"
import { SWITCHX_BLOCK_USD } from "../src/lib/pricing/switchx-cost.js"

const OLD_BASE = 0.02
const NEW_BASE = 0.002
const KIE_USD = 0.005

const arg = (name: string) => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const has = (name: string) => process.argv.includes(name)

const guardedCeil = (usd: number, base: number) => Math.ceil(Math.round((usd / base) * 1000) / 1000)

// ---------- inputs ----------
const S = STATIC_CREDIT_COSTS as Record<string, number>

const observedPath = arg("--observed")
const observed = new Map<string, { p50Usd: number; n: number; minUsd: number; maxUsd: number }>()
if (observedPath) {
  for (const m of JSON.parse(readFileSync(observedPath, "utf8")).models) observed.set(m.identifier, m)
}

const kieActualPath = arg("--kie-actual")
interface KieAgg { modalUsd: number; avgUsd: number; tasks: number; variable: boolean; buckets: { usd: number; n: number }[]; fanout: number }
const kieActual = new Map<string, KieAgg>()
if (kieActualPath) {
  for (const m of JSON.parse(readFileSync(kieActualPath, "utf8")).models) {
    // The MODAL bucket is the flat price; the mean is meaningless when a model
    // bills per-second (seedance-2 averages $1.48 across $0.46-$6.12) or has a
    // rare outlier tier. Buckets are kept so composites can be split per variant.
    const buckets = Object.entries(m.costBuckets as Record<string, number>)
      .map(([kieCr, n]) => ({ usd: Number(kieCr) * KIE_USD, n }))
      .sort((a, b) => a.usd - b.usd)
    const modal = buckets.reduce((best, b) => (b.n > best.n ? b : best), buckets[0])
    for (const ourKey of m.ourKeys as string[]) {
      const prev = kieActual.get(ourKey)
      if (!prev || m.tasks > prev.tasks) {
        kieActual.set(ourKey, { modalUsd: modal.usd, avgUsd: m.avgUsd, tasks: m.tasks, variable: m.variable, buckets, fanout: (m.ourKeys as string[]).length })
      }
    }
  }
}

/**
 * Per-variant price for a resolution/quality composite.
 *
 * A KIE model with N distinct cost buckets and N shipped variants maps
 * ascending-cost -> ascending-variant (a 4K render never costs less than 1K).
 * The hypothesis is VALIDATED, not assumed: nano-banana-pro's two buckets
 * ($0.09/$0.12) reproduce its shipped 5/6 credits exactly at the old base.
 * Where the counts do not line up, the row is flagged VARIANT-SPLIT for
 * explicit adjudication rather than guessed.
 */
function variantUsd(baseId: string, id: string, agg: KieAgg, allIds: string[]): { usd: number; exact: boolean } | null {
  if (agg.buckets.length <= 1) return { usd: agg.modalUsd, exact: true }
  const family = allIds
    .filter(k => k === baseId || k.startsWith(`${baseId}:`))
    .sort((a, b) => (S[a] ?? 0) - (S[b] ?? 0) || a.localeCompare(b))
  if (family.length !== agg.buckets.length) return null // counts disagree -> adjudicate
  const idx = family.indexOf(id)
  return idx >= 0 ? { usd: agg.buckets[idx].usd, exact: true } : null
}

// Exact per-composite costs from the per-task KIE join (scripts/per-second-rates.mts).
// Authority 0 — the strongest available: the real modal cost of that exact
// (variant, duration) combination, with no rate model assumed.
const ratesPath = arg("--rates")
const exactCells = new Map<string, { usd: number; n: number }>()
if (ratesPath) {
  const cells = JSON.parse(readFileSync(ratesPath, "utf8")).observedCells as Record<string, { usd: number; n: number }>
  for (const [id, v] of Object.entries(cells)) exactCells.set(id, v)
}

// models.ts KIE credits per ourKey (authority 4)
const modelsTs = new Map<string, number>() // ourKey -> usd
for (const mappings of buildModelMap().values()) {
  for (const m of mappings as { ourKey: string; kieCredits: number }[]) {
    if (m.kieCredits > 0 && !modelsTs.has(m.ourKey)) modelsTs.set(m.ourKey, m.kieCredits * KIE_USD)
  }
}

// model_pricing (cross-check; optional)
const db = new Map<string, number>()
if (process.env.SUPABASE_URL && process.env.SUPABASE_URL !== "http://stub" && !has("--no-db")) {
  const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${URL}/rest/v1/model_pricing?select=model_identifier,credit_cost&limit=1000&offset=${offset}`,
      { headers: { apikey: KEY!, Authorization: `Bearer ${KEY}` } })
    if (!res.ok) throw new Error(`model_pricing: ${res.status}`)
    const page = (await res.json()) as { model_identifier: string; credit_cost: number }[]
    for (const r of page) db.set(r.model_identifier, Number(r.credit_cost))
    if (page.length < 1000) break
  }
}

// ---------- basis classification ----------
// Platform compute: zero provider cost, priced as our compute. Same-$ policy.
const PLATFORM = new Set([
  "adjust-volume", "combine-videos", "fade-video", "ffmpeg", "loop-video",
  "merge-video-audio", "mix-audio", "resize-video", "social-media-format",
  "speed-ramp", "trim-video", "extract-audio", "extract-frame", "add-captions",
  "composite", "render-video", "image-collage", "reduce", "loop-trim",
  // Internal / orchestration ops that record no provider_cost because there is
  // none — they are our own compute or a publish action. Verified: zero rows in
  // jobs.provider_cost despite real usage_logs traffic.
  "social-publish", "pipeline-orchestration", "video-director", "film-director",
  "trim-audio", "scene-helper", "workflow-orchestration", "split-text",
  "combine-text",
])
// Worst-case reserve ceilings (holds, not prices): bare ids whose real charge
// is a duration/metered composite. Same-$ policy (x10) — commit meters down.
const RESERVE = new Set([
  "image-to-video", "text-to-video", "video-to-video", "omnihuman-1-5",
  "volcengine-lipsync", "generate-music", "kling", "beeble-switchx",
  "generate-video-pro", "edit-video-pro", "suno", "video-analysis",
  // Added after sheet v1: these bare ids are per-duration reserves too — their
  // shipped value is a worst-case hold, not the price of any single call.
  // grok-i2v and kling-turbo are deliberately NOT here: A4 showed their bare
  // ids carry real charged traffic (46 and 20 jobs) at a real default duration,
  // so the same-$ reserve policy left them recovering 0.33x and 0.88x of cost.
  // They price from observation like any other flat id.
  "infinitalk", "kling-3.0", "seedance-2",
  "seedance-2-fast", "seedance-2-mini", "sync-lipsync-v3", "runway-aleph",
  "wan-videoedit", "luma-modify", "kling-3.0-motion",
  // Bare ids of FORMULA families: the grid composites carry the real price;
  // the bare id is the fallback hold used when no composite matches. Pricing
  // one from observed data is meaningless (flux-2-max's bare showed $0.005274
  // against a model billing $0.07/output-MP).
  "flux-2-pro", "flux-2-max", "flux-2-klein", "heygen-avatar-iv",
  "heygen-avatar-v", "cinematic-avatar",
])
const LLM_FEATURES = new Set([
  "ai-writer", "llm-chat", "prompt-helper", "scene-graph-ai", "after-effects",
  "motion-graphics", "motion-graphics-lottie", "lottie-overlay", "3d-title",
  "image-to-text", "describe-to-picker", "qa-check", "generate-script",
  "translate", "image-critic",
])

const FLUX2 = /^flux-2-(pro|max|klein):([\d.]+)MP:(\d+)ref$/
const AVATAR = /^heygen-(avatar-iv|avatar-v):(\d+p|4k):(\d+)s$/
const CINEMATIC = /^cinematic-avatar:(\d+p):(\d+)s$/
const SWITCHX = /^beeble-switchx:(\d+)f:(\d+)p$/

interface SheetRow {
  identifier: string
  basis: string
  provider_usd: number | null
  authority: string
  old_credits: number | null
  db_credits: number | null
  new_credits: number
  delta_vs_x10_pct: number
  direction: "cheaper" | "same" | "dearer"
  flag: string
  note: string
}

function formulaUsd(id: string): { usd: number; basis: string } | null {
  let m = FLUX2.exec(id)
  if (m) return { usd: flux2CostUsd(`flux-2-${m[1]}` as never, Number(m[2]), Number(m[3])), basis: "formula-flux2" }
  m = AVATAR.exec(id)
  if (m) return { usd: aiAvatarUsdCost(m[1] as never, m[2] as never, Number(m[3])), basis: "formula-ai-avatar" }
  m = CINEMATIC.exec(id)
  if (m) return { usd: cinematicUsdCost(m[1] as never, Number(m[2])), basis: "formula-cinematic" }
  m = SWITCHX.exec(id)
  if (m) {
    const res = Number(m[2]) as 720 | 1080
    if (SWITCHX_BLOCK_USD[res] !== undefined) return { usd: (Number(m[1]) / 30) * SWITCHX_BLOCK_USD[res], basis: "formula-switchx" }
  }
  return null
}

const ids = [...new Set([...Object.keys(S), ...db.keys()])].sort()
const rows: SheetRow[] = []

for (const id of ids) {
  const old = S[id] ?? null
  const dbCr = db.get(id) ?? null
  const effOld = old ?? dbCr // DB_ONLY rows still get re-derived
  const base = id.split(":")[0]

  let basis: string
  let usd: number | null = null
  let authority = "5-est"
  let flag = "EST"
  let note = ""
  let newCr: number

  const f = formulaUsd(id)
  const obs = observed.get(id)
  const kie = kieActual.get(id)

  if (f) {
    basis = f.basis
    usd = f.usd
    authority = "3-formula"
    flag = "OK"
    newCr = guardedCeil(usd, NEW_BASE)
  } else if (PLATFORM.has(base)) {
    basis = "platform"
    authority = "policy"
    flag = "OK"
    note = "platform compute — same-$ policy (x10)"
    newCr = (effOld ?? 0) * 10
  } else if (id.startsWith("video-analysis")) {
    basis = "formula-plugin"
    authority = "policy"
    flag = "ADJUDICATED"
    note = "regenerated by cloud-plugins USD_PER_CREDIT flip; x10 approx here; CI cross-check enforces equality"
    newCr = (effOld ?? 0) * 10
  } else if (RESERVE.has(id)) {
    basis = "reserve-ceiling"
    authority = "policy"
    flag = "OK"
    note = "worst-case hold, not a price — same-$ policy (x10); commit meters down"
    newCr = (effOld ?? 0) * 10
  } else if (LLM_FEATURES.has(base)) {
    basis = "llm-composite"
    if (obs && obs.n >= 3) {
      usd = obs.p50Usd
      authority = "2-observed"
      flag = "OK"
      note = `typical-usage p50 of n=${obs.n}`
      newCr = Math.max(1, guardedCeil(usd, NEW_BASE))
    } else {
      note = "no observed usage — x10 pending typical-usage derivation"
      newCr = (effOld ?? 0) * 10
    }
  } else {
    basis = /:\d+s(:|$)|:(480|720|1080)p(:|$)|:\d+K$|:(high|low)$/.test(id) ? "duration-composite" : "flat"
    // KIE-actual OUTRANKS observed for KIE-backed rows. jobs.provider_cost
    // echoes the RESERVE ESTIMATE for fixed-priced KIE providers rather than a
    // meter (verified: flat $0.33 across every seedance-2-fast duration;
    // gpt-image-2 recorded $0.02 against KIE's real $0.05), so "observed" is
    // only trustworthy for genuinely metered lanes (Replicate GPU-time, LLM).
    // A KIE model that maps to SEVERAL of our ids (buildModelMap aliases, e.g.
    // KIE "nano-banana-pro" -> both `nano-banana` and `nano-banana-pro`) has an
    // aggregate that belongs to whichever id actually ran. Attributing it to all
    // of them would have shipped `nano-banana` at $0.09 instead of its real
    // $0.02 — a 4.5x overcharge across 1,042 jobs. So for a fanned-out mapping,
    // require observed cost to corroborate within 50%; otherwise distrust it.
    const kieTrusted = kie && (kie.fanout === 1 || !obs || Math.abs(obs.p50Usd - kie.modalUsd) / Math.max(obs.p50Usd, 1e-9) < 0.5)
      ? kie
      : undefined

    // NEVER price a duration composite from jobs.provider_cost: it is the
    // reserve estimate, flat across durations AND resolutions, so it inverts
    // orderings when a sibling has real per-task data. Verified: it priced
    // seedance-2:4s:480p at its true $0.82 while giving 4s:1080p the estimate
    // $0.41 — making 480p dearer than 1080p. Duration composites take exact
    // per-task cost or the value-preserving x10, nothing in between.
    // seedance-2* duration composites are EXCLUDED from exact per-task pricing:
    // the join produced 12s:480p = $2.46 against 12s:720p = $2.05, i.e. a lower
    // resolution costing MORE. The composite label evidently does not always
    // reflect what was sent to the provider, so the (variant, duration) pairing
    // is unreliable for this family. Value-preserving x10 keeps the existing
    // monotonic ordering until the labels can be trusted; shipping an inverted
    // price table would be worse than shipping today's.
    const labelUntrusted = /^seedance-2/.test(base)
    const exact = labelUntrusted ? undefined : exactCells.get(id)
    if (exact) {
      usd = exact.usd
      authority = "0-kie-per-task"
      flag = "OK"
      note = `exact composite cost from the per-task KIE join (modal of n=${exact.n})`
    } else if (kieTrusted && variantUsd(base, id, kieTrusted, ids)) {
      const kf = variantUsd(base, id, kieTrusted, ids)!
      usd = kf.usd
      authority = "1-kie-actual"
      flag = "OK"
      note = kieTrusted.buckets.length > 1
        ? `kie-actual variant split (${kieTrusted.buckets.length} buckets, ${kieTrusted.tasks} tasks)`
        : `kie-actual modal over ${kieTrusted.tasks} tasks`
    } else if (false) {
      const kieFamily = null as never
      void kieFamily
    } else if (kieTrusted) {
      usd = kieTrusted.modalUsd
      authority = "1-kie-actual"
      flag = "VARIANT-SPLIT"
      note = `${kieTrusted.buckets.length} cost buckets vs shipped variants — assign per variant explicitly. Buckets: ${kieTrusted.buckets.map(b => `$${b.usd.toFixed(4)}x${b.n}`).join(" ")}`
    } else if (obs && obs.n >= 3 && basis !== "duration-composite") {
      usd = obs.p50Usd
      authority = "2-observed"
      flag = "OK"
      note = `observed p50 of n=${obs.n}${obs.minUsd !== obs.maxUsd ? ` (range $${obs.minUsd}-$${obs.maxUsd})` : ""}`
    } else if (modelsTs.has(id)) {
      usd = modelsTs.get(id)!
      authority = "4-models.ts"
      flag = "EST"
      note = "models.ts credits field — §5.2 last resort, verify"
    } else {
      note = "no $ source — x10 value-preserving"
      newCr = (effOld ?? 0) * 10
    }
    if (usd !== null) newCr = guardedCeil(usd, NEW_BASE)
    else newCr = (effOld ?? 0) * 10
  }

  // A per-second model's duration composites CANNOT be priced from a flat $:
  // applying one figure to every duration makes short clips dearer and long
  // ones cheaper simultaneously. Neither authority carries a per-second rate —
  // jobs.provider_cost is the reserve estimate (flat across all durations) and
  // kie-actual is aggregated across durations. Deriving the rate needs the
  // per-task KIE join (provider_task_id), collected separately.
  if (basis === "duration-composite" && usd !== null && authority !== "0-kie-per-task" && /:\d+s(:|$)/.test(id)) {
    flag = "PER-SECOND-FLAT"
    note = `flat $${usd} applied to a per-duration composite — needs a per-second rate from the per-task KIE join. ${note}`
  }

  const x10 = (effOld ?? 0) * 10
  const delta = x10 > 0 ? Math.round(((newCr - x10) / x10) * 1000) / 10 : 0
  const direction = newCr < x10 ? "cheaper" : newCr > x10 ? "dearer" : "same"
  if (direction === "dearer" && flag === "OK") flag = "RISE"

  rows.push({
    identifier: id, basis, provider_usd: usd, authority,
    old_credits: old, db_credits: dbCr, new_credits: newCr,
    delta_vs_x10_pct: delta, direction, flag, note,
  })
}

// ---------- check mode ----------
if (has("--check-old-base")) {
  let formulaOk = 0, formulaBad = 0
  let authOk = 0
  const authBad: string[] = []
  for (const r of rows) {
    if (r.old_credits === null || r.provider_usd === null) continue
    const rederived = guardedCeil(r.provider_usd, OLD_BASE)
    if (r.basis.startsWith("formula-") && r.basis !== "formula-plugin") {
      if (rederived === r.old_credits) formulaOk++
      else { formulaBad++; console.error(`FORMULA MISMATCH ${r.identifier}: shipped=${r.old_credits} rederived=${rederived}`) }
    } else if (r.authority === "1-kie-actual" || r.authority === "2-observed") {
      if (rederived === r.old_credits) authOk++
      else authBad.push(`${r.identifier}\tshipped=${r.old_credits}\trederived@0.02=${rederived}\tusd=$${r.provider_usd}\t[${r.authority}]`)
    }
  }
  console.error(`\n[check-old-base] formula rows: ${formulaOk} reproduce, ${formulaBad} FAIL (must be 0)`)
  console.error(`[check-old-base] authority rows: ${authOk} reproduce; ${authBad.length} differ (= the audit's findings):`)
  for (const b of authBad) console.error("  " + b)
  if (formulaBad > 0) process.exit(1)
}

// ---------- output ----------
const stats = {
  rows: rows.length,
  byBasis: Object.fromEntries([...new Set(rows.map(r => r.basis))].map(b => [b, rows.filter(r => r.basis === b).length])),
  byAuthority: Object.fromEntries([...new Set(rows.map(r => r.authority))].map(a => [a, rows.filter(r => r.authority === a).length])),
  byFlag: Object.fromEntries([...new Set(rows.map(r => r.flag))].map(f => [f, rows.filter(r => r.flag === f).length])),
  byDirection: Object.fromEntries([...new Set(rows.map(r => r.direction))].map(d => [d, rows.filter(r => r.direction === d).length])),
}
console.error(`[a2-sheet] ${JSON.stringify(stats, null, 2)}`)

if (has("--csv")) {
  console.log("identifier,basis,provider_usd,authority,old_credits,db_credits,new_credits,delta_vs_x10_pct,direction,flag,note")
  for (const r of rows) {
    console.log([r.identifier, r.basis, r.provider_usd ?? "", r.authority, r.old_credits ?? "", r.db_credits ?? "",
      r.new_credits, r.delta_vs_x10_pct, r.direction, r.flag, `"${r.note.replace(/"/g, '""')}"`].join(","))
  }
} else {
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), oldBase: OLD_BASE, newBase: NEW_BASE, stats, rows }, null, 2))
}
