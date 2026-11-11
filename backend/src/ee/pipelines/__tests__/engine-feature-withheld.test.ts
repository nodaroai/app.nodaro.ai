// @test-reads-none an in-memory database double; reads no repo file
/**
 * The film pipeline (`film-pipeline`) is a gateable feature. Its REST and MCP
 * doors refuse every request that starts or continues a pipeline where it is
 * withheld, but a drive needs no request: an auto-mode run goes on stage after
 * stage, and the reconcile cron and a resume re-drive pipelines on their own.
 * So the engine asks again before every stage it runs, as the workflow
 * orchestrator asks a node's availability before each node: where the feature
 * is now withheld from the pipeline's owner, the next stage does not start and
 * the pipeline fails (`node_not_available`), its unspent reservation refunded.
 * A pipeline paused at an approval gate stays paused, and on a deployment with
 * no node lists nothing changes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { makeSweepDb, type SweepDb } from "../../../lib/concurrency-lanes/__tests__/fake-sweep-db.js"

const h = vi.hoisted(() => ({
  // Manual mode: the script stage stops for review (its row written by the engine).
  script: vi.fn(async () => ({ status: "awaiting_approval", plan: {} })),
  published: [] as Array<{ type: string; status?: string }>,
  refunds: [] as Array<{ userId: string; pipelineId: string; credits?: number; reason: string }>,
}))

vi.mock("../stages/script.js", () => ({ runScriptStage: h.script }))
vi.mock("../events.js", () => ({ pipelineEvents: { publish: (e: { type: string; status?: string }) => { h.published.push(e) } } }))
vi.mock("../credits.js", () => ({
  refundPipelineCredits: async (args: { userId: string; pipelineId: string; credits?: number; reason: string }) => {
    h.refunds.push({ userId: args.userId, pipelineId: args.pipelineId, credits: args.credits, reason: args.reason })
  },
}))
vi.mock("../../../lib/admin-check.js", () => ({ checkIsAdmin: async () => false }))

const { drivePipeline } = await import("../engine.js")
const { __resetSurfaceProfileCacheForTests } = await import("../../../lib/surface-profile.js")
const { __availabilityUniverseReadyForTests, __resetAvailabilityOverridesForTests, storedNodesEnabled } = await import(
  "../../../lib/availability-override.js"
)

const PIPELINE = "00000000-0000-4000-8000-0000000000f2"
let db: SweepDb

function setProfile(profile: object | null): void {
  if (profile === null) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = JSON.stringify(profile)
  __resetSurfaceProfileCacheForTests()
}

const row = () => db.row("pipelines", PIPELINE)!
const drive = () => drivePipeline({ supabase: db.client as never, pipelineId: PIPELINE })

beforeEach(async () => {
  await __availabilityUniverseReadyForTests()
  db = makeSweepDb()
  h.script.mockClear()
  h.published.length = 0
  h.refunds.length = 0
  db.rows("pipelines").push({
    id: PIPELINE, user_id: "U", status: "queued", mode: "auto", reserved_credits: 900, spent_credits: 120, lane_wait_ms: 0,
  })
  vi.spyOn(console, "warn").mockImplementation(() => undefined)
})
afterEach(() => {
  setProfile(null)
  __resetAvailabilityOverridesForTests()
})

describe("a pipeline drive asks the film pipeline's availability before the stage it runs", () => {
  it("runs the stage on a deployment with no node lists and no override (nothing changes)", async () => {
    await drive()
    expect(h.script).toHaveBeenCalledTimes(1)
    expect(row().status).not.toBe("failed")
    expect(h.refunds).toEqual([])
  })

  it("runs it where the deployment lists film-pipeline", async () => {
    setProfile({ nodes: { allow: ["generate-image", "film-pipeline"] } })
    await drive()
    expect(h.script).toHaveBeenCalledTimes(1)
  })

  it("runs it under an override stored before film-pipeline was gateable", async () => {
    __resetAvailabilityOverridesForTests({ nodes: new Set(storedNodesEnabled(["generate-image", "cast-swap"], 1)) })
    await drive()
    expect(h.script).toHaveBeenCalledTimes(1)
  })

  it("where it is withheld: the stage does not start, the pipeline fails node_not_available, the unspent reservation is refunded", async () => {
    setProfile({ nodes: { allow: ["generate-image"] } })
    await drive()
    expect(h.script).not.toHaveBeenCalled()
    expect(row()).toMatchObject({ status: "failed", failure_reason: "node_not_available" })
    expect(h.published).toContainEqual({ type: "pipeline:status", pipelineId: PIPELINE, status: "failed" })
    expect(h.refunds).toEqual([{ userId: "U", pipelineId: PIPELINE, credits: 780, reason: "pipeline_failed:node_not_available" }])
  })

  it("an override saved by this code with it off fails a user's pipeline the same way", async () => {
    __resetAvailabilityOverridesForTests({ nodes: new Set(storedNodesEnabled(["generate-image"])) })
    await drive()
    expect(h.script).not.toHaveBeenCalled()
    expect(row().status).toBe("failed")
  })

  it("a pipeline paused at an approval gate stays paused: no stage would run", async () => {
    setProfile({ nodes: { allow: ["generate-image"] } })
    Object.assign(row(), { status: "awaiting_approval" })
    db.rows("pipeline_stages").push({ id: "s1", pipeline_id: PIPELINE, stage_name: "script", status: "awaiting_approval", stage_order: 1 })
    await drive()
    expect(h.script).not.toHaveBeenCalled()
    expect(row().status).not.toBe("failed")
    expect(h.refunds).toEqual([])
  })
})
