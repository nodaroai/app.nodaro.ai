import { beforeEach, describe, expect, it, vi } from "vitest"
import { computeScene3DPlanV2ContentHash } from "@nodaro/shared"
import { planV2 } from "../../../../../packages/shared/src/__tests__/scene3d-v2-fixtures.js"
const { fake } = vi.hoisted(() => ({ fake: { current: null as unknown } }))
vi.mock("@/lib/supabase.js", () => ({ get supabase() { return fake.current } }))
vi.mock("@/lib/workflow-access.js", async (original) => ({
  ...await original<typeof import("../../../lib/workflow-access.js")>(), workflowAccess: vi.fn(),
}))
import { workflowAccess } from "../../../lib/workflow-access.js"
import { resolveScene3DSource } from "../resolve-source.js"
import { scene3DPlanDigest } from "../publish.js"
import { createFakeSupabase } from "./fake-supabase.js"

const OWNER = "00000000-0000-4000-8000-000000000001"
const OTHER = "00000000-0000-4000-8000-000000000002"
const JOB = "00000000-0000-4000-8000-000000000003"
const WF = "00000000-0000-4000-8000-000000000004"
const REV = "00000000-0000-4000-8000-000000000005"
const basicPlan = { planType: "3d-scene", schemaVersion: 1, revisionId: REV,
  width: 640, height: 360, fps: 24, durationInFrames: 24, backgroundColor: "#101014",
  camera: { position: [0, 1.5, 4], target: [0, 1, 0], focalLengthMm: 35, sensorWidthMm: 36 },
  objects: [{ id: "box", name: "Box", primitive: "box", dimensions: [1, 1, 1], position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: "#22cc88" }],
  lighting: { ambientIntensity: 0.6, keyIntensity: 2.4, keyPosition: [4, 6, 3] } }
const request = { userId: OWNER, revisionId: REV, requiredAccess: "view" as const }
let db: ReturnType<typeof createFakeSupabase>
beforeEach(async () => {
  vi.clearAllMocks(); vi.mocked(workflowAccess).mockResolvedValue("view")
  const plan = planV2({ revisionId: REV })
  plan.provenance.contentHash = await computeScene3DPlanV2ContentHash(plan)
  db = createFakeSupabase({
    scene3d_revisions: [{ id: REV, user_id: OWNER, workflow_id: WF, source_job_id: null,
      parent_revision_id: null, plan, plan_sha256: scene3DPlanDigest(plan), created_at: "2026-09-08T00:00:00Z" }],
    jobs: [{ id: JOB, user_id: OWNER, workflow_id: WF, status: "completed", output_data: { scenePlan: basicPlan } }],
  })
  fake.current = db
})

describe("canonical quote and admission sources", () => {
  it("resolves an exact manual v2 revision without an authoring job", async () => {
    const result = await resolveScene3DSource(request)
    expect(result).toMatchObject({ kind: "retained-revision", revisionId: REV, sourceJobId: null, access: "view" })
    expect(result.plan).toEqual(db.tables.scene3d_revisions[0].plan)
    expect(result.plan).not.toBe(db.tables.scene3d_revisions[0].plan)
    expect(result.planSha256).toBe(scene3DPlanDigest(result.plan))
  })
  it("does not use job history to bypass revoked retained-source permission", async () => {
    vi.mocked(workflowAccess).mockResolvedValue("none")
    await expect(resolveScene3DSource({ ...request, sourceJobId: JOB })).rejects.toMatchObject({ code: "SCENE_ASSET_MISSING" })
    expect(db.from).not.toHaveBeenCalledWith("jobs")
  })
  it("allows authorized collaborators to preview but requires edit access to re-author", async () => {
    expect((await resolveScene3DSource({ ...request, userId: OTHER })).ownerId).toBe(OWNER)
    await expect(resolveScene3DSource({ ...request, userId: OTHER, requiredAccess: "edit" })).rejects.toMatchObject({ code: "SCENE_ASSET_MISSING" })
    vi.mocked(workflowAccess).mockResolvedValue("edit")
    await expect(resolveScene3DSource({ ...request, userId: OTHER, requiredAccess: "edit" })).resolves.toMatchObject({ access: "edit" })
  })
  it("does not grant access to another user's personal revision", async () => {
    db.tables.scene3d_revisions[0].workflow_id = null
    await expect(resolveScene3DSource({ ...request, userId: OTHER })).rejects.toMatchObject({ code: "SCENE_ASSET_MISSING" })
    expect((await resolveScene3DSource(request)).access).toBe("own")
  })
  it("refuses a mismatched or stale job correlation", async () => {
    await expect(resolveScene3DSource({ ...request, sourceJobId: JOB })).rejects.toMatchObject({ code: "SCENE_REVISION_CONFLICT" })
    db.tables.scene3d_revisions[0].source_job_id = JOB
    await expect(resolveScene3DSource({ ...request, sourceJobId: JOB })).resolves.toMatchObject({ sourceJobId: JOB })
  })
  it.each(["row-digest", "content-hash", "schema"])("refuses invalid retained %s", async (kind) => {
    const row = db.tables.scene3d_revisions[0]
    if (kind === "row-digest") row.plan_sha256 = "f".repeat(64)
    if (kind === "content-hash") {
      const plan = planV2({ revisionId: REV }); row.plan = plan; row.plan_sha256 = scene3DPlanDigest(plan)
    }
    if (kind === "schema") { row.plan = { revisionId: REV }; row.plan_sha256 = scene3DPlanDigest(row.plan) }
    await expect(resolveScene3DSource(request)).rejects.toMatchObject({ code: "SCENE_REVISION_CONFLICT" })
  })
  it("rechecks workflow permissions on each call", async () => {
    await resolveScene3DSource(request)
    vi.mocked(workflowAccess).mockResolvedValue("none")
    await expect(resolveScene3DSource(request)).rejects.toMatchObject({ code: "SCENE_ASSET_MISSING" })
  })
  it("does not mistake a database failure for a missing revision", async () => {
    db.failTable("scene3d_revisions", "disconnected")
    await expect(resolveScene3DSource({ ...request, sourceJobId: JOB })).rejects.toMatchObject({ code: "SCENE_STORAGE_FAILED" })
    expect(db.from).not.toHaveBeenCalledWith("jobs")
  })
})

describe("Basic job-only source", () => {
  beforeEach(() => { db.tables.scene3d_revisions.length = 0 })
  it("returns only the matching completed owned job output", async () => {
    const result = await resolveScene3DSource({ ...request, sourceJobId: JOB })
    expect(result).toMatchObject({ kind: "job-output", plan: basicPlan, sourceJobId: JOB, workflowId: WF })
  })
  it.each(["missing-job", "foreign", "pending", "revoked", "v2", "different-revision"])("refuses %s", async (kind) => {
    if (kind === "missing-job") db.tables.jobs.length = 0
    if (kind === "foreign") db.tables.jobs[0].user_id = OTHER
    if (kind === "pending") db.tables.jobs[0].status = "pending"
    if (kind === "revoked") vi.mocked(workflowAccess).mockResolvedValue("none")
    if (kind === "v2") db.tables.jobs[0].output_data = { scenePlan: planV2({ revisionId: REV }) }
    if (kind === "different-revision") db.tables.jobs[0].output_data = { scenePlan: { ...basicPlan, revisionId: WF } }
    await expect(resolveScene3DSource({ ...request, sourceJobId: JOB })).rejects.toThrow()
  })
  it("requires correlation when there is no retained revision", async () => {
    await expect(resolveScene3DSource(request)).rejects.toMatchObject({ code: "SCENE_ASSET_MISSING" })
  })
})
