import { beforeEach, describe, expect, it, vi } from "vitest"
import { computeScene3DPlanV2ContentHash } from "@nodaro/shared"
import { planV2 } from "../../../../../packages/shared/src/__tests__/scene3d-v2-fixtures.js"
import type { Scene3DObjectStore } from "../../../services/scene3d-artifacts/object-store.js"
import { applyScene3DJobEdits } from "../scene3d-job-edit.js"

const mocks = vi.hoisted(() => ({ source: vi.fn(), assets: vi.fn(), publish: vi.fn(), job: vi.fn() }))
vi.mock("../../../services/scene3d-artifacts/authorize.js", () => ({ authorizeScene3DRevision: mocks.source }))
vi.mock("../../../services/scene3d-artifacts/db.js", () => ({ loadScene3DRevisionArtifacts: mocks.assets }))
vi.mock("../../../services/scene3d-artifacts/publish.js", () => ({ publishScene3DRevision: mocks.publish }))
const userId = "00000000-0000-4000-8000-000000000001"
const ownerId = "00000000-0000-4000-8000-000000000002"
const newRevisionId = "00000000-0000-4000-8000-000000000003"
const jobId = "00000000-0000-4000-8000-000000000004"
const store = { bucket: "private", get: vi.fn(), delete: vi.fn() } as Scene3DObjectStore
const deps = { store, authorizeJob: mocks.job }
async function setup() {
  const fixture = planV2()
  const plan = { ...fixture, provenance: { ...fixture.provenance, contentHash: await computeScene3DPlanV2ContentHash(fixture) } }
  mocks.source.mockResolvedValue({ ok: true, access: "edit", revision: { revisionId: plan.revisionId, userId: ownerId, workflowId: "source-workflow", plan } })
  mocks.assets.mockResolvedValue([
    ...plan.assets.map(a => ({ artifactId: a.assetId, kind: a.kind, sha256: a.sha256, byteLength: a.byteLength, expiresAt: null })),
    { artifactId: "recipe", kind: "source-json", sha256: "1".repeat(64), byteLength: 12, expiresAt: null },
  ])
  const input = { userId, jobId, revisionId: plan.revisionId, newRevisionId, expectedContentHash: plan.provenance.contentHash,
    operations: [{ op: "set-override", override: { kind: "entity-color", entityId: "e2", materialRole: "bodyPaint", color: "#ff0000" } }],
  }
  return { input, plan }
}
beforeEach(() => vi.resetAllMocks())
describe("job-owned deterministic scene edits", () => {
  it("uses the real edit service for collaborators, preserving source ownership and pinned bytes", async () => {
    const { input, plan } = await setup()
    const result = await applyScene3DJobEdits(deps, input)
    expect(result.scenePlan.revisionId).toBe(newRevisionId)
    expect(result.scenePlan.overrides).toEqual([
      ...(plan.overrides ?? []).filter(o => o.kind !== "entity-color"),
      expect.objectContaining(input.operations[0].override),
    ])
    expect(mocks.job.mock.calls).toEqual(Array.from({ length: 3 }, () => [{ jobId, userId }]))
    expect(mocks.source).toHaveBeenCalledWith(userId, plan.revisionId, "source")
    expect(mocks.publish).toHaveBeenCalledWith(expect.objectContaining({
      userId: ownerId, workflowId: "source-workflow", parentRevisionId: plan.revisionId, plan: result.scenePlan,
      artifacts: expect.arrayContaining([expect.objectContaining({ artifactId: "recipe", kind: "source-json", reuseFromRevisionId: plan.revisionId })]),
    }), { store })
    expect(store.get).not.toHaveBeenCalled()
    expect(result.scenePlan.assets.some(a => a.kind === "blend-source")).toBe(false)
  })
  it("replays a stable revision and identical publication inputs", async () => {
    const { input } = await setup()
    expect(await applyScene3DJobEdits(deps, input)).toEqual(await applyScene3DJobEdits(deps, input))
    expect(mocks.publish.mock.calls[0]).toEqual(mocks.publish.mock.calls[1])
  })
  it.each([
    { jobId: "bad" }, { userId: "bad" }, { revisionId: "bad" }, { newRevisionId: "bad" },
    { expectedContentHash: "bad" }, { operations: [] }, { operations: [{ op: "arbitrary-code" }] },
    { lockedObjectIds: Array(101).fill("e2") }, { scenePlan: {} },
  ])("rejects invalid wire inputs before authorization or IO: %j", async patch => {
    const { input } = await setup()
    await expect(applyScene3DJobEdits(deps, { ...input, ...patch })).rejects.toMatchObject({ status: 400, code: "validation_error" })
    expect(mocks.job).not.toHaveBeenCalled()
    expect(mocks.source).not.toHaveBeenCalled()
    expect(mocks.publish).not.toHaveBeenCalled()
  })
  it("rejects stale content and locked entities", async () => {
    const { input } = await setup()
    await expect(applyScene3DJobEdits(deps, { ...input, expectedContentHash: "0".repeat(64) })).rejects.toMatchObject({ status: 409 })
    await expect(applyScene3DJobEdits(deps, { ...input, lockedObjectIds: ["e2"] })).rejects.toMatchObject({ code: "locked" })
    expect(mocks.publish).not.toHaveBeenCalled()
  })
  it.each([0, 1])("rejects a cancelled job at activity check %s before publication", async check => {
    const { input } = await setup()
    if (check) mocks.job.mockResolvedValueOnce(undefined)
    mocks.job.mockRejectedValue(new Error("job unavailable"))
    await expect(applyScene3DJobEdits(deps, input)).rejects.toThrow("job unavailable")
    expect(mocks.publish).not.toHaveBeenCalled()
    if (!check) expect(mocks.source).not.toHaveBeenCalled()
  })
  it("rechecks source permissions during preparation", async () => {
    const { input } = await setup()
    const allowed = await mocks.source()
    mocks.source.mockReset().mockResolvedValueOnce(allowed).mockResolvedValue({ ok: false, reason: "forbidden" })
    await expect(applyScene3DJobEdits(deps, input)).rejects.toMatchObject({ status: 403 })
    expect(mocks.publish).not.toHaveBeenCalled()
  })
  it.each(["before", "during-authorization", "during-preparation"])("honors abort %s", async phase => {
    const { input } = await setup()
    const controller = new AbortController()
    const cancel = () => controller.abort(new Error("cancelled"))
    if (phase === "before") cancel()
    if (phase === "during-authorization") mocks.job.mockImplementationOnce(cancel)
    if (phase === "during-preparation") mocks.assets.mockImplementationOnce(() => { cancel(); return [] })
    await expect(applyScene3DJobEdits(deps, input, { signal: controller.signal })).rejects.toThrow("cancelled")
    expect(mocks.publish).not.toHaveBeenCalled()
  })
  it("does not report success when cancellation wins while an immutable revision is publishing", async () => {
    const { input } = await setup()
    mocks.publish.mockImplementationOnce(() => { mocks.job.mockRejectedValue(new Error("cancelled")) })
    await expect(applyScene3DJobEdits(deps, input)).rejects.toThrow("cancelled")
    expect(mocks.publish).toHaveBeenCalledOnce()
  })
  it("propagates publication failure without a successful output", async () => {
    const { input } = await setup()
    mocks.publish.mockRejectedValueOnce(new Error("storage unavailable"))
    await expect(applyScene3DJobEdits(deps, input)).rejects.toThrow("storage unavailable")
  })
})
