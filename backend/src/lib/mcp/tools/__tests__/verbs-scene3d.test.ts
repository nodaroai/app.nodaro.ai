import { describe, expect, it, vi } from "vitest"
import { registerScene3DVerbs } from "../verbs-scene3d.js"

type Handler = (args: Record<string, unknown>) => Promise<unknown>
function harness(scopes: string[] = ["workflows:execute"], statusCode = 200) {
  const handlers: Record<string, Handler> = {}
  const server = { registerTool: (name: string, _meta: unknown, handler: Handler) => { handlers[name] = handler } }
  const inject = vi.fn(async () => ({ statusCode, body: JSON.stringify(statusCode === 200 ? { jobId: "scene-job" } : { error: { code: "revision_conflict", message: "Scene revision changed" } }) }))
  registerScene3DVerbs({ server: server as never, fastify: { inject } as never, session: { userId: "owner", clientName: "test", scopes } as never })
  return { handlers, inject }
}

describe("3D scene MCP tools", () => {
  it("requires execution scope for every scene operation", () => {
    expect(Object.keys(harness([]).handlers)).toEqual([])
    expect(Object.keys(harness().handlers)).toEqual(["generate_3d_scene", "edit_3d_scene", "render_3d_scene"])
  })

  it("forwards both image and video roles to the generation route with session identity", async () => {
    const { handlers, inject } = harness()
    const references = [
      { id: "image", kind: "image", role: "appearance", url: "https://example.com/image.png" },
      { id: "motion", kind: "video", role: "motion", url: "https://example.com/motion.mp4", startSeconds: 1, endSeconds: 5 },
    ]
    await handlers.generate_3d_scene({ prompt: "Orbit", duration_seconds: 4, fps: 24, references, llm_model: "model" })
    expect(inject).toHaveBeenCalledWith(expect.objectContaining({
      url: "/v1/3d-scene/generate",
      payload: expect.objectContaining({ prompt: "Orbit", durationSeconds: 4, fps: 24, references, llmModel: "model", userId: "owner" }),
    }))
  })

  it("preserves edits, locks and expected revision and surfaces a conflict", async () => {
    const { handlers, inject } = harness(undefined, 409)
    const operations = [{ op: "set-camera", changes: { focalLengthMm: 42 } }]
    const result = await handlers.edit_3d_scene({ scene_plan: { revisionId: "revision" }, expected_revision_id: "revision", operations, locked_object_ids: ["pillar"] })
    expect(inject).toHaveBeenCalledWith(expect.objectContaining({ url: "/v1/3d-scene/edit", payload: expect.objectContaining({ operations, expectedRevisionId: "revision", lockedObjectIds: ["pillar"] }) }))
    expect(result).toMatchObject({ isError: true })
    expect(JSON.stringify(result)).toContain("Scene revision changed")
  })

  it("renders through the existing composition endpoint without rewriting the plan", async () => {
    const { handlers, inject } = harness()
    const scene = { planType: "3d-scene", revisionId: "revision", fps: 24, durationInFrames: 96 }
    await handlers.render_3d_scene({ scene_plan: scene })
    expect(inject).toHaveBeenCalledWith(expect.objectContaining({ url: "/v1/render-video/plan", payload: expect.objectContaining({ planType: "3d-scene", plan: scene, userId: "owner" }) }))
  })
})
