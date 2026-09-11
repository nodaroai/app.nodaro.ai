import { beforeEach, describe, expect, it, vi } from "vitest"
const { fake } = vi.hoisted(() => ({ fake: { current: null as unknown } }))
vi.mock("@/lib/supabase.js", () => ({ get supabase() { return fake.current } }))
vi.mock("@/lib/workflow-access.js", async (original) => ({
  ...await original<typeof import("../../../lib/workflow-access.js")>(), workflowAccess: vi.fn(),
}))
import { workflowAccess } from "../../../lib/workflow-access.js"
import { publishScene3DRefusedDelivery } from "../delivery-publish.js"
import { refusedDeliveryFixture, OWNER, JOB, REV, WF, REPORT, SOURCE_JSON } from "./delivery-fixture.js"

let fixture: ReturnType<typeof refusedDeliveryFixture>
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(workflowAccess).mockResolvedValue("own")
  fixture = refusedDeliveryFixture()
  fake.current = fixture.db
})
const run = () => publishScene3DRefusedDelivery(fixture.input, fixture)

describe("refused authoring delivery publication", () => {
  it("publishes the report and the private recipe against a job with NO revision behind it", async () => {
    expect(fixture.db.tables.scene3d_revisions).toHaveLength(0)
    expect(await run()).toMatchObject({ deliveryId: JOB, revisionId: REV, status: "created" })
    // Both artifacts' bytes are read back and digest-checked before anything durable is written.
    expect(fixture.store.get).toHaveBeenCalledTimes(2)
    expect(fixture.authorizeJob).toHaveBeenCalledTimes(2)
    expect(fixture.db.rpc).toHaveBeenCalledWith("scene3d_publish_refused_delivery", {
      payload: expect.objectContaining({ job_id: JOB, user_id: OWNER, source_revision_id: REV,
        artifacts: expect.arrayContaining([
          expect.objectContaining({ kind: "validation-report", usage: "validation" }),
          expect.objectContaining({ kind: "source-json", usage: "checkpoint" }),
        ]) }),
    })
    // Never the rendered lane: its plan, poster and revision rules must stay untouched.
    expect(fixture.db.rpc).not.toHaveBeenCalledWith("scene3d_publish_delivery", expect.anything())
  })

  it("publishes the report alone when no recipe survived to retain", async () => {
    fixture.input.artifacts = fixture.input.artifacts.filter((a) => a.kind === "validation-report")
    expect(await run()).toMatchObject({ status: "created", artifactIds: [REPORT] })
  })

  it("refuses a delivery with no report, with two reports, or carrying a rendered artifact", async () => {
    const report = fixture.input.artifacts[0]
    const recipe = fixture.input.artifacts[1]
    fixture.input.artifacts = [recipe]
    await expect(run()).rejects.toThrow(/requires its validation report/)
    fixture.input.artifacts = [report, { ...report, artifactId: SOURCE_JSON }]
    await expect(run()).rejects.toThrow(/requires its validation report/)
    fixture.input.artifacts = [report, { ...recipe, kind: "poster" as unknown as "source-json" }]
    await expect(run()).rejects.toThrow(/requires its validation report/)
    expect(fixture.db.rpc).not.toHaveBeenCalled()
  })

  it("accepts only artifacts this parent reserved at this attempt identity", async () => {
    fixture.db.tables.scene3d_upload_intents[0].revision_id = "00000000-0000-4000-8000-0000000000ff"
    await expect(run()).rejects.toThrow(/not reserved by this parent/)
    expect(fixture.db.rpc).not.toHaveBeenCalled()
  })

  it("adopts an identical republication and refuses one that changed", async () => {
    fixture.published()
    expect(await run()).toMatchObject({ status: "unchanged", artifactIds: [REPORT, SOURCE_JSON] })
    expect(fixture.db.rpc).not.toHaveBeenCalled()
    fixture.db.tables.scene3d_artifacts[0].sha256 = "f".repeat(64)
    await expect(run()).rejects.toThrow(/different artifacts/)
  })

  it("refuses to overwrite a delivery this job already published from a rendered scene", async () => {
    fixture.published()
    fixture.db.tables.scene3d_deliveries[0].source_kind = "retained-revision"
    fixture.db.tables.scene3d_deliveries[0].source_plan_sha256 = "a".repeat(64)
    await expect(run()).rejects.toThrow(/different content/)
    expect(fixture.db.rpc).not.toHaveBeenCalled()
  })

  it("does not publish for a user who does not own the parent job", async () => {
    vi.mocked(workflowAccess).mockResolvedValue("none")
    fixture.published()
    fixture.db.tables.scene3d_deliveries[0].workflow_id = WF
    await expect(run()).rejects.toThrow(/unavailable/)
  })
})
