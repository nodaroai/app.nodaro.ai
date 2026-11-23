// Disposable migration-test databases only; no remote or cloud URL is allowed.
//
// Favorite picker options (migration 688): a person keeps at most 1000, held
// by a BEFORE INSERT trigger that takes a per-person transaction lock and then
// counts. Two stars at once with one place left must not both land. One psql
// session cannot show that, so this proof opens two connections:
//   1. forced interleaving: the 1000th star is taken inside an open
//      transaction; a second star is seen WAITING on the person's lock, and once
//      the first commits it is refused (check_violation
//      catalog_favorites_per_user_cap);
//   2. a free race of two stars on a fresh person with one place left: exactly
//      one lands, the count is 1000;
//   3. another person's star is never held up by this person's open star.
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import pg from "pg"

const url = new URL(process.env.DATABASE_URL ?? "")
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("This proof requires a disposable local database")
const admin = new pg.Client({ connectionString: url.href })
const clients = [new pg.Client({ connectionString: url.href }), new pg.Client({ connectionString: url.href })]
const users = [randomUUID(), randomUUID(), randomUUID()]
const STAR = "INSERT INTO public.catalog_favorites (user_id, catalog, option_id) VALUES ($1, 'style', $2) ON CONFLICT (user_id, catalog, option_id) DO NOTHING"
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

/** A person with `n` favorite options already. */
async function person(userId, n) {
  await admin.query("INSERT INTO auth.users(id,email,raw_user_meta_data,aud,role) VALUES($1,$2,'{}','authenticated','authenticated')", [userId, `${userId}@test.invalid`])
  await admin.query("INSERT INTO public.catalog_favorites (user_id, catalog, option_id) SELECT $1, 'style', 'opt-' || g FROM generate_series(1, $2::int) AS g", [userId, n])
}

async function count(userId) {
  const { rows: [r] } = await admin.query("SELECT count(*)::int AS n FROM public.catalog_favorites WHERE user_id = $1", [userId])
  return r.n
}

const outcome = (p) => p.then(() => "starred", (err) => (err?.code === "23514" && String(err.message) === "catalog_favorites_per_user_cap" ? "refused" : String(err)))

try {
  for (const client of clients) await client.query("SET ROLE service_role")

  // 1. Forced interleaving.
  {
    const u = users[0]
    await person(u, 999)
    await clients[0].query("BEGIN")
    await clients[0].query(STAR, [u, "last-place"])
    const { rows: [{ pid }] } = await clients[1].query("SELECT pg_backend_pid() AS pid")
    const second = outcome(clients[1].query(STAR, [u, "one-too-many"]))
    assert.equal(await waitUntilBlocked(pid), true, "the second star waits on the person's lock")
    await clients[0].query("COMMIT")
    assert.equal(await second, "refused", "the second star is refused once the first commits")
    assert.equal(await count(u), 1000, "the person holds exactly 1000")
  }

  // 2. A free race with one place left.
  {
    const u = users[1]
    await person(u, 999)
    const results = await Promise.all([outcome(clients[0].query(STAR, [u, "a"])), outcome(clients[1].query(STAR, [u, "b"]))])
    assert.deepEqual([...results].sort(), ["refused", "starred"], "exactly one of two racing stars lands")
    assert.equal(await count(u), 1000, "the person holds exactly 1000")
  }

  // 3. Another person is never held up.
  {
    const [u, other] = [users[0], users[2]]
    await person(other, 0)
    await clients[0].query("BEGIN")
    await clients[0].query("DELETE FROM public.catalog_favorites WHERE user_id = $1 AND option_id = 'opt-1'", [u])
    await clients[0].query(STAR, [u, "refill"])
    await clients[1].query("SET statement_timeout = '3s'")
    assert.equal(await outcome(clients[1].query(STAR, [other, "free"])), "starred", "another person stars while this one's star is open")
    await clients[1].query("RESET statement_timeout")
    await clients[0].query("COMMIT")
  }

  console.log("catalog favorites cap concurrency: ALL ASSERTIONS PASSED")
} finally {
  for (const u of users) await admin.query("DELETE FROM auth.users WHERE id = $1", [u]).catch(() => {})
  await Promise.all([admin.end(), ...clients.map((client) => client.end())])
}
