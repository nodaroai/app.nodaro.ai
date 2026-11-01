// @test-reads-none an in-memory database double; reads no repo file
/**
 * A pipeline drive's claim (`running`) is a compare-and-set.
 *
 * `drivePipeline` reads the pipeline, then claims it. In between, another
 * write can end it: the concurrency lanes' queued sweep failing a pipeline
 * that waited past its queue timeout, or a user's Cancel. The claim used to
 * overwrite either with `running` and run the next stage. Now a claim that
 * matches no row drives nothing: no stage, no status event, no lane-wait
 * credit on the dead row.
 *
 * The pipeline row lives in a filtering in-memory database (fake-sweep-db),
 * so the claim's own filter decides; the other write lands right after the
 * drive's row read.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { makeSweepDb, type SweepDb } from "../../../lib/concurrency-lanes/__tests__/fake-sweep-db.js"

const h = vi.hoisted(() => ({
  // Manual mode: the script stage stops for review (its row written by the engine).
  script: vi.fn(async () => ({ status: "awaiting_approval", plan: {} })),
  published: [] as Array<{ type: string; status?: string }>,
}))

vi.mock("../stages/script.js", () => ({ runScriptStage: h.script }))
vi.mock("../events.js", () => ({ pipelineEvents: { publish: (e: { type: string; status?: string }) => { h.published.push(e) } } }))

const { drivePipeline, PIPELINE_CLAIM_STATUSES } = await import("../engine.js")

const PIPELINE = "00000000-0000-4000-8000-0000000000f1"
let db: SweepDb

/** The database, with `between` landing right after the drive's first read of the pipeline row. */
function clientWith(between: (() => void) | null) {
  let read = false
  return {
    from(table: string) {
      const q = db.client.from(table) as Record<string, unknown> & { single: () => Promise<unknown> }
      if (table !== "pipelines" || read || !between) return q
      const single = q.single
      q.single = async () => {
        const r = await single()
        read = true
        between()
        return r
      }
      return q
    },
  }
}

const row = () => db.row("pipelines", PIPELINE)!
const statusWrites = () => db.writes.filter((w) => w.table === "pipelines" && w.patch?.status === "running" && w.ids.length > 0)

beforeEach(() => {
  db = makeSweepDb()
  h.script.mockClear()
  h.published.length = 0
  db.rows("pipelines").push({
    id: PIPELINE, user_id: "U", status: "queued", lane_wait_ms: 0, lane_queued_at: new Date(Date.now() - 60_000).toISOString(),
  })
  vi.spyOn(console, "warn").mockImplementation(() => undefined)
})

describe("a pipeline drive's claim is a compare-and-set", () => {
  it("claims from every open status", () => {
    expect([...PIPELINE_CLAIM_STATUSES].sort()).toEqual(["awaiting_approval", "queued", "running"])
  })

  it("control: a queued pipeline nothing ended is claimed and its first stage runs", async () => {
    await drivePipeline({ supabase: clientWith(null) as never, pipelineId: PIPELINE })
    expect(statusWrites()).toHaveLength(1)
    expect(h.script).toHaveBeenCalledTimes(1)
    expect(h.published).toContainEqual({ type: "pipeline:status", pipelineId: PIPELINE, status: "running" })
    // The minute it waited for its run slot is credited.
    expect(Number(row().lane_wait_ms)).toBeGreaterThanOrEqual(59_000)
  })

  it("a pipeline the sweep failed between the drive's read and its claim does not run", async () => {
    await drivePipeline({
      supabase: clientWith(() => Object.assign(row(), { status: "failed", failure_reason: "queue_timeout" })) as never,
      pipelineId: PIPELINE,
    })
    expect(row().status).toBe("failed")
    expect(h.script).not.toHaveBeenCalled()
    expect(h.published).toEqual([])
    expect(db.writes.filter((w) => w.table === "pipelines" && w.ids.length > 0)).toEqual([])
  })

  it("a pipeline the user cancelled between the drive's read and its claim does not run", async () => {
    await drivePipeline({ supabase: clientWith(() => Object.assign(row(), { status: "cancelled" })) as never, pipelineId: PIPELINE })
    expect(row().status).toBe("cancelled")
    expect(h.script).not.toHaveBeenCalled()
    expect(h.published).toEqual([])
  })
})
