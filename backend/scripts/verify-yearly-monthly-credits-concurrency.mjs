// Disposable migration-test databases only; no remote or cloud URL is allowed.
//
// Two callers granting the same month of a yearly plan (migration 527) — two
// replicas of the hourly cron, or staging and production sharing one database —
// must grant it ONCE. One psql session cannot show that, so this proof opens
// two connections: first a forced interleaving (the second caller is seen
// WAITING on the profile's row lock, then refuses once the first commits), then
// a free race for the next month's anchor. Either way: exactly one `true`, the
// pool SET to the plan amount once, top-ups untouched, one ledger row per month.
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import pg from "pg"

const url = new URL(process.env.DATABASE_URL ?? "")
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("This proof requires a disposable local database")
const admin = new pg.Client({ connectionString: url.href })
const clients = [new pg.Client({ connectionString: url.href }), new pg.Client({ connectionString: url.href })]
const userId = randomUUID(), subscriptionId = randomUUID()
const PRICE = "price_yearly_concurrency_proof"
const GRANT = "SELECT public.grant_yearly_plan_monthly_credits($1,$2,$3,$4,$5,$6) AS granted"
await admin.connect()
await Promise.all(clients.map((client) => client.connect()))

/** Polls until `pid` is waiting on a lock (or gives up after ~5 s). */
async function waitUntilBlocked(pid) {
  for (let i = 0; i < 100; i += 1) {
    const { rows } = await admin.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1", [pid])
    if (rows[0]?.wait_event_type === "Lock") return true
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return false
}

async function poolOf() {
  const { rows: [p] } = await admin.query("SELECT subscription_credits, topup_credits FROM public.profiles WHERE id = $1", [userId])
  return { subscription: Number(p.subscription_credits), topup: Number(p.topup_credits) }
}

async function ledgerRows() {
  const { rows: [r] } = await admin.query(
    "SELECT count(*)::int AS n FROM public.credit_transactions WHERE user_id = $1 AND description = 'Monthly credits — yearly plan'",
    [userId],
  )
  return r.n
}

try {
  await admin.query("INSERT INTO auth.users(id,email,raw_user_meta_data,aud,role) VALUES($1,$2,'{}','authenticated','authenticated')", [userId, `${userId}@test.invalid`])
  // A year that started 200 days ago: the +5 and +6 month anchors have been reached.
  const { rows: [{ start }] } = await admin.query("SELECT (date_trunc('second', now()) - interval '200 days')::text AS start")
  const { rows: [{ fifth, sixth }] } = await admin.query(
    "SELECT ($1::timestamptz + interval '5 months')::text AS fifth, ($1::timestamptz + interval '6 months')::text AS sixth",
    [start],
  )
  await admin.query(
    "INSERT INTO public.subscriptions(id,user_id,stripe_subscription_id,stripe_price_id,tier,status,current_period_start,current_period_end) VALUES($1,$2,$3,$4,'standard','active',$5::timestamptz,$5::timestamptz + interval '1 year')",
    [subscriptionId, userId, `sub_${subscriptionId}`, PRICE, start],
  )
  await admin.query(
    "UPDATE public.profiles SET subscription_credits = 2500, topup_credits = 3300, credits_reset_at = $2::timestamptz + interval '1 minute' WHERE id = $1",
    [userId, start],
  )
  for (const client of clients) await client.query("SET ROLE service_role")
  const args = (anchor) => [userId, subscriptionId, PRICE, start, anchor, 11000]

  // 1. Forced interleaving: A grants inside an open transaction; B calls for
  //    the same anchor and must WAIT on the row lock; A commits; B refuses.
  await clients[0].query("BEGIN")
  const { rows: [first] } = await clients[0].query(GRANT, args(fifth))
  assert.equal(first.granted, true, "the first caller grants")
  const { rows: [{ pid }] } = await clients[1].query("SELECT pg_backend_pid() AS pid")
  const second = clients[1].query(GRANT, args(fifth))
  assert.equal(await waitUntilBlocked(pid), true, "the second caller waits on the profile row lock")
  await clients[0].query("COMMIT")
  assert.equal((await second).rows[0].granted, false, "the second caller refuses once the first has committed")
  assert.deepEqual(await poolOf(), { subscription: 11000, topup: 3300 }, "the pool is SET once; top-ups untouched")
  assert.equal(await ledgerRows(), 1, "one ledger row for the month")

  // 2. A free race for the next month's anchor (the stamp put back to just
  //    after the fifth anchor, as if that grant had run then).
  await admin.query("UPDATE public.profiles SET subscription_credits = 4000, credits_reset_at = $2::timestamptz + interval '40 minutes' WHERE id = $1", [userId, fifth])
  const race = await Promise.all(clients.map((client) => client.query(GRANT, args(sixth))))
  const winners = race.filter((result) => result.rows[0].granted === true)
  assert.equal(winners.length, 1, "exactly one of two racing callers grants the month")
  assert.deepEqual(await poolOf(), { subscription: 11000, topup: 3300 }, "the pool is SET once more; top-ups untouched")
  assert.equal(await ledgerRows(), 2, "one more ledger row, not two")

  process.stdout.write("Yearly-plan monthly credit concurrency proof passed: one grant per month across two callers, SET not ADD, top-ups untouched\n")
} finally {
  await admin.query("DELETE FROM public.credit_transactions WHERE user_id = $1", [userId])
  await admin.query("DELETE FROM auth.users WHERE id = $1", [userId])
  await Promise.all(clients.map((client) => client.end()))
  await admin.end()
}
