import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { Readable } from "node:stream"
const { fake } = vi.hoisted(() => ({ fake: { current: null as unknown } }))
vi.mock("@/lib/supabase.js", () => ({ get supabase() { return fake.current } }))
vi.mock("@/lib/workflow-access.js", async (original) => ({
  ...await original<typeof import("../../lib/workflow-access.js")>(), workflowAccess: vi.fn(),
}))
import { workflowAccess } from "../../lib/workflow-access.js"
import { scene3DArtifactRoutes } from "../scene3d-artifacts.js"
import { deliveryFixture, OWNER, OTHER, JOB, REV, WF, SOURCE_WF, POSTER, REPORT } from "../../services/scene3d-artifacts/__tests__/delivery-fixture.js"

let fixture: ReturnType<typeof deliveryFixture>
let app: FastifyInstance
beforeEach(async () => {
  vi.clearAllMocks()
  vi.mocked(workflowAccess).mockResolvedValue("view")
  fixture = deliveryFixture(); fixture.published(); fake.current = fixture.db
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    if (typeof req.headers["x-user-id"] === "string") req.userId = req.headers["x-user-id"]
  })
  await app.register(async (instance) => scene3DArtifactRoutes(instance, { store: fixture.store }))
  await app.ready()
})
afterEach(async () => { await app.close() })
const get = (suffix = "", userId: string | null = OWNER, extra: Record<string, string> = {}) => app.inject({
  method: "GET", url: `/v1/3d-scene/deliveries/${JOB}${suffix}`,
  headers: { ...(userId ? { "x-user-id": userId } : {}), ...extra },
})

describe("retained delivery reads", () => {
  it("requires authentication", async () => {
    expect((await get("", null)).statusCode).toBe(401)
    expect((await get(`/assets/${POSTER}`, null)).statusCode).toBe(401)
  })
  it("returns opaque descriptors with the exact source revision and no private paths", async () => {
    const res = await get()
    expect(res.statusCode).toBe(200)
    expect(res.headers["cache-control"]).toBe("no-store, private")
    expect(res.json()).toMatchObject({ deliveryId: JOB, sceneRevisionId: REV, access: "view" })
    expect(res.json().assets.map((a: { assetId: string }) => a.assetId)).toEqual([POSTER, REPORT])
    expect(res.payload).not.toContain("scene3d/")
    expect(res.payload).not.toContain("private-scenes")
  })
  it.each([WF, SOURCE_WF])("honors revocation on anchor %s even for its creator", async (denied) => {
    vi.mocked(workflowAccess).mockImplementation(async (_, wf) => wf === denied ? "none" : "own")
    expect((await get()).statusCode).toBe(404)
    expect((await get(`/assets/${POSTER}`)).statusCode).toBe(404)
    expect(fixture.store.get).not.toHaveBeenCalled()
  })
  it("reports the current reduced access level after reading metadata", async () => {
    vi.mocked(workflowAccess).mockResolvedValueOnce("own").mockResolvedValueOnce("own").mockResolvedValue("view")
    const res = await get()
    expect(res.statusCode).toBe(200)
    expect(res.json().access).toBe("view")
  })
  it("retains bytes after source revision deletion but still asks its workflow", async () => {
    fixture.db.tables.scene3d_revisions.length = 0
    expect((await get(`/assets/${POSTER}`)).statusCode).toBe(200)
    vi.mocked(workflowAccess).mockImplementation(async (_, wf) => wf === SOURCE_WF ? "none" : "own")
    expect((await get(`/assets/${POSTER}`)).statusCode).toBe(404)
  })
  it("requires personal-source ownership even for delivery workflow collaborators", async () => {
    fixture.db.tables.scene3d_deliveries[0].source_workflow_id = null
    expect((await get("", OTHER)).statusCode).toBe(404)
    expect((await get()).statusCode).toBe(200)
  })
  it("serves a poster range through the same private authenticated endpoint", async () => {
    const res = await get(`/assets/${POSTER}`, OWNER, { range: "bytes=0-7" })
    expect(res.statusCode).toBe(206)
    expect(res.headers["content-type"]).toBe("image/png")
    expect(res.headers["cache-control"]).toBe("no-store, private")
    expect(res.rawPayload).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  })
  it("refuses unpinned assets and private source kinds even if mispinned", async () => {
    fixture.db.tables.scene3d_delivery_artifacts.pop()
    expect((await get(`/assets/${REPORT}`)).statusCode).toBe(404)
    fixture.db.tables.scene3d_artifacts[0].kind = "source-json"
    expect((await get(`/assets/${POSTER}`)).statusCode).toBe(404)
    expect((await get()).json().assets).toEqual([])
  })
  it("does not accept a pin with the wrong actual artifact owner", async () => {
    fixture.db.tables.scene3d_artifacts[0].user_id = OTHER
    expect((await get(`/assets/${POSTER}`)).statusCode).toBe(404)
  })
  it("closes storage and returns no bytes if source access changes during the read", async () => {
    const source = new Readable({ read() {} })
    vi.mocked(fixture.store.get).mockImplementation(async () => {
      vi.mocked(workflowAccess).mockResolvedValue("none")
      return { body: source, contentLength: 32, etag: "tag" }
    })
    const res = await get(`/assets/${POSTER}`)
    expect(res.statusCode).toBe(404)
    await new Promise((resolve) => setImmediate(resolve))
    expect(source.destroyed).toBe(true)
  })
  it("fails rather than returning a partial metadata list on storage errors", async () => {
    fixture.db.failTable("scene3d_delivery_artifacts", "connection dropped")
    expect((await get()).statusCode).toBe(502)
  })
})
