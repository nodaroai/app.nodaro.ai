// Disposable migration-test databases only; never operate against cloud.
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import pg from "pg"
const url = new URL(process.env.DATABASE_URL ?? "")
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("This proof requires a disposable local database")
const admin = new pg.Client({ connectionString: url.href })
const first = new pg.Client({ connectionString: url.href }), second = new pg.Client({ connectionString: url.href })
const user = randomUUID(), project = randomUUID(), source = randomUUID(), destination = randomUUID()
const originalImage = randomUUID(), copiedImage = randomUUID(), job = randomUUID(), copy = randomUUID()
await Promise.all([admin.connect(), first.connect(), second.connect()])
try {
  for (const client of [admin, first, second]) await client.query("SET statement_timeout = '5s'")
  await admin.query("INSERT INTO auth.users(id,email,raw_user_meta_data,aud,role) VALUES($1,$2,'{}','authenticated','authenticated')", [user, `${user}@test.invalid`])
  await admin.query("INSERT INTO public.projects(id,user_id,name) VALUES($1,$2,'Copy proof concurrency')", [project,user])
  for (const id of [source,destination]) await admin.query("INSERT INTO public.workflows(id,project_id,user_id,name) VALUES($1,$2,$3,'Copy proof')", [id,project,user])
  for (const [id,workflow] of [[originalImage,source],[copiedImage,destination]]) {
    await admin.query("INSERT INTO public.retained_images(id,user_id,workflow_id,sha256,byte_length,width,height,content_type,charged) VALUES($1,$2,$3,repeat('a',64),10,1,1,'image/png',false)", [id,user,workflow])
    await admin.query("SELECT public.complete_retained_image($1,repeat('a',64))", [id])
  }
  await admin.query("INSERT INTO public.retained_job_images(job_id,user_id,workflow_id,image_id,submission_context) VALUES($1,$2,$3,$4,'{}')", [job,user,source,originalImage])
  for (const client of [first,second]) await client.query("SET ROLE service_role")
  const query = "SELECT public.record_retained_image_copy($1,$2,$3,$4,$5,$6,NULL,$7::jsonb) AS proof"
  const args = [copy,user,destination,copiedImage,source,job]
  await first.query("BEGIN")
  await first.query(query,[...args,{frame:"winner"}])
  const pid = (await second.query("SELECT pg_backend_pid() AS pid")).rows[0].pid
  const losing = second.query(query,[...args,{frame:"different"}]).then(result=>({result}),error=>({error}))
  let waiting = false
  for (let attempt=0;attempt<100;attempt++) {
    const status = await admin.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",[pid])
    if (status.rows[0]?.wait_event_type === "Lock") { waiting=true; break }
    await new Promise(resolve=>setTimeout(resolve,10))
  }
  assert.equal(waiting,true,"the second writer must contend with an uncommitted copy identity")
  await first.query("COMMIT")
  assert.equal((await losing).error?.code,"23505")
  const stored = await admin.query("SELECT context FROM public.retained_image_copies WHERE id=$1",[copy])
  assert.deepEqual(stored.rows,[{context:{frame:"winner"}}])
  const retry = await second.query(query,[...args,{frame:"winner"}])
  assert.equal(retry.rows[0].proof.id,copy)
  process.stdout.write("Retained image copy concurrency proof passed: observed contention, immutable winner, conflict and exact retry\n")
} finally {
  await first.query("ROLLBACK")
  await second.query("ROLLBACK")
  await admin.query("DELETE FROM public.workflows WHERE id=ANY($1::uuid[])",[[source,destination]])
  await admin.query("DELETE FROM public.projects WHERE id=$1",[project])
  await admin.query("DELETE FROM auth.users WHERE id=$1",[user])
  await admin.query("DELETE FROM public.retained_image_gc WHERE id=ANY($1::uuid[])",[[originalImage,copiedImage]])
  await Promise.all([first.end(),second.end(),admin.end()])
}
