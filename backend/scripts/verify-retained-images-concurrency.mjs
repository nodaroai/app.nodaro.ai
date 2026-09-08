// Disposable migration-test databases only. Refuse network/cloud connection URLs.
import assert from "node:assert/strict"
import pg from "pg"

const url = new URL(process.env.DATABASE_URL ?? "")
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("This proof requires a disposable local database")
const admin = new pg.Client({ connectionString: url.href })
const clients = [new pg.Client({ connectionString: url.href }), new pg.Client({ connectionString: url.href })]
await admin.connect()
await Promise.all(clients.map((client) => client.connect()))
const created = []
try {
  for (const client of clients) await client.query("SET ROLE service_role")
  for (const [group, mediaKinds] of [["images", ["image", "image"]], ["videos", ["video", "video"]], ["mixed", ["image", "video"]]]) for (const [suffix, sameHash] of [[990, false], [991, true]]) {
    const id = `00000000-0000-4000-8000-${String(suffix + (group === "videos" ? 2 : group === "mixed" ? 4 : 0)).padStart(12, "0")}`
    const projectId = `c${id.slice(1)}`, workflowId = `d${id.slice(1)}`
    await admin.query("INSERT INTO auth.users(id,email,raw_user_meta_data,aud,role) VALUES($1,$2,'{}','authenticated','authenticated')",
      [id, `retained-concurrency-${group}-${suffix}@test.invalid`])
    created.push(id)
    await admin.query("INSERT INTO public.projects(id,user_id,name) VALUES($1,$2,'Retained concurrency proof')", [projectId, id])
    await admin.query("INSERT INTO public.workflows(id,project_id,user_id,name) VALUES($1,$2,$3,'Retained concurrency proof')", [workflowId, projectId, id])
    await admin.query("UPDATE public.profiles SET storage_used_bytes=0,storage_limit_bytes=1000 WHERE id=$1", [id])
    const results = await Promise.allSettled(clients.map((client, index) => { const media = mediaKinds[index]; return client.query(
      `SELECT public.reserve_retained_${media}($1,$2,$3,800,10,10,${media === "video" ? "1200," : ""}'${media === "video" ? "video/mp4" : "image/png"}','enforce') AS snapshot`,
      [id, workflowId, (sameHash || index === 0 ? "a" : "b").repeat(64)],
    ) }))
    const fulfilled = results.filter((result) => result.status === "fulfilled")
    const shared = sameHash && group !== "mixed"
    assert.equal(fulfilled.length, shared ? 2 : 1)
    if (shared) assert.equal(fulfilled[0].value.rows[0].snapshot.id, fulfilled[1].value.rows[0].snapshot.id)
    else assert.match(results.find((result) => result.status === "rejected").reason.message, /Storage limit exceeded/)
    const { rows } = await admin.query("SELECT storage_used_bytes,((SELECT count(*) FROM public.retained_images WHERE user_id=$1)+(SELECT count(*) FROM public.retained_videos WHERE user_id=$1)) AS snapshots FROM public.profiles WHERE id=$1", [id])
    assert.equal(Number(rows[0].storage_used_bytes), 800)
    assert.equal(Number(rows[0].snapshots), 1)
  }
  process.stdout.write("Retained image/video concurrency proofs passed: quota isolation and identical-byte deduplication\n")
} finally {
  // These proofs never upload objects, so their queued cleanup tasks are empty.
  for (const id of created) {
    await admin.query("DELETE FROM auth.users WHERE id=$1", [id])
    await admin.query("DELETE FROM public.retained_image_gc WHERE user_id=$1", [id])
    await admin.query("DELETE FROM public.retained_video_gc WHERE user_id=$1", [id])
  }
  await Promise.all(clients.map((client) => client.end()))
  await admin.end()
}
