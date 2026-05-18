import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../credits.js", () => ({
  refundPipelineCredits: vi.fn(async () => undefined),
}))
vi.mock("../events.js", () => ({
  pipelineEvents: { publish: vi.fn() },
}))
vi.mock("../depends-on.js", () => ({
  orphanAllEntityNodes: vi.fn(async () => undefined),
}))

import { forkPipeline } from "../fork.js"
import { refundPipelineCredits } from "../credits.js"
import { pipelineEvents } from "../events.js"
import { orphanAllEntityNodes } from "../depends-on.js"

beforeEach(() => {
  vi.clearAllMocks()
})

interface PipelineFixture {
  status: string
  user_id?: string
  reservation_usage_log_id: string | null
  forked_at: string | null
  forked_status?: string | null
  fork_reason?: string | null
}

interface SupabaseFixture {
  pipelineUpdates: Array<Record<string, unknown>>
  entitiesUpdates: Array<Record<string, unknown>>
}

function makeSupabaseMock(pipeline: PipelineFixture): {
  client: unknown
  fixture: SupabaseFixture
} {
  const fixture: SupabaseFixture = {
    pipelineUpdates: [],
    entitiesUpdates: [],
  }
  const client = {
    from(table: string) {
      if (table === "pipelines") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: pipeline, error: null }),
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: async () => {
              fixture.pipelineUpdates.push(patch)
              return { error: null }
            },
          }),
        }
      }
      if (table === "pipeline_entities") {
        return {
          update: (patch: Record<string, unknown>) => ({
            eq: async () => {
              fixture.entitiesUpdates.push(patch)
              return { error: null }
            },
          }),
        }
      }
      throw new Error(`unmocked table: ${table}`)
    },
  }
  return { client, fixture }
}

describe("forkPipeline", () => {
  it("transitions pipeline to forked + orphans nodes + refunds + emits event", async () => {
    const { client, fixture } = makeSupabaseMock({
      status: "awaiting_approval",
      user_id: "u1",
      reservation_usage_log_id: "log-1",
      forked_at: null,
    })
    const result = await forkPipeline(client as never, "p1")
    expect(result.ok).toBe(true)
    expect(result.pipelineId).toBe("p1")
    expect(result.forkedStatus).toBe("awaiting_approval")
    expect(result.forkReason).toBe("user_takeover")
    // pipelines row was flipped to forked with correct snapshot fields.
    expect(fixture.pipelineUpdates).toHaveLength(1)
    expect(fixture.pipelineUpdates[0]).toMatchObject({
      status: "forked",
      fork_reason: "user_takeover",
      forked_status: "awaiting_approval",
    })
    expect(typeof (fixture.pipelineUpdates[0] as { forked_at: string }).forked_at).toBe("string")
    // Every entity flagged is_forked=true.
    expect(fixture.entitiesUpdates).toEqual([{ is_forked: true }])
    // Every node orphaned.
    expect(orphanAllEntityNodes).toHaveBeenCalledWith(client, "p1")
    // Canonical refund helper invoked (looks up + clears reservation_usage_log_id).
    expect(refundPipelineCredits).toHaveBeenCalledWith(
      expect.objectContaining({
        pipelineId: "p1",
        reason: "fork:user_takeover",
      }),
    )
    // SSE event emitted with the right shape (schema in pipeline-state-types.ts).
    expect(pipelineEvents.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "pipeline:forked",
        pipelineId: "p1",
        forkedStatus: "awaiting_approval",
        forkReason: "user_takeover",
      }),
    )
  })

  it("is idempotent — second call returns the existing forked_at + skips side effects", async () => {
    const { client, fixture } = makeSupabaseMock({
      status: "forked",
      reservation_usage_log_id: "log-1",
      forked_at: "2026-05-18T12:00:00.000Z",
      forked_status: "running",
      fork_reason: "drift_unrecoverable",
    })
    const result = await forkPipeline(client as never, "p1")
    expect(result.forkedAt).toBe("2026-05-18T12:00:00.000Z")
    expect(result.forkedStatus).toBe("running")
    expect(result.forkReason).toBe("drift_unrecoverable")
    // No updates, no orphan, no refund, no events.
    expect(fixture.pipelineUpdates).toEqual([])
    expect(fixture.entitiesUpdates).toEqual([])
    expect(orphanAllEntityNodes).not.toHaveBeenCalled()
    expect(refundPipelineCredits).not.toHaveBeenCalled()
    expect(pipelineEvents.publish).not.toHaveBeenCalled()
  })

  it("invokes refund helper even when pipeline has no reservation_usage_log_id (helper is a no-op)", async () => {
    const { client } = makeSupabaseMock({
      status: "running",
      reservation_usage_log_id: null,
      forked_at: null,
    })
    await forkPipeline(client as never, "p1", "drift_unrecoverable")
    expect(orphanAllEntityNodes).toHaveBeenCalledWith(client, "p1")
    // Helper is called unconditionally — it short-circuits when no reservation
    // is on file. This keeps fork.ts simple (no manual null check).
    expect(refundPipelineCredits).toHaveBeenCalledWith(
      expect.objectContaining({
        pipelineId: "p1",
        reason: "fork:drift_unrecoverable",
      }),
    )
    // Event still emits — fork happened.
    expect(pipelineEvents.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: "pipeline:forked", forkReason: "drift_unrecoverable" }),
    )
  })
})
