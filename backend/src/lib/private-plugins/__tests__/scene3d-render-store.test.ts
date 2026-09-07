import { beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ select: vi.fn(), insert: vi.fn(), cancel: vi.fn(), authorize: vi.fn(), add: vi.fn(), getJob: vi.fn(), credits: vi.fn() }))
vi.mock("../../supabase.js", () => ({ supabase: { from: (table: string) => {
  const filters: Array<[string, string, unknown]> = []
  let columns = ""
  const q = { select: (value: string) => { columns = value; return q },
    eq: (key: string, value: unknown) => { filters.push(["eq", key, value]); return q },
    in: (key: string, value: unknown) => { filters.push(["in", key, value]); return q },
    maybeSingle: () => mocks.select(table, columns, filters) }
  return q
} } }))
vi.mock("../../config.js", () => ({ hasCredits: mocks.credits }))
vi.mock("../../insert-job.js", () => ({ insertInternalJob: mocks.insert }))
vi.mock("../../cancel-job.js", () => ({ cancelOwnedJob: mocks.cancel }))
vi.mock("../../render-queue.js", () => ({ renderQueue: { add: mocks.add, getJob: mocks.getJob } }))
vi.mock("../scene3d-artifact-toolkit.js", () => ({ authorizeScene3DJob: mocks.authorize, createScene3DArtifactToolkit: () => undefined }))
vi.mock("../../../workers/scene3d-render-assets.js", () => ({ authorizeScene3DRenderPlan: vi.fn() }))
import { createSceneRenderPorts } from "../scene3d-render-store.js"
import { validateSceneRenderRequest } from "../scene3d-render-identity.js"

async function fixture() {
  const request = await validateSceneRenderRequest({ parentJobId: "10000000-0000-4000-8000-000000000000",
    userId: "20000000-0000-4000-8000-000000000000", key: "video", assets: "retained-revision", output: { kind: "video" },
    plan: { planType: "3d-scene", schemaVersion: 1, revisionId: "30000000-0000-4000-8000-000000000000",
      width: 320, height: 180, fps: 24, durationInFrames: 24, backgroundColor: "#101010",
      camera: { position: [0,2,8], target: [0,1,0], focalLengthMm: 35, sensorWidthMm: 36 },
      objects: [{ id: "box", name: "Box", primitive: "box", dimensions: [1,1,1], position: [0,1,0], rotation: [0,0,0], scale: [1,1,1], color: "#eeeeee" }],
      lighting: { ambientIntensity: 0.5, keyIntensity: 1, keyPosition: [5,8,6] } } })
  const parent = { workflow_id: "workflow", workflow_execution_id: "execution", workspace_id: "workspace", org_id: "org",
    mcp_client: "test-client", should_watermark: false, user_id: request.input.userId, status: "processing", usage_log_id: "hold", stop_requested_at: null }
  const row = { id: request.childJobId, user_id: request.input.userId, parent_job_id: request.input.parentJobId,
    status: "pending", source_detail: "scene-render-child", usage_log_id: null, should_watermark: false,
    input_data: { sceneRender: request.input, sceneRenderInputHash: request.inputHash }, output_data: null }
  mocks.select.mockImplementation(async (table, _columns, filters) => {
    if (table === "usage_logs") return { data: { status: "reserved" }, error: null }
    return { data: filters.some(([, key, value]: [string, string, unknown]) => key === "id" && value === request.childJobId) ? row : parent, error: null }
  })
  return { request, parent, row, ports: createSceneRenderPorts() }
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.credits.mockReturnValue(true)
  mocks.insert.mockResolvedValue({ data: { id: "id" }, error: null })
})
describe("scene render persistence and queue ownership", () => {
  it("creates a private child inheriting the parent scope without copying its credit reservation", async () => {
    const f = await fixture(), child = await f.ports.create(f.request)
    expect(mocks.insert).toHaveBeenCalledWith("scene-render-child", expect.objectContaining({ id: f.request.childJobId,
      user_id: f.request.input.userId, parent_job_id: f.request.input.parentJobId, usage_log_id: null, force_private: true,
      workflow_id: "workflow", workspace_id: "workspace", org_id: "org", mcp_client: "test-client", should_watermark: false }))
    await f.ports.enqueue(child)
    expect(mocks.add).toHaveBeenCalledWith("scene-render-child", { jobId: child.id, sceneRenderChild: true },
      expect.objectContaining({ jobId: child.id, attempts: 4 }))
  })
  it("adopts the exact child after an uncertain insert response", async () => {
    const f = await fixture(); mocks.insert.mockResolvedValue({ data: null, error: { message: "connection lost" } })
    await expect(f.ports.create(f.request)).resolves.toMatchObject({ id: f.request.childJobId, inputHash: f.request.inputHash })
    expect(mocks.insert).toHaveBeenCalledOnce()
  })
  it.each(["user_id", "parent_job_id", "source_detail", "usage_log_id"])("rejects a mismatched stored %s", async (field) => {
    const f = await fixture(); Object.assign(f.row, { [field]: "foreign" })
    await expect(f.ports.read(f.request.childJobId)).rejects.toThrow()
  })
  it("binds a reservation read to both the parent job and owner", async () => {
    const f = await fixture()
    await expect(f.ports.parent(f.request.input)).resolves.toMatchObject({ reservationActive: true })
    expect(mocks.authorize).toHaveBeenCalledWith({ jobId: f.request.input.parentJobId, userId: f.request.input.userId })
    expect(mocks.select).toHaveBeenCalledWith("usage_logs", "status", expect.arrayContaining([
      ["eq", "id", "hold"], ["eq", "job_id", f.request.input.parentJobId], ["eq", "user_id", f.request.input.userId] ]))
  })
  it("does not remove an active queue lease when cancellation changes the database", async () => {
    const f = await fixture(), child = await f.ports.read(f.request.childJobId)
    const remove = vi.fn(); mocks.getJob.mockResolvedValue({ getState: async () => "active", remove })
    await f.ports.cancel(child!)
    expect(mocks.cancel).toHaveBeenCalledWith(child!.id, child!.userId)
    expect(remove).not.toHaveBeenCalled()
  })
})
