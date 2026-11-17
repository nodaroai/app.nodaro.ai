// Disposable migration-test databases only; no remote or cloud URL is allowed.
//
// Two claims of plan grants for two subscriptions of ONE account
// (claim_subscription_grant, migration 663) must run one after the other on
// the account's profile lock, and a claim must be refused while another
// subscription of the account is claimed — from its claim on, while it is
// still `incomplete` and before the webhook writes its live status. One psql
// session cannot show that, so this proof opens two connections:
//   1. forced interleaving: the first claim is taken inside an open
//      transaction (nothing else is written: its status stays `incomplete`);
//      the second claim is seen WAITING on the profile's row lock, and once
//      the first commits it answers other_live, naming the first, and writes
//      nothing;
//   2. a free race of two subscriptions recorded `incomplete`: exactly one is
//      claimed, the other is other_live;
//   3. the same for a trialing pair;
//   4. the claimed subscription claimed again (a redelivery) is not_claimable,
//      never other_live;
//   5. a released claim (marker and claim time cleared, as the webhook does
//      when the grant's write fails) no longer blocks.
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import pg from "pg"

const url = new URL(process.env.DATABASE_URL ?? "")
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("This proof requires a disposable local database")
const admin = new pg.Client({ connectionString: url.href })
const clients = [new pg.Client({ connectionString: url.href }), new pg.Client({ connectionString: url.href })]
const userId = randomUUID()
const tag = userId.slice(0, 8)
const subs = { a: `sub_${tag}_a`, b: `sub_${tag}_b`, i1: `sub_${tag}_i1`, i2: `sub_${tag}_i2`, t1: `sub_${tag}_t1`, t2: `sub_${tag}_t2` }
const CLAIM = "SELECT outcome, other_stripe_subscription_id AS other FROM public.claim_subscription_grant($1, $2)"
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

async function rowOf(subscriptionId) {
  const { rows: [r] } = await admin.query(
    "SELECT status, plan_granted FROM public.subscriptions WHERE stripe_subscription_id = $1",
    [subscriptionId],
  )
  return `${r.status}/${r.plan_granted}`
}

async function record(subscriptionId, status, minutesAgo) {
  await admin.query(
    `INSERT INTO public.subscriptions(user_id,stripe_subscription_id,stripe_price_id,tier,status,current_period_start,current_period_end,plan_granted,created_at)
     VALUES($1,$2,'price_claim_concurrency_proof','pro',$3,now(),now() + interval '1 month',false,now() - ($4::int * interval '1 minute'))`,
    [userId, subscriptionId, status, minutesAgo],
  )
}

try {
  await admin.query("INSERT INTO auth.users(id,email,raw_user_meta_data,aud,role) VALUES($1,$2,'{}','authenticated','authenticated')", [userId, `${userId}@test.invalid`])
  await record(subs.a, "incomplete", 4)
  await record(subs.b, "incomplete", 3)
  for (const client of clients) await client.query("SET ROLE service_role")

  // 1. Forced interleaving, in the window: the first claim commits with its
  //    subscription still `incomplete`.
  await clients[0].query("BEGIN")
  const { rows: [first] } = await clients[0].query(CLAIM, [subs.a, userId])
  assert.deepEqual(first, { outcome: "claimed", other: null }, "the first claim is claimed")
  const { rows: [{ pid }] } = await clients[1].query("SELECT pg_backend_pid() AS pid")
  const second = clients[1].query(CLAIM, [subs.b, userId])
  assert.equal(await waitUntilBlocked(pid), true, "the second claim waits on the account's profile row lock")
  await clients[0].query("COMMIT")
  assert.deepEqual((await second).rows[0], { outcome: "other_live", other: subs.a }, "the second claim is refused, naming the first")
  assert.equal(await rowOf(subs.a), "incomplete/true", "the first is claimed, its status not written yet")
  assert.equal(await rowOf(subs.b), "incomplete/false", "the refused one is written nothing")

  /** A free race of two fresh subscriptions of `status`, after the account's earlier ones ended. */
  async function race(status, x, y) {
    await admin.query("UPDATE public.subscriptions SET status = 'canceled' WHERE user_id = $1", [userId])
    await record(x, status, 2)
    await record(y, status, 1)
    const outcomes = (await Promise.all([clients[0].query(CLAIM, [x, userId]), clients[1].query(CLAIM, [y, userId])])).map((r) => r.rows[0])
    assert.equal(outcomes.filter((o) => o.outcome === "claimed").length, 1, `exactly one of two racing ${status} claims is claimed: ${JSON.stringify(outcomes)}`)
    const winner = outcomes[0].outcome === "claimed" ? x : y
    const loser = winner === x ? y : x
    assert.deepEqual(outcomes.find((o) => o.outcome !== "claimed"), { outcome: "other_live", other: winner }, "the other is other_live, naming the winner")
    assert.equal(await rowOf(winner), `${status}/true`, "the winner holds the claim")
    assert.equal(await rowOf(loser), `${status}/false`, "the loser is written nothing")
    return { winner, loser }
  }

  // 2. and 3. Free races.
  await race("incomplete", subs.i1, subs.i2)
  const { winner, loser } = await race("trialing", subs.t1, subs.t2)

  // 4. The winner's redelivery.
  assert.deepEqual((await clients[1].query(CLAIM, [winner, userId])).rows[0], { outcome: "not_claimable", other: null }, "a redelivery is not_claimable, never other_live")

  // 5. The winner's grant write failed: its claim is released, and the loser's redelivery claims.
  await admin.query("UPDATE public.subscriptions SET plan_granted = false, plan_claimed_at = NULL WHERE stripe_subscription_id = $1", [winner])
  assert.deepEqual((await clients[0].query(CLAIM, [loser, userId])).rows[0], { outcome: "claimed", other: null }, "a released claim no longer blocks")

  process.stdout.write("Subscription claim concurrency proof passed: two callers' claims serialize on the account lock, a claim is refused and written nothing while another subscription is claimed (incomplete included), and a released claim stops blocking\n")
} finally {
  await admin.query("DELETE FROM public.subscriptions WHERE user_id = $1", [userId])
  await admin.query("DELETE FROM auth.users WHERE id = $1", [userId])
  await Promise.all(clients.map((client) => client.end()))
  await admin.end()
}
