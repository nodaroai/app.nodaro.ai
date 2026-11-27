// Two real connections are needed to verify contention between a funding
// transaction, a settlement/refund holding the usage row, and another grant.
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import pg from "pg"

const url = new URL(process.env.DATABASE_URL ?? "")
const socket = url.searchParams.get("host")
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || (socket && !socket.startsWith("/"))) throw new Error("Use a disposable local database")
const admin = new pg.Client({ connectionString: url.href })
const first = new pg.Client({ connectionString: url.href })
const second = new pg.Client({ connectionString: url.href })
// The server's own calls (reserve, prepare, commit, the retry), with the service role's privileges.
const server = new pg.Client({ connectionString: url.href })
const user = randomUUID()
const job = randomUUID()
// An environment of this run's own: its unpaid-charge enforcement is saved (and removed) here.
const env = `verify-${randomUUID()}`
const policyKey = `video_route_policy:${env}`
let log

async function topup(client, amount) {
  await client.query("BEGIN")
  try {
    await client.query("UPDATE profiles SET topup_credits=topup_credits+$2 WHERE id=$1", [user, amount])
    await client.query("INSERT INTO topup_grants(user_id,amount,source,expires_at) VALUES($1,$2,'admin',now()+interval '1 year')", [user, amount])
    await client.query("COMMIT")
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  }
}

await Promise.all([admin.connect(), first.connect(), second.connect(), server.connect()])
// Each connection calls as this environment's server does: the service role, naming its environment.
// `admin` alone keeps the connection's own role, for the fixtures and the reads that check them: every
// function and every funding write below runs with exactly the privileges the server has.
for (const client of [admin, first, second, server]) {
  await client.query("SELECT set_config('request.jwt.claims', $1, false), set_config('request.headers', $2, false)", [JSON.stringify({ role: "service_role" }), JSON.stringify({ "x-nodaro-env": env })])
}
for (const client of [first, second, server]) await client.query("SET ROLE service_role")
try {
  await admin.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [user, `${user}@example.test`])
  await admin.query("UPDATE profiles SET subscription_credits=120,topup_credits=0,lifetime_topup_credits=1 WHERE id=$1", [user])
  await admin.query("INSERT INTO jobs(id,user_id,status) VALUES($1,$2,'pending')", [job, user])
  const reserved = await server.query("SELECT reserve_video_route_credits($1,100,$2,'ugc-clip','token',$3) AS r", [user, job, env])
  log = reserved.rows[0].r.usageLogId
  await server.query("SELECT prepare_video_route_run($1,$2,$3,'ugc-clip',100,'token',$4,'{}')", [job, user, log, env])
  await server.query("UPDATE jobs SET status='completed' WHERE id=$1", [job])
  await server.query("SELECT commit_video_route_credits($1,$2,500)", [log, job])

  // DORMANT (the shipped state: enforcement was never saved for this
  // environment). The unpaid 380 is recorded and nothing collects it: a grant
  // commits untouched even while another transaction holds the usage log.
  await first.query("BEGIN")
  await first.query("SELECT id FROM usage_logs WHERE id=$1 FOR UPDATE", [log])
  await topup(second, 7)
  await first.query("ROLLBACK")
  const dormant = (await admin.query("SELECT d.remaining,d.pool_remaining,p.topup_credits,l.credits_charged FROM video_route_debts d JOIN profiles p ON d.user_id=p.id JOIN usage_logs l ON l.id=d.usage_log_id WHERE d.usage_log_id=$1", [log])).rows[0]
  assert.deepEqual(dormant, { remaining: 380, pool_remaining: 380, topup_credits: 7, credits_charged: 120 })
  assert.equal((await admin.query("SELECT count(*)::int AS n FROM video_route_repayments WHERE usage_log_id=$1", [log])).rows[0].n, 0)
  await admin.query("UPDATE profiles SET topup_credits=0 WHERE id=$1", [user])
  await admin.query("DELETE FROM topup_grants WHERE user_id=$1", [user])

  // ENFORCED from here: an admin turned it on for this environment.
  await admin.query("INSERT INTO app_settings(key,value) VALUES($1,'{\"enforceUnpaidCharges\":true}')", [policyKey])

  // A concurrent refund has locked the usage log but has not yet decided.
  // Funding NEVER fails or waits on a repayment: the grant commits whole, the
  // repayment that could not take its lock is undone and noted, and the debt
  // is untouched.
  await first.query("BEGIN")
  await first.query("SELECT id FROM usage_logs WHERE id=$1 FOR UPDATE", [log])
  await topup(second, 200)
  await first.query("ROLLBACK")
  const deferred = (await admin.query("SELECT d.remaining,p.topup_credits,l.credits_charged,(SELECT count(*)::int FROM video_route_deferred_repayments r WHERE r.user_id=d.user_id AND r.kind='pool' AND r.available=200) AS noted FROM video_route_debts d JOIN profiles p ON d.user_id=p.id JOIN usage_logs l ON l.id=d.usage_log_id WHERE d.usage_log_id=$1", [log])).rows[0]
  assert.deepEqual(deferred, { remaining: 380, topup_credits: 200, credits_charged: 120, noted: 1 })
  assert.equal((await admin.query("SELECT count(*)::int AS n FROM video_route_repayments WHERE usage_log_id=$1", [log])).rows[0].n, 0)
  // The same with the job row locked (a settlement in progress): the grant still commits.
  await first.query("BEGIN")
  await first.query("SELECT id FROM jobs WHERE id=$1 FOR UPDATE", [job])
  await topup(second, 50)
  await first.query("ROLLBACK")
  assert.equal((await admin.query("SELECT topup_credits FROM profiles WHERE id=$1", [user])).rows[0].topup_credits, 250)
  assert.equal((await admin.query("SELECT remaining FROM video_route_debts WHERE usage_log_id=$1", [log])).rows[0].remaining, 380)
  // And with the settlement's own ledger row locked (a settlement writing it): the grant commits at once, it never waits for it.
  await first.query("BEGIN")
  await first.query("SELECT id FROM video_route_ledger WHERE job_id=$1 AND kind='settle' FOR UPDATE", [job])
  const began = Date.now()
  await topup(second, 10)
  assert.ok(Date.now() - began < 2000, "a top-up waited behind a settlement's ledger row")
  await first.query("ROLLBACK")
  assert.equal((await admin.query("SELECT topup_credits FROM profiles WHERE id=$1", [user])).rows[0].topup_credits, 260)
  assert.equal((await admin.query("SELECT remaining FROM video_route_debts WHERE usage_log_id=$1", [log])).rows[0].remaining, 380)
  // Once the locks are free the noted repayments are applied, each once, by the retry the server runs on a timer.
  // With nothing it can take the retry still answers (it locks the notes it reads, as the service role).
  assert.deepEqual((await server.query("SELECT retry_deferred_video_repayments() AS n")).rows[0].n, { applied: 3, credits: 260, dropped: 0, failed: 0, stuck: 0 })
  assert.deepEqual((await server.query("SELECT retry_deferred_video_repayments() AS n")).rows[0].n, { applied: 0, credits: 0, dropped: 0, failed: 0, stuck: 0 })
  const applied = (await admin.query("SELECT d.remaining,p.topup_credits,l.credits_charged,(SELECT count(*)::int FROM video_route_deferred_repayments r WHERE r.user_id=d.user_id) AS noted FROM video_route_debts d JOIN profiles p ON d.user_id=p.id JOIN usage_logs l ON l.id=d.usage_log_id WHERE d.usage_log_id=$1", [log])).rows[0]
  assert.deepEqual(applied, { remaining: 120, topup_credits: 0, credits_charged: 380, noted: 0 })

  // Two independent real grants both commit; only the outstanding 120 is
  // consumed (by the grant that gets there, or by a retry when both were deferred).
  await Promise.all([topup(first, 200), topup(second, 200)])
  await server.query("SELECT retry_deferred_video_repayments()")
  const state = (await admin.query("SELECT d.remaining,p.topup_credits,l.credits_charged FROM video_route_debts d JOIN profiles p ON d.user_id=p.id JOIN usage_logs l ON l.id=d.usage_log_id WHERE d.usage_log_id=$1", [log])).rows[0]
  assert.deepEqual(state, { remaining: 0, topup_credits: 280, credits_charged: 500 })
  assert.equal((await admin.query("SELECT coalesce(sum(credits),0)::int AS n FROM video_route_repayments WHERE usage_log_id=$1", [log])).rows[0].n, 380)
  process.stdout.write("Routed funding contention and concurrent top-up recovery passed\n")
} finally {
  await Promise.all([first.end(), second.end(), server.end()])
  if (log) {
    await admin.query("DELETE FROM video_route_deferred_repayments WHERE user_id=$1", [user])
    await admin.query("DELETE FROM video_route_repayments WHERE usage_log_id=$1", [log])
    await admin.query("DELETE FROM video_route_debts WHERE usage_log_id=$1", [log])
  }
  await admin.query("DELETE FROM app_settings WHERE key=$1", [policyKey])
  await admin.query("DELETE FROM video_route_ledger WHERE job_id=$1", [job])
  await admin.query("DELETE FROM credit_transactions WHERE user_id=$1", [user])
  await admin.query("DELETE FROM auth.users WHERE id=$1", [user])
  await admin.end()
}
