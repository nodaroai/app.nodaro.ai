// @test-watches backend/src/**/*.ts supabase/migrations/*.sql
/**
 * TOTALITY: a failure sentence that names a credit figure is worded in ONE
 * place, `lib/stated-credit-messages.ts` (decided 2026-11-15), which states it
 * in a deployment's own terms where it has them. A sentence worded anywhere
 * else is saved with the run in the platform's raw credits.
 *
 *  1. Every backend file whose code interpolates a figure into a sentence
 *     about credits (`${n} credits`, `Required: ${n}`, `need ${n}`, …) is
 *     listed with exactly the count found and the reason that sentence is not
 *     a saved failure (a log line, an email, an admin note, a reply that is
 *     never stored) — held both ways, per file and per count, so a new one in
 *     a file already listed fails too.
 *  2. Every refusal the reservation functions raise with a figure (`RAISE
 *     EXCEPTION '…%…'` in `supabase/migrations`) reaches a run as a fixed
 *     message (`lib/reserve-errors.ts`) or through `reservationFailedMessage`,
 *     which states it with no raw figure on such a deployment.
 *
 * Comment lines are not scanned: they are saved nowhere.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { join, relative, resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { reservationFailedMessage, statesReserveRefusal } from "../stated-credit-messages.js"
import { reservePrefixOf } from "../reserve-errors.js"
import { __resetSurfaceProfileCacheForTests } from "../surface-profile.js"

const here = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(here, "../..")
const MIGRATIONS = resolve(here, "../../../../supabase/migrations")
const FUNNEL = "lib/stated-credit-messages.ts"

/** A figure interpolated into a sentence about credits. */
const CREDIT_FIGURE = /\$\{[^}]*\}\s*(?:app )?(?:credits?\b|credit\(s\)|cr\b)|\b(?:Required|Available|need|have|Spent(?: today)?|Limit|balance is|free pool has|Charged|headroom):? \$\{/g

/**
 * A figure interpolated where a sentence states what a payer HAS (`your balance
 * is ${…}`, `Available: ${…}`, `have ${…}`, `free pool has ${…}`). Under a
 * deployment that pays for its users that figure is the operator's pool, which
 * is never its users' to read: the funnel drops it (`BalanceSeen.payerPool`),
 * and a file outside the funnel that states one says, in `balance`, whose
 * balance it is and why it is never that pool.
 */
const BALANCE_FIGURE = /\b(?:Available|have|balance is|free pool has):? \$\{/g

const LOG = "log lines (console / alert text for operators), never saved with a run"
/**
 * Every file outside the funnel whose code matches, with its count and why
 * its sentence is not a saved failure a deployment's user reads.
 */
const NOT_A_SAVED_FAILURE: Readonly<Record<string, { count: number; why: string; balance?: string }>> = {
  "ee/billing/auto-recharge.ts": { count: 1, why: LOG },
  "ee/billing/cleanup-cron.ts": { count: 1, why: LOG },
  "ee/billing/cleanup-service.ts": { count: 1, why: LOG },
  "ee/billing/commit-at-charged-price.ts": { count: 1, why: LOG },
  "ee/billing/kie-low-balance-alert.ts": { count: 1, why: "the operator's alert about the platform's own provider account" },
  "ee/billing/llm-billing-impl.ts": { count: 8, why: "log lines, and the admin anomaly title: never a run's failure" },
  "ee/billing/llm-cancel-settle.ts": { count: 2, why: LOG },
  "ee/billing/llm-fixed-plus-calls-impl.ts": { count: 2, why: "a log line and an admin note on the usage row (admin screens only)" },
  "ee/billing/plan-change-credits.ts": { count: 1, why: LOG },
  "ee/billing/provision-credits.ts": { count: 3, why: LOG },
  "ee/billing/subscription-grant.ts": { count: 3, why: "a log line, and the purchase ledger's descriptions of a self-serve subscription" },
  "ee/billing/billing-documents.ts": { count: 2, why: "the invoice / receipt line of a self-serve purchase" },
  "ee/notifications/credits-digest.ts": { count: 4, why: "the credits digest email, not a run's failure" },
  "ee/notifications/monthly-statement.ts": { count: 1, why: "the monthly statement email, not a run's failure" },
  "ee/lib/admin-message-templates.ts": { count: 1, why: "an admin's message to a user, written by the admin" },
  "ee/lib/credit-guard-impl.ts": {
    count: 3,
    why: "two log lines, and the community-instance monthly cap's 402 reply, which is answered over HTTP before any job row exists and is saved nowhere",
  },
  "ee/copilot/studio-preamble.ts": { count: 1, why: "the in-app Copilot's prompt preamble, never saved with a run" },
  "ee/pipelines/stage-utils.ts": { count: 1, why: LOG },
  "ee/scripts/topaz-overcharge-refund.ts": { count: 5, why: "a one-off operator script's output and its admin notes" },
  "scripts/cleanup-stuck-pipelines.ts": { count: 1, why: "an operator script's output" },
  "lib/reconcile/cancelled-metered-holds.ts": { count: 1, why: LOG },
  "workers/shared.ts": { count: 1, why: LOG },
  "lib/character-lora.ts": { count: 1, why: "a count of reference photos, not credits", balance: "not a balance: the photos the user has" },
  "lib/llm-files.ts": { count: 1, why: "a count of pages, not credits", balance: "not a balance: the pages the files have" },
  "lib/mcp/tools/collections.ts": { count: 1, why: "the names of the user's collections, not credits", balance: "not a balance: the user's collection names" },
  "lib/mcp/tools/recipes.ts": { count: 1, why: "the names of the recipes, not credits", balance: "not a balance: the names of the recipes on offer" },
  "middleware/rate-limit.ts": { count: 1, why: "a request rate, not credits" },
  "routes/app-runner.ts": {
    count: 7,
    why: "the app run's 402 replies, answered over HTTP before any execution or app run row is written and saved nowhere (an MCP caller is told them through balanceRefusal)",
    balance:
      "the payer's balance from checkBalanceCovers, stated through appRunShortfall: a deployment payer's refusal carries no balance (payerPool) and is answered in the deployment's own words",
  },
  "routes/app-run-resume.ts": {
    count: 2,
    why: "the retry's 402 reply, answered over HTTP before the execution is written and saved nowhere (an MCP caller is told it through balanceRefusal)",
    balance:
      "only when checkRunSetCredits sent no sentence of its own (it always does on a refusal); its `available` is null for a deployment payer, whose refusal is the deployment's own words",
  },
}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__" || entry.name === "node_modules") continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sourceFiles(path))
    else if (/\.m?ts$/.test(entry.name) && !entry.name.endsWith(".test.ts")) out.push(path)
  }
  return out
}

const codeOf = (path: string) =>
  readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => !/^\s*(?:\/\/|\*|\/\*)/.test(line))
    .join("\n")

describe("a saved failure that names a credit figure is worded only in lib/stated-credit-messages.ts", () => {
  it("every other file whose sentences name a figure is listed with its exact count and why it is not a saved failure (held both ways)", () => {
    const found: Record<string, number> = {}
    for (const path of sourceFiles(SRC)) {
      const file = relative(SRC, path)
      if (file === FUNNEL) continue
      const n = codeOf(path).match(CREDIT_FIGURE)?.length ?? 0
      if (n > 0) found[file] = n
    }
    if (process.env.PRINT_CREDIT_FIGURE_SCAN === "1") console.log(JSON.stringify(found, null, 2))
    expect(found).toEqual(Object.fromEntries(Object.entries(NOT_A_SAVED_FAILURE).map(([f, e]) => [f, e.count])))
    for (const [file, e] of Object.entries(NOT_A_SAVED_FAILURE)) expect(e.why.length, `${file} needs a reason`).toBeGreaterThan(20)
  })

  it("every other file whose sentences state what a payer HAS says whose balance it is and why it is never a deployment payer's pool (held both ways)", () => {
    const states: string[] = []
    for (const path of sourceFiles(SRC)) {
      const file = relative(SRC, path)
      if (file !== FUNNEL && BALANCE_FIGURE.test(codeOf(path))) states.push(file)
      BALANCE_FIGURE.lastIndex = 0
    }
    const declared = Object.entries(NOT_A_SAVED_FAILURE).filter(([, e]) => e.balance !== undefined).map(([f]) => f)
    expect(states.sort(), "state whose balance it is in the entry's `balance`, and never a deployment payer's pool").toEqual(declared.sort())
    for (const file of declared) expect(NOT_A_SAVED_FAILURE[file]!.balance!.length, `${file} needs a reason`).toBeGreaterThan(20)
  })
})

/** Every distinct `RAISE EXCEPTION '<template>'` of the migrations whose template carries a `%`. */
function raisedTemplates(): string[] {
  const out = new Set<string>()
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"))) {
    for (const m of readFileSync(join(MIGRATIONS, file), "utf8").matchAll(/RAISE EXCEPTION '((?:[^']|'')*)'/g)) {
      if (m[1]!.includes("%")) out.add(m[1]!)
    }
  }
  return [...out].sort()
}

/**
 * A template that names a credit amount: the word credit(s), or an amount word
 * before its placeholder (`need %`, `headroom %`, `granted %`, …).
 */
const CREDIT_AMOUNT_TEMPLATE = /credit|\b(?:need|have|headroom|cap|granted|remaining|available|limit|allocated|reserved|spent|reclaimable|target|free pool has|amount must be positive, got)\s*%/i

/**
 * The templates that name a credit amount and are raised by functions a run's
 * reservation never calls (an admin's, a purchase's, an allocation's): their
 * message reaches an operator or a billing route, never a run.
 */
const NOT_A_RESERVATION: Readonly<Record<string, string>> = {
  "ALLOWANCE_BELOW_COMMITTED: granted would become %, below reserved % + spent %": "an operator setting a user's allowance (deployment-allowance admin route)",
  "ALLOWANCE_BELOW_COMMITTED: renewal target %, below reserved %": "an operator renewing allowances",
  "ALLOWANCE_PENDING_REFUSED: pending % (mode %, target %) was refused: %": "an operator's queued allowance change",
  "ALLOWANCE_TARGET_INVALID: target % must be zero or a positive whole number of credits": "an operator setting a user's allowance",
  "Clawback amount must be positive, got %": "a refund's clawback (payment webhook)",
  "Clawback credits must be positive, got %": "a refund's clawback (payment webhook)",
  "admin_adjust_credits: invalid field %": "an admin's balance adjustment",
  "admin_adjust_credits: user profile not found %": "an admin's balance adjustment",
  "admin_motion_run_list: p_credit_usd must be above 0, not %": "an admin report",
  "grant_plan_change_credits: credits must be zero or more (from %, to %)": "a plan change's grant (payment webhook)",
  "grant_plan_change_credits: profile % not found": "a plan change's grant (payment webhook)",
  "note_plan_credit_peak: credits must be zero or more, got %": "a plan's monthly bookkeeping",
  "note_plan_credit_peak: profile % not found": "a plan's monthly bookkeeping",
  "ORG_POOL_EXCEEDED: available %, need %": "an organization allocating its pool to a workspace",
  "RECLAIM_EXCEEDS_AVAILABLE: allocated %, reserved %, spent %, reclaimable %": "an organization reclaiming a workspace's allocation",
  "restart_plan_credit_period: credits must be zero or more, got %": "a plan's monthly bookkeeping",
  "restart_plan_credit_period: profile % not found": "a plan's monthly bookkeeping",
  "revoke_signup_grant: grant amount must be positive, got %": "an admin revoking a signup grant",
}

describe("every refusal a reservation raises with a credit figure reaches a run without a raw figure", () => {
  beforeEach(() => {
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ billing: { unitLabel: "points", unitRate: 0.25, unitDecimals: 2, selfServe: false } })
    __resetSurfaceProfileCacheForTests()
  })
  afterEach(() => {
    process.env.NODARO_SURFACE_PROFILE = ""
    __resetSurfaceProfileCacheForTests()
  })

  /** A template filled with distinctive figures, none a converted figure can contain. */
  const FIGURES = [7919, 6113, 4993, 8467]
  const filled = (t: string) => {
    let i = 0
    return t.replace(/%/g, () => String(FIGURES[i++ % FIGURES.length]))
  }

  it("each one is translated to a fixed message, stated in the unit, or raised where no run reserves (held both ways)", () => {
    const templates = raisedTemplates().filter((t) => CREDIT_AMOUNT_TEMPLATE.test(t))
    expect(templates.length).toBeGreaterThan(10)
    const unclassified: string[] = []
    for (const template of templates) {
      const raw = filled(template)
      // A prefixed refusal is translated to its fixed message before it is saved (lib/reserve-errors.ts).
      if (reservePrefixOf(raw)) continue
      if (statesReserveRefusal(raw)) {
        const said = reservationFailedMessage(raw)
        for (const n of FIGURES) expect(said, `${template} → ${said}`).not.toMatch(new RegExp(`(?<![\\d.])${n}(?![\\d])`))
        continue
      }
      if (!(template in NOT_A_RESERVATION)) unclassified.push(template)
    }
    expect(unclassified, "a new refusal with a credit figure: state it in RESERVE_REFUSALS (lib/stated-credit-messages.ts), or say why no run reaches it").toEqual([])
    for (const t of Object.keys(NOT_A_RESERVATION)) expect(templates, `${t} is no longer raised — drop it`).toContain(t)
  })

  it("the refusals a balance check words before the RPC are stated in the unit, not dropped", () => {
    expect(reservationFailedMessage("Insufficient credits: need 2087, have 1534")).toBe("Credit reservation failed: Insufficient balance: need 521.75 points, have 383.5 points")
    expect(reservationFailedMessage("Insufficient credits: need 2087, have 1534", { payerPool: true })).toBe("Credit reservation failed: Insufficient balance: need 521.75 points")
    expect(reservationFailedMessage("Daily credit limit reached: limit 4421, spent today 4400, need 53")).toBe(
      "Credit reservation failed: Daily limit reached: limit 1105.25 points, spent today 1100 points, need 13.25 points",
    )
    // The markers the catches above branch on stay: the subscription modal, a side hold's conflict or settled key, a unique violation.
    expect(reservationFailedMessage("SUBSCRIPTION_REQUIRED: web spending draws only free-pool credits: need 211, free pool has 23")).toContain("SUBSCRIPTION_REQUIRED:")
    for (const raw of [
      "SIDE_HOLD_CONFLICT: the key names another hold",
      "SIDE_HOLD_KEY_SETTLED: the key names a settled hold (3f0c1a2e-0000-4000-8000-000000000001)",
      'duplicate key value violates unique constraint "llm_side_holds_job_key"',
      "connection reset",
    ]) {
      expect(reservationFailedMessage(raw)).toBe(`Credit reservation failed: ${raw}`)
    }
  })
})

/** Advice to buy: top up, upgrade, buy, purchase, add credits. */
const PURCHASE_WORD = /\btop[ -]ups?\b|\btopped up\b|\bupgrade[ds]?\b|\bbuy\b|\bbought\b|\bpurchase[ds]?\b|\badd(?:ed)? (?:more )?credits/gi

/**
 * The files whose sentences a balance or availability check refuses a run
 * with — saved with the run when the orchestrator's preflight refuses a node,
 * and read verbatim by the MCP job tools — with how many name a purchase and
 * what keeps each off a deployment without self-serve billing. The ones not
 * kept off yet are listed as such: a new one fails here.
 */
const LEFT = "not yet kept off a deployment without self-serve billing: saved with a run the orchestrator's preflight refuses, and read verbatim by the MCP job tools"
const PURCHASE_IN_REFUSALS: Readonly<Record<string, { count: number; why: string }>> = {
  "lib/stated-credit-messages.ts": { count: 2, why: "the free tier's daily cap: \"Upgrade for higher limits\" only where billing.selfServe is on" },
  "lib/reserve-errors.ts": { count: 0, why: "fixed refusals, none of which advises a purchase" },
  "ee/billing/credits.ts": { count: 2, why: `the storage limit and the app-credits refusal ("upgrade your plan"): ${LEFT}` },
  "ee/billing/model-availability.ts": { count: 2, why: `a model above the plan's tier ("upgrade your plan", "Upgrade to Basic"): ${LEFT}` },
  "ee/billing/free-video-limits.ts": { count: 2, why: `a video beyond the free limits ("Upgrade or buy credits"): ${LEFT}` },
}

describe("purchase advice in the refusals a run is saved with", () => {
  it("each listed file's count is the one listed, with what keeps it off a deployment without self-serve billing", () => {
    for (const [file, e] of Object.entries(PURCHASE_IN_REFUSALS)) {
      const code = codeOf(resolve(SRC, file))
        .split("\n")
        .filter((line) => !/^\s*import\b/.test(line))
        .join("\n")
      expect(code.match(PURCHASE_WORD)?.length ?? 0, `${file}: ${e.why}`).toBe(e.count)
    }
  })
})
