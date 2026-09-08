import { describe, expect, it, vi } from "vitest"
import Fastify from "fastify"
const h = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock("../../lib/workflow-route-access.js", () => ({ loadWorkflowFor: h.load }))
import { registerSequenceExecutionGuard } from "../sequence-execution-guard.js"

describe("direct canvas request guard", () => {
  it.each(["keyframeId", "sequenceBinding"])("blocks stored %s before a media handler can reserve or submit", async (field) => {
    const app = Fastify()
    const paidHandler = vi.fn(async () => ({ jobId: "should-not-run" }))
    app.addHook("onRequest", async (req) => { req.userId = "owner" })
    h.load.mockResolvedValue({ ok: true, row: { nodes: [{ id: "linked", data: { [field]: "dependency" } }] } })
    registerSequenceExecutionGuard(app)
    app.post("/v1/generate-image", paidHandler)
    try {
      const response = await app.inject({ method: "POST", url: "/v1/generate-image", payload: {
        workflowId: "workflow", nodeId: "linked", requiredCapabilities: [], prompt: "Ignore links",
      } })
      expect(response.statusCode).toBe(400)
      expect(response.json().error.code).toBe("sequence_execution_required")
      expect(paidHandler).not.toHaveBeenCalled()
      expect(h.load).toHaveBeenCalledWith(expect.anything(), expect.anything(), "owner", "workflow", "view", expect.any(String), expect.any(String))
    } finally { await app.close() }
  })
  it("allows ordinary nodes and reviewed production requests without canvas node IDs", async () => {
    const app = Fastify()
    app.addHook("onRequest", async (req) => { req.userId = "owner" })
    h.load.mockResolvedValue({ ok: true, row: { nodes: [{ id: "ordinary", data: {} }] } })
    registerSequenceExecutionGuard(app)
    app.post("/v1/generate-image", async () => ({ jobId: "allowed" }))
    try {
      for (const payload of [{ workflowId: "workflow", nodeId: "ordinary" }, { workflowId: "workflow" }]) {
        expect((await app.inject({ method: "POST", url: "/v1/generate-image", payload })).statusCode).toBe(200)
      }
    } finally { await app.close() }
  })
  it("preserves the access refusal without running the media handler", async () => {
    const app = Fastify()
    const paidHandler = vi.fn(async () => ({ jobId: "should-not-run" }))
    app.addHook("onRequest", async (req) => { req.userId = "outsider" })
    h.load.mockImplementationOnce(async (_req, reply) => {
      reply.status(404).send({ error: { code: "not_found", message: "Workflow not found" } })
      return { ok: false }
    })
    registerSequenceExecutionGuard(app)
    app.post("/v1/generate-image", paidHandler)
    try {
      const response = await app.inject({ method: "POST", url: "/v1/generate-image", payload: {
        workflowId: "private-workflow", nodeId: "linked",
      } })
      expect(response.statusCode).toBe(404)
      expect(response.json().error.code).toBe("not_found")
      expect(paidHandler).not.toHaveBeenCalled()
    } finally { await app.close() }
  })
})
