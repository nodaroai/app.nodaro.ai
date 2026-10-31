// @test-watches supabase/migrations/*.sql backend/src/workers/*.ts
// The video and render workers' pickup reads of `jobs`: every column they name
// exists in the migrations (a select naming a missing column returns no row,
// and the worker would then run with no watermark, refund or visibility
// facts), and both carry every column concurrency admission reads.
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { jobsColumns, selectColumns } from "../../lib/__tests__/jobs-schema.js"
import { WORKER_ROW_COLUMNS } from "../../lib/concurrency-lanes/worker-admit.js"

const COLUMNS = jobsColumns()
const read = (file: string) => readFileSync(resolve(__dirname, "..", file), "utf8")

/** Every `.from("jobs")…select("…")` literal in `src`, and the render worker's named select list. */
function jobsSelects(src: string): string[] {
  const out: string[] = []
  for (const m of src.matchAll(/\.from\("jobs"\)((?:\s*\.\w+\([^()]*\))*?)\s*\.select\("([^"]+)"\)/g)) out.push(m[2]!)
  for (const m of src.matchAll(/const RENDER_JOB_COLUMNS =\s*"([^"]+)"/g)) out.push(m[1]!)
  return out
}

describe("worker-select-columns", () => {
  const sources = { "video-worker.ts": read("video-worker.ts"), "render-worker.ts": read("render-worker.ts") }

  it.each(Object.entries(sources))("every column %s selects from jobs exists in supabase/migrations", (_file, src) => {
    const selects = jobsSelects(src)
    expect(selects.length).toBeGreaterThan(0)
    const missing = selects.flatMap(selectColumns).filter((c) => !COLUMNS.has(c))
    expect(missing).toEqual([])
  })

  it.each(Object.entries(sources))("%s's pickup read carries every column admission reads", (_file, src) => {
    const pickup = jobsSelects(src).find((s) => s.includes("profiles!user_id"))
    expect(pickup, "the pickup read (with the profile join) was not found").toBeDefined()
    const read = new Set(selectColumns(pickup!))
    const needed = selectColumns(WORKER_ROW_COLUMNS).filter((c) => c !== "id")
    expect(needed.filter((c) => !read.has(c))).toEqual([])
    // ...and the admission columns are real columns too.
    expect(needed.filter((c) => !COLUMNS.has(c))).toEqual([])
  })
})
