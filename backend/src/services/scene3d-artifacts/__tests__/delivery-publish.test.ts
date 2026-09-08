import { beforeEach, describe, expect, it, vi } from "vitest"
const { fake } = vi.hoisted(() => ({ fake: { current: null as unknown } }))
vi.mock("@/lib/supabase.js", () => ({ get supabase() { return fake.current } }))
vi.mock("@/lib/workflow-access.js", async (original) => ({
  ...await original<typeof import("../../../lib/workflow-access.js")>(), workflowAccess: vi.fn(),
}))
import { workflowAccess } from "../../../lib/workflow-access.js"
import { publishScene3DDelivery } from "../delivery-publish.js"
import { deliveryFixture, OWNER, OTHER, JOB, SOURCE, REV, SOURCE_WF } from "./delivery-fixture.js"

let fixture: ReturnType<typeof deliveryFixture>
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(workflowAccess).mockResolvedValue("own")
  fixture = deliveryFixture()
  fake.current = fixture.db
})
const run = () => publishScene3DDelivery(fixture.input, fixture)

describe("delivery publication", () => {
  it("verifies actual bytes and publishes the exact source with both artifact pins", async () => {
    expect(await run()).toMatchObject({ deliveryId: JOB, revisionId: REV, status: "created" })
    expect(fixture.store.get).toHaveBeenCalledTimes(2)
    expect(fixture.authorizeJob).toHaveBeenCalledTimes(2)
    expect(fixture.db.rpc).toHaveBeenCalledWith("scene3d_publish_delivery", { payload: expect.objectContaining({
      source_owner_id: OWNER, source_workflow_id: SOURCE_WF, source_job_id: SOURCE,
      artifacts: expect.arrayContaining([expect.objectContaining({ usage: "poster" }), expect.objectContaining({ usage: "validation" })]),
    }) })
  })
  it("accepts only a matching authoring parent in authored mode", async () => {
    fixture.input.mode = "authored"
    await expect(run()).rejects.toThrow(/did not author/)
    expect(fixture.db.rpc).not.toHaveBeenCalled()
    fixture.db.tables.scene3d_revisions[0].source_job_id = JOB
    await expect(run()).resolves.toMatchObject({ status: "created" })
  })
  it("rejects correlation with a later render job", async () => {
    fixture.input.source.jobId = JOB
    await expect(run()).rejects.toThrow(/does not match/)
    expect(fixture.store.get).not.toHaveBeenCalled()
  })
  it("requires a real poster and report", async () => {
    fixture.input.artifacts.pop()
    await expect(run()).rejects.toThrow(/poster and validation report/)
    expect(fixture.db.rpc).not.toHaveBeenCalled()
  })
  it("rejects different scene contents even with the same revision id", async () => {
    fixture.input.plan = { ...fixture.input.plan as object, backgroundColor: "#ffffff" }
    await expect(run()).rejects.toThrow(/does not match/)
    expect(fixture.store.get).not.toHaveBeenCalled()
  })
  it("does not publish substituted bytes or mismatched receipts", async () => {
    fixture.db.tables.scene3d_upload_intents[0].receipt_sha256 = "f".repeat(64)
    await expect(run()).rejects.toThrow(/differs from its receipt/)
    expect(fixture.db.rpc).not.toHaveBeenCalled()
    fixture = deliveryFixture(); fake.current = fixture.db
    fixture.objects.set(fixture.input.artifacts[0].objectKey!, Buffer.alloc(32))
    await expect(run()).rejects.toThrow()
    expect(fixture.db.rpc).not.toHaveBeenCalled()
  })
  it("does not consume another parent's reservation", async () => {
    fixture.db.tables.scene3d_upload_intents[0].job_id = SOURCE
    await expect(run()).rejects.toThrow(/not reserved by this parent/)
    expect(fixture.store.get).not.toHaveBeenCalled()
  })
  it("rechecks source permission after storage IO", async () => {
    vi.mocked(workflowAccess).mockResolvedValueOnce("view").mockResolvedValue("none")
    await expect(run()).rejects.toThrow(/source is unavailable/)
    expect(fixture.store.get).toHaveBeenCalledTimes(2)
    expect(fixture.db.rpc).not.toHaveBeenCalled()
  })
  it("rechecks parent admission after storage IO", async () => {
    fixture.authorizeJob.mockResolvedValueOnce({ workflowId: SOURCE_WF }).mockRejectedValueOnce(new Error("parent cancelled"))
    await expect(run()).rejects.toThrow(/parent cancelled/)
    expect(fixture.db.rpc).not.toHaveBeenCalled()
  })
  it("pins reused artifacts owned by the authorized source owner", async () => {
    fixture.db.tables.scene3d_revisions[0].user_id = OTHER
    fixture.db.tables.scene3d_artifacts.push(...fixture.assetRows.map((a) => ({ ...a, user_id: OTHER })))
    fixture.db.tables.scene3d_revision_artifacts.push(...fixture.input.artifacts.map((a) => ({
      revision_id: REV, artifact_id: a.artifactId, user_id: OTHER, usage: a.kind === "poster" ? "poster" : "validation",
    })))
    fixture.input.artifacts = fixture.input.artifacts.map((a) => ({ ...a, reuseFromRevisionId: REV }))
    await expect(run()).resolves.toMatchObject({ status: "created" })
    expect(fixture.store.get).not.toHaveBeenCalled()
    expect(fixture.db.rpc.mock.calls[0][1].payload.artifacts.every((a: { artifact_owner_id: string }) => a.artifact_owner_id === OTHER)).toBe(true)
  })
  it("refuses an empty RPC result", async () => {
    fixture.db.rpc.mockResolvedValue({ data: null, error: null })
    await expect(run()).rejects.toThrow(/returned no result/)
  })
})

describe("Basic job sources", () => {
  beforeEach(() => { fixture.input.source = { kind: "job-output", jobId: SOURCE } })
  it("matches the source job output and retains its workflow anchor", async () => {
    await expect(run()).resolves.toMatchObject({ status: "created" })
    expect(fixture.db.rpc.mock.calls[0][1].payload.source_plan).toEqual(fixture.input.plan)
  })
  it.each(["missing", "foreign", "unfinished", "different", "revoked", "authored"])("refuses a %s Basic source", async (caseName) => {
    if (caseName === "missing") delete fixture.input.source.jobId
    if (caseName === "foreign") fixture.db.tables.jobs[0].user_id = OTHER
    if (caseName === "unfinished") fixture.db.tables.jobs[0].status = "processing"
    if (caseName === "different") fixture.db.tables.jobs[0].output_data = { scenePlan: { revisionId: REV, schemaVersion: 1 } }
    if (caseName === "revoked") vi.mocked(workflowAccess).mockResolvedValue("none")
    if (caseName === "authored") fixture.input.mode = "authored"
    await expect(run()).rejects.toThrow()
    expect(fixture.db.rpc).not.toHaveBeenCalled()
  })
})

describe("publication replay", () => {
  it("replays after completion and source deletion without consumed intents", async () => {
    fixture.published()
    fixture.db.tables.scene3d_revisions.length = 0
    fixture.db.tables.scene3d_deliveries[0].source_job_id = null
    fixture.authorizeJob.mockRejectedValue(new Error("parent completed"))
    await expect(run()).resolves.toMatchObject({ status: "unchanged" })
    expect(fixture.authorizeJob).not.toHaveBeenCalled()
    expect(fixture.store.get).not.toHaveBeenCalled()
  })
  it("does not replay after source access is revoked", async () => {
    fixture.published()
    fixture.db.tables.scene3d_revisions.length = 0
    vi.mocked(workflowAccess).mockImplementation(async (_, wf) => wf === SOURCE_WF ? "none" : "own")
    await expect(run()).rejects.toThrow(/unavailable/)
  })
  it("does not call a changed artifact set a replay", async () => {
    fixture.published()
    fixture.input.artifacts[0].sha256 = "f".repeat(64)
    await expect(run()).rejects.toThrow(/different artifacts/)
  })
  it("adopts an identical concurrent publication that consumed the intents", async () => {
    fixture.authorizeJob.mockImplementationOnce(async () => {
      fixture.published()
      return { workflowId: SOURCE_WF }
    })
    await expect(run()).resolves.toMatchObject({ status: "unchanged" })
    expect(fixture.store.get).not.toHaveBeenCalled()
    expect(fixture.db.rpc).not.toHaveBeenCalled()
  })
})
