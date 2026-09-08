// Disposable migration-test databases only; no remote or cloud URL is allowed.
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import pg from "pg"
const url = new URL(process.env.DATABASE_URL ?? "")
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("This proof requires a disposable local database")
const admin = new pg.Client({ connectionString: url.href })
const clients = [new pg.Client({ connectionString: url.href }), new pg.Client({ connectionString: url.href })]
const userId = randomUUID(), projectId = randomUUID()
await admin.connect()
await Promise.all(clients.map((client) => client.connect()))
try {
  await admin.query("INSERT INTO auth.users(id,email,raw_user_meta_data,aud,role) VALUES($1,$2,'{}','authenticated','authenticated')", [userId, `${userId}@test.invalid`])
  await admin.query("INSERT INTO public.projects(id,user_id,name) VALUES($1,$2,'Compatible concurrency')", [projectId, userId])
  for (const client of clients) await client.query("SET ROLE service_role")
  const { rows: [workflow] } = await clients[0].query("SELECT * FROM public.create_compatible_workflow($1)", [{
    user_id: userId, project_id: projectId, name: "Film", nodes: [], edges: [], settings: { studio: { keyframes: [] } }, app_slug: "studio",
  }])
  const results = await Promise.all(clients.map((client, i) => client.query(
    "SELECT * FROM public.compare_and_swap_compatible_workflow($1,$2,$3)",
    [workflow.id, workflow.version, { name: `Writer ${i}`, settings: { studio: { keyframes: [], settledJobIds: [`job-${i}`] } } }],
  )))
  const winners = results.filter((result) => result.rowCount === 1)
  assert.equal(winners.length, 1, "exactly one writer may win the loaded revision")
  const { rows: [stored] } = await admin.query("SELECT version,name,settings FROM public.workflows WHERE id=$1", [workflow.id])
  assert.equal(stored.version, workflow.version + 1)
  assert.equal(stored.name, winners[0].rows[0].name)
  assert.deepEqual(stored.settings, winners[0].rows[0].settings)
  for (const client of clients) {
    const { rows: [flag] } = await client.query("SELECT current_setting('nodaro.compatible_workflow_write',true) AS value")
    assert.notEqual(flag.value, "on", "the compatible-write authority must not leak to a reused connection")
  }
  process.stdout.write("Compatible workflow concurrency proof passed: one winner, preserved document and no leaked authority\n")
} finally {
  await admin.query("DELETE FROM auth.users WHERE id=$1", [userId])
  await Promise.all(clients.map((client) => client.end()))
  await admin.end()
}
