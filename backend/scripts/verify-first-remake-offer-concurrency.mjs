// Disposable migration-test databases only; no remote or cloud URL is allowed.
//
// "First Remake on us" (migration 684): two Video Remake runs of ONE account
// that both need the offer's cover, admitted at the same moment, must not both
// take it. One psql session cannot show that, so this proof opens two
// connections:
//   1. forced interleaving: the first grant is taken inside an open
//      transaction; the second is seen WAITING on the account's profile row
//      lock, and once the first commits it is refused (FIRST_REMAKE_UNAVAILABLE)
//      and grants nothing;
//   2. a free race of two grants on a fresh account: exactly one lands, the
//      balance holds ONE cover;
//   3. the run's two holds settling at once from two connections: the offer is
//      finalized exactly once, with what the cover paid;
//   4. the cover is the run's alone, on real commits: another job's hold is
//      refused while it is held (the narrow fence, nothing taken), while the
//      run's child draws own credits first, then the cover;
//   5. two affordable first runs racing (no quote): neither is refused, exactly
//      one takes the offer (cover 0), and another job spends as before;
//   6. the run cancelled while its child's hold settles, in both orders from two
//      connections: no deadlock (profile, then offer, on every path), and the
//      offer ends once, with its end time noted.
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import pg from "pg"

const url = new URL(process.env.DATABASE_URL ?? "")
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("This proof requires a disposable local database")
const admin = new pg.Client({ connectionString: url.href })
const clients = [new pg.Client({ connectionString: url.href }), new pg.Client({ connectionString: url.href })]
const users = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()]
const GRANT = "SELECT public.grant_first_remake_cover($1, $2, $3) AS cover"
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

async function account(userId) {
  await admin.query("INSERT INTO auth.users(id,email,raw_user_meta_data,aud,role) VALUES($1,$2,'{}','authenticated','authenticated')", [userId, `${userId}@test.invalid`])
  await admin.query(
    "UPDATE public.profiles SET subscription_credits = 300, topup_credits = 0, lifetime_topup_credits = 0, tier = 'free', subscription_tier = 'free', free_grant_state = 'granted' WHERE id = $1",
    [userId],
  )
}

async function run(userId, parentJobId = null) {
  const id = randomUUID()
  await admin.query(
    "INSERT INTO public.jobs(id,user_id,status,job_type,input_data,parent_job_id) VALUES($1,$2,'pending',$3,$4,$5)",
    [id, userId, parentJobId ? "generate-video" : "cast-swap", parentJobId ? "{}" : '{"type":"cast-swap"}', parentJobId],
  )
  return id
}

async function balance(userId) {
  const { rows: [r] } = await admin.query("SELECT subscription_credits + topup_credits AS b FROM public.profiles WHERE id = $1", [userId])
  return Number(r.b)
}

const refused = (err) => String(err?.message ?? err).startsWith("FIRST_REMAKE_UNAVAILABLE")

try {
  for (const u of users) await account(u)
  for (const client of clients) await client.query("SET ROLE service_role")

  // 1. Forced interleaving.
  {
    const u = users[0]
    const [j1, j2] = [await run(u), await run(u)]
    await clients[0].query("BEGIN")
    const { rows: [first] } = await clients[0].query(GRANT, [u, j1, 520])
    assert.equal(first.cover, 220, "the first grant covers quote - balance")
    assert.equal(await balance(u), 300, "the cover is held on the offer, not in the balance")
    const { rows: [{ pid }] } = await clients[1].query("SELECT pg_backend_pid() AS pid")
    const second = clients[1].query(GRANT, [u, j2, 520]).then(() => "granted", (err) => (refused(err) ? "refused" : String(err)))
    assert.equal(await waitUntilBlocked(pid), true, "the second grant waits on the account's profile row lock")
    await clients[0].query("COMMIT")
    assert.equal(await second, "refused", "the second grant is refused once the first commits")
    const { rows: [{ n }] } = await admin.query("SELECT count(*)::int AS n FROM public.first_remake_offers WHERE user_id = $1", [u])
    assert.equal(n, 1, "one offer")
  }

  // 2. A free race.
  {
    const u = users[1]
    const [j1, j2] = [await run(u), await run(u)]
    const outcomes = await Promise.all(
      [[clients[0], j1], [clients[1], j2]].map(([c, j]) => c.query(GRANT, [u, j, 520]).then((r) => r.rows[0].cover, (err) => (refused(err) ? "refused" : String(err)))),
    )
    assert.equal(outcomes.filter((o) => o === 220).length, 1, `exactly one of two racing grants lands: ${JSON.stringify(outcomes)}`)
    assert.equal(outcomes.filter((o) => o === "refused").length, 1, `the other is refused: ${JSON.stringify(outcomes)}`)
    assert.equal(await balance(u), 300, "the balance untouched")
    const { rows: [{ n }] } = await admin.query("SELECT count(*)::int AS n FROM public.first_remake_offers WHERE user_id = $1", [u])
    assert.equal(n, 1, "one offer row")
  }

  // 3. Two holds of the run settling at once, from two connections.
  {
    const u = users[2]
    const j = await run(u)
    const child = await run(u, j)
    await admin.query(GRANT, [u, j, 520])
    const { rows: [{ fee }] } = await admin.query("SELECT public.reserve_credits($1, 260, $2, 'cast-swap') AS fee", [u, j])
    const { rows: [{ kid }] } = await admin.query("SELECT public.reserve_credits($1, 260, $2, 'seedance-2-5') AS kid", [u, child])
    await admin.query("UPDATE public.jobs SET status = 'completed' WHERE id = $1", [j])
    await Promise.all([
      clients[0].query("SELECT public.commit_credits($1, 200)", [fee]),
      clients[1].query("SELECT public.commit_credits($1, 200)", [kid]),
    ])
    const { rows: [o] } = await admin.query(
      "SELECT status, settled_credits, cover_remaining, cover_spent FROM public.first_remake_offers WHERE job_id = $1",
      [j],
    )
    // fee 260 from own credits (40 back to them), child 40 own + 220 cover (60 back to the cover).
    assert.deepEqual(o, { status: "used", settled_credits: 400, cover_remaining: 0, cover_spent: 160 }, "finalized once, at the run's whole settlement")
    assert.equal(await balance(u), 60, "own credits got back only what their holds left unused")
    const { rows: [{ n }] } = await admin.query(
      "SELECT count(*)::int AS n FROM public.credit_transactions WHERE user_id = $1 AND source = 'first_remake_cover'",
      [u],
    )
    assert.equal(n, 1, "one ledger row of what the cover paid")
  }

  // 4. The cover is the run's alone, committed for real.
  {
    const u = users[3]
    const j = await run(u)
    const child = await run(u, j)
    const other = randomUUID()
    await admin.query("INSERT INTO public.jobs(id,user_id,status,job_type,input_data) VALUES($1,$2,'pending','generate-image','{}')", [other, u])
    await admin.query(GRANT, [u, j, 520])
    const refusedHold = await clients[0].query("SELECT public.reserve_credits($1, 400, $2, 'gpt-image-2')", [u, other]).then(
      () => "admitted",
      (err) => String(err?.message ?? err).split(":")[0],
    )
    assert.equal(refusedHold, "FIRST_REMAKE_IN_PROGRESS", "another job's hold is refused while the cover is held (the narrow fence)")
    assert.equal(await balance(u), 300, "the refused hold took nothing")
    await clients[1].query("SELECT public.reserve_credits($1, 400, $2, 'seedance-2-5')", [u, child])
    const { rows: [left] } = await admin.query("SELECT cover_remaining FROM public.first_remake_offers WHERE job_id = $1", [j])
    assert.equal(await balance(u), 0, "the run's child: own credits first")
    assert.equal(left.cover_remaining, 120, "then 100 of the cover")
  }

  // 5. Two affordable first runs at once.
  {
    const u = users[4]
    const [j1, j2] = [await run(u), await run(u)]
    const covers = await Promise.all([clients[0].query(GRANT, [u, j1, null]), clients[1].query(GRANT, [u, j2, null])].map((q) => q.then((r) => r.rows[0].cover)))
    assert.deepEqual(covers, [0, 0], "neither affordable run is refused, neither is covered")
    const { rows } = await admin.query("SELECT status, cover_credits FROM public.first_remake_offers WHERE user_id = $1", [u])
    assert.deepEqual(rows, [{ status: "in_use", cover_credits: 0 }], "exactly one takes the offer")
    const other = randomUUID()
    await admin.query("INSERT INTO public.jobs(id,user_id,status,job_type,input_data) VALUES($1,$2,'pending','generate-image','{}')", [other, u])
    await clients[0].query("SELECT public.reserve_credits($1, 50, $2, 'gpt-image-2')", [u, other])
    assert.equal(await balance(u), 250, "another job spends as before")
  }

  // 6. Cancel vs a settling child hold, both orders.
  for (const [k, settleFirst] of [[5, true], [6, false]]) {
    const u = users[k]
    const j = await run(u)
    const child = await run(u, j)
    await admin.query(GRANT, [u, j, 520])
    const { rows: [{ kid }] } = await admin.query("SELECT public.reserve_credits($1, 400, $2, 'seedance-2-5') AS kid", [u, child])
    const [first, second] = settleFirst ? [clients[0], clients[1]] : [clients[1], clients[0]]
    const settle = (c) => c.query("SELECT public.refund_credits($1)", [kid])
    const cancel = (c) => c.query("UPDATE public.jobs SET status = 'cancelled' WHERE id = $1", [j])
    await first.query("BEGIN")
    await (settleFirst ? settle(first) : cancel(first))
    const { rows: [{ pid }] } = await second.query("SELECT pg_backend_pid() AS pid")
    const other = settleFirst ? cancel(second) : settle(second)
    // The second either waits on the first's locks or finds nothing to wait for; it must never deadlock.
    await waitUntilBlocked(pid)
    await first.query("COMMIT")
    await other
    const { rows: [o] } = await admin.query("SELECT status, cover_remaining, (run_ended_at IS NOT NULL) AS ended FROM public.first_remake_offers WHERE job_id = $1", [j])
    assert.deepEqual(o, { status: "released", cover_remaining: 0, ended: true }, `cancel vs settle (${settleFirst ? "settle first" : "cancel first"}): ended once, no deadlock`)
    assert.equal(await balance(u), 300, "own credits back, the cover dropped")
  }

  process.stdout.write("First Remake offer concurrency proof passed: two runs racing for the cover take it once, a waiting grant is refused, and holds settling at once finalize the offer exactly once\n")
} finally {
  for (const u of users) {
    await admin.query("DELETE FROM public.credit_transactions WHERE user_id = $1", [u])
    await admin.query("DELETE FROM public.usage_logs WHERE user_id = $1", [u])
    await admin.query("DELETE FROM public.first_remake_offers WHERE user_id = $1", [u])
    await admin.query("DELETE FROM public.jobs WHERE user_id = $1", [u])
    await admin.query("DELETE FROM auth.users WHERE id = $1", [u])
  }
  await Promise.all(clients.map((client) => client.end()))
  await admin.end()
}
