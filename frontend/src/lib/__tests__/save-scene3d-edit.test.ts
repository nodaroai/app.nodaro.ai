import { beforeEach, describe, expect, it, vi } from "vitest"
import { saveScene3DEdit } from "../save-scene3d-edit"
const mocks = vi.hoisted(() => ({ state: {} as Record<string, unknown>, apply: vi.fn(), update: vi.fn() }))
vi.mock("@/hooks/use-workflow-store", () => ({ useWorkflowStore: { getState: () => mocks.state } }))
vi.mock("@/lib/nodaro-client", () => ({ nodaroClient: { scene3d: { applyEdits: mocks.apply } } }))
const base = "00000000-0000-4000-8000-000000000001"
const next = "00000000-0000-4000-8000-000000000002"
const latest = "00000000-0000-4000-8000-000000000003"
const edit = { expectedRevisionId: base, expectedContentHash: "a".repeat(64), operations: [
  { op: "set-override" as const, override: { kind: "entity-visibility" as const, entityId: "box", visible: false } },
] }
beforeEach(() => {
 vi.resetAllMocks()
 mocks.state = { workflowId: "workflow", loadGeneration: 1, readOnlyReason: null,
   nodes: [{ id: "node", data: { scenePlan: { revisionId: base }, lockedObjectIds: ["pillar"] } }],
   updateNodeData: mocks.update,
 }
})
function pending() {
 let finish!: (result: unknown) => void
 mocks.apply.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
 const task = saveScene3DEdit("node", edit)
 return { task, finish: () => finish({ scenePlan: { revisionId: next, parentRevisionId: base }, changeSummary: "Changed visibility" }) }
}
describe("saving deterministic scene edits", () => {
 it("keeps the preview on its old revision until persistence succeeds", async () => {
  const {task,finish} = pending()
  expect(mocks.update).not.toHaveBeenCalled()
  expect(mocks.apply).toHaveBeenCalledWith(base, expect.objectContaining({ expectedContentHash: edit.expectedContentHash, lockedObjectIds: ["pillar"] }))
  finish(); await task
  expect(mocks.update).toHaveBeenCalledWith("node", expect.objectContaining({ scenePlan: { revisionId: next, parentRevisionId: base } }))
  expect(mocks.update.mock.calls[0][1]).not.toHaveProperty("sceneJobBaseRevisionId")
 })
 it("parks a late edit in history instead of replacing a newer active revision", async () => {
  const {task,finish} = pending()
  mocks.state = { ...mocks.state, nodes: [{ id: "node", data: { scenePlan: { revisionId: latest } } }] }
  finish(); await task
  const patch = mocks.update.mock.calls[0][1]
  expect(patch.scenePlan).toBeUndefined()
  expect(patch.scenePendingPlan.revisionId).toBe(next)
  expect(patch.sceneHistory[0].revisionId).toBe(next)
 })
 it("does not apply a completion to another loaded workflow", async () => {
  const {task,finish} = pending()
  mocks.state = { ...mocks.state, loadGeneration: 2 }
  finish(); await task
  expect(mocks.update).not.toHaveBeenCalled()
 })
 it("does not present failed persistence as a saved edit", async () => {
  mocks.apply.mockRejectedValueOnce(new Error("unavailable"))
  await expect(saveScene3DEdit("node", edit)).rejects.toThrow("unavailable")
  expect(mocks.update).not.toHaveBeenCalled()
 })
})
