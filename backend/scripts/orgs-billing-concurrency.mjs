#!/usr/bin/env node
/**
 * Concurrency proof for the workspace credit budget (migration 351).
 *
 * Fires 50 CONCURRENT `reserve_credits` calls, each for 20 credits, against a
 * workspace allocated exactly 500 — so exactly 25 can win. Asserts:
 *
 *   1. the schema invariant holds afterwards:
 *        reserved_credits + spent_credits <= allocated_credits
 *   2. winners * 20 == reserved_credits (nothing double-counted, nothing lost)
 *   3. every loser was refused with the STABLE prefix `BUDGET_EXCEEDED:` —
 *      never a serialization/deadlock error. "Your class is out of credits"
 *      and "something went wrong" are different bugs, and only one of them is
 *      acceptable under load.
 *
 * Runs only where a database exists: the `migration-behavior` CI job (after
 * the chain is applied and the behavioral proofs pass), or locally against
 * the throwaway docker Postgres the behavior files describe. The job installs
 * `pg` at the repo root; no backend node_modules are needed — that is why
 * this is a plain node script rather than a vitest file.
 *
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres \
 *     node backend/scripts/orgs-billing-concurrency.mjs
 *
 * The fixture rows live in their own uuid range (…-000000000601) and are
 * deleted at the end even on failure.
 */
import pg from "pg"

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required — this proof runs against a real Postgres only")
  process.exit(2)
}

const ORG = "a0000000-0000-4000-8000-000000000601"
const WS = "b0000000-0000-4000-8000-000000000601"
const USER = "00000000-0000-4000-8000-000000000601"
const ALLOCATED = 500
const CALLS = 50
const EACH = 20 // 25 winners fill the budget exactly

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: CALLS })

async function cleanup(client) {
  // Order respects the FKs; usage_logs cascade from profiles would also do it,
  // but explicit is auditable.
  await client.query("DELETE FROM usage_logs WHERE workspace_id = $1", [WS])
  await client.query("DELETE FROM workspace_budgets WHERE workspace_id = $1", [WS])
  await client.query("DELETE FROM workspace_members WHERE workspace_id = $1", [WS])
  await client.query("DELETE FROM organization_members WHERE org_id = $1", [ORG])
  await client.query("DELETE FROM workspaces WHERE id = $1", [WS])
  await client.query("DELETE FROM organization_credit_accounts WHERE org_id = $1", [ORG])
  await client.query("DELETE FROM organizations WHERE id = $1", [ORG])
  await client.query("DELETE FROM auth.users WHERE id = $1", [USER])
}

function fail(msg) {
  console.error(`CONCURRENCY PROOF FAILED: ${msg}`)
  process.exitCode = 1
}

const setup = await pool.connect()
try {
  await cleanup(setup) // a previous crashed run must not poison this one
  await setup.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [USER, "concurrency@example.com"])
  await setup.query(
    "INSERT INTO organizations (id, slug, name, kind, owner_user_id, status, settings) VALUES ($1, 'conc-org', 'Concurrency', 'school', $2, 'active', '{}'::jsonb)",
    [ORG, USER],
  )
  await setup.query("INSERT INTO workspaces (id, org_id, name, slug) VALUES ($1, $2, 'Concurrency WS', 'conc-ws')", [WS, ORG])
  await setup.query(
    "INSERT INTO organization_members (org_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active')",
    [ORG, USER],
  )
  await setup.query(
    "INSERT INTO workspace_members (workspace_id, org_id, user_id, role, status) VALUES ($1, $2, $3, 'member', 'active')",
    [WS, ORG, USER],
  )
  await setup.query(
    "INSERT INTO workspace_budgets (workspace_id, allocated_credits) VALUES ($1, $2)",
    [WS, ALLOCATED],
  )

  const attempts = await Promise.all(
    Array.from({ length: CALLS }, async () => {
      try {
        const r = await pool.query(
          "SELECT reserve_credits($1, $2, NULL, 'concurrency-proof', NULL, NULL, FALSE, NULL, FALSE, $3) AS id",
          [USER, EACH, WS],
        )
        return { ok: true, id: r.rows[0].id }
      } catch (err) {
        return { ok: false, message: String(err.message ?? err) }
      }
    }),
  )

  const winners = attempts.filter((a) => a.ok)
  const losers = attempts.filter((a) => !a.ok)
  console.log(`winners: ${winners.length}, losers: ${losers.length}`)

  const { rows } = await setup.query(
    "SELECT allocated_credits, reserved_credits, spent_credits FROM workspace_budgets WHERE workspace_id = $1",
    [WS],
  )
  const b = rows[0]
  console.log(`budget after: allocated=${b.allocated_credits} reserved=${b.reserved_credits} spent=${b.spent_credits}`)

  if (b.reserved_credits + b.spent_credits > b.allocated_credits) {
    fail(`invariant violated: reserved ${b.reserved_credits} + spent ${b.spent_credits} > allocated ${b.allocated_credits}`)
  }
  // <= rather than === : a loser that failed for a NON-budget reason (a
  // connection-pool blip under 51 concurrent sessions) must surface through
  // badLosers below as ITS OWN failure, not masquerade as a lost-update bug
  // here. The real invariant is that no over-admission ever happens and that
  // every admitted reserve is exactly accounted (the next check).
  if (winners.length > ALLOCATED / EACH) {
    fail(`over-admission: ${winners.length} winners for a ${ALLOCATED}-credit budget (max ${ALLOCATED / EACH})`)
  }
  // Under-admission is a bug ONLY if headroom was left on the table — a
  // spurious BUDGET_EXCEEDED with room to spare is the lost-update the ===
  // used to catch; fewer winners with a genuinely exhausted budget is not.
  const headroomLeft = ALLOCATED - b.reserved_credits - b.spent_credits
  if (winners.length < ALLOCATED / EACH && headroomLeft >= EACH) {
    fail(`under-admission with headroom left: ${winners.length} winners, ${headroomLeft} headroom unspent`)
  }
  if (b.reserved_credits !== winners.length * EACH) {
    fail(`reserved ${b.reserved_credits} != winners ${winners.length} * ${EACH} — a reservation was lost or double-counted`)
  }
  const badLosers = losers.filter((l) => !l.message.includes("BUDGET_EXCEEDED:"))
  if (badLosers.length > 0) {
    fail(
      `${badLosers.length} loser(s) failed with something other than BUDGET_EXCEEDED: — first: ${badLosers[0].message}`,
    )
  }
  const logs = await setup.query("SELECT count(*)::int AS n FROM usage_logs WHERE workspace_id = $1", [WS])
  if (logs.rows[0].n !== winners.length) {
    fail(`usage_logs rows ${logs.rows[0].n} != winners ${winners.length}`)
  }

  if (process.exitCode !== 1) {
    console.log("CONCURRENCY PROOF PASSED — invariant held under 50 simultaneous reserves")
  }
} finally {
  try {
    await cleanup(setup)
  } finally {
    setup.release()
    await pool.end()
  }
}
