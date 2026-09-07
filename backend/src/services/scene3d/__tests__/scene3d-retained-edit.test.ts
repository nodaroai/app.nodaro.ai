import { beforeEach, describe, expect, it, vi } from "vitest"
import { computeScene3DPlanV2ContentHash } from "@nodaro/shared"
import { planV2 } from "../../../../../packages/shared/src/__tests__/scene3d-v2-fixtures.js"
import { editRetainedScene3D } from "../scene3d-retained-edit.js"
import type { Scene3DObjectStore } from "../../scene3d-artifacts/object-store.js"
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), assets: vi.fn(), publish: vi.fn() }))
vi.mock("../../scene3d-artifacts/authorize.js", () => ({ authorizeScene3DRevision: mocks.authorize }))
vi.mock("../../scene3d-artifacts/db.js", () => ({ loadScene3DRevisionArtifacts: mocks.assets }))
vi.mock("../../scene3d-artifacts/publish.js", () => ({ publishScene3DRevision: mocks.publish }))
const actor = "00000000-0000-4000-8000-000000000001"
const owner = "00000000-0000-4000-8000-000000000002"
const revisionId = "00000000-0000-4000-8000-000000000003"
const store = { bucket: "private", get: vi.fn(), delete: vi.fn() } as Scene3DObjectStore
async function setup() {
 const p = planV2()
 const plan = { ...p, provenance: { ...p.provenance, contentHash: await computeScene3DPlanV2ContentHash(p) } }
 const revision = { revisionId: plan.revisionId, userId: owner, workflowId: "workflow", plan }
 mocks.authorize.mockResolvedValue({ ok: true, revision, access: "edit" })
 mocks.assets.mockResolvedValue([
  ...plan.assets.map(a => ({ artifactId:a.assetId,kind:a.kind,sha256:a.sha256,byteLength:a.byteLength,expiresAt:null })),
  { artifactId:"recipe",kind:"source-json",sha256:"1".repeat(64),byteLength:12,expiresAt:null },
 ])
 return { plan, input: { revisionId:plan.revisionId,newRevisionId:revisionId,expectedContentHash:plan.provenance.contentHash,
  operations:[{op:"set-override" as const,override:{kind:"entity-color" as const,entityId:"e2",materialRole:"bodyPaint",color:"#ff0000"}}],
 } }
}
beforeEach(() => vi.resetAllMocks())
describe("retained deterministic edits", () => {
 it("authorizes a collaborator, reuses only retained bytes and keeps the rebuild recipe private", async () => {
  const {plan,input}=await setup()
  const result=await editRetainedScene3D(actor,input,store)
  expect(result.scenePlan.revisionId).toBe(revisionId)
  expect(mocks.authorize).toHaveBeenCalledWith(actor,plan.revisionId,"source")
  const published=mocks.publish.mock.calls[0][0]
  expect(published).toMatchObject({userId:owner,workflowId:"workflow",parentRevisionId:plan.revisionId})
  expect(published.sourceJobId).toBeUndefined()
  expect(published.artifacts.map((a:{kind:string})=>a.kind)).toEqual(["glb","camera-track-json","source-json"])
  expect(published.artifacts.every((a:{reuseFromRevisionId:string})=>a.reuseFromRevisionId===plan.revisionId)).toBe(true)
  expect(result.scenePlan.assets.some(a=>a.kind==="blend-source")).toBe(false)
  expect(store.get).not.toHaveBeenCalled()
 })
 it("replays the same revision identity without inventing another edit", async () => {
  const {input}=await setup()
  expect(await editRetainedScene3D(actor,input,store)).toEqual(await editRetainedScene3D(actor,input,store))
  expect(mocks.publish.mock.calls[0][0]).toEqual(mocks.publish.mock.calls[1][0])
 })
 it.each(["not-found","forbidden"])("refuses %s before storage or publication", async reason=>{
  const {input}=await setup();mocks.authorize.mockResolvedValue({ok:false,reason})
  await expect(editRetainedScene3D(actor,input,store)).rejects.toMatchObject({status:reason==="forbidden"?403:404})
  expect(mocks.assets).not.toHaveBeenCalled();expect(mocks.publish).not.toHaveBeenCalled()
 })
 it("rejects stale content and lock violations before publication", async()=>{
  const {input}=await setup()
  await expect(editRetainedScene3D(actor,{...input,expectedContentHash:"0".repeat(64)},store)).rejects.toMatchObject({status:409})
  await expect(editRetainedScene3D(actor,{...input,lockedObjectIds:["e2"]},store)).rejects.toMatchObject({code:"locked"})
  expect(mocks.publish).not.toHaveBeenCalled()
 })
 it("does not publish when permission is revoked during preparation",async()=>{
  const {input}=await setup()
  const allowed=await mocks.authorize()
  mocks.authorize.mockReset().mockResolvedValueOnce(allowed).mockResolvedValue({ok:false,reason:"forbidden"})
  await expect(editRetainedScene3D(actor,input,store)).rejects.toMatchObject({status:403})
  expect(mocks.publish).not.toHaveBeenCalled()
 })
})
