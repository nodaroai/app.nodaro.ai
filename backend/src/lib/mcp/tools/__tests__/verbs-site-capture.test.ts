import Fastify from "fastify"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Scope } from "../../../scopes.js"
import { newSession } from "../../session.js"
import { buildServer, callTool, executeSession, listTools, type ListedTool } from "./_helpers.js"

const h = vi.hoisted(() => ({ on: true, denied: false }))
vi.mock("../../../config.js", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../../config.js")>()), siteCaptureEnabled: () => h.on }))
vi.mock("../../../surface-deny.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../surface-deny.js")>()),
  isNodeDenied: (type: string) => h.denied && type === "site-capture",
}))

const { registerSiteCaptureVerb, captureSiteDescription, CAPTURE_STILL_KEYS } = await import("../verbs-site-capture.js")
const { jobView } = await import("../_job-view.js")

function routeAnswering(status: number, body: object) {
  const seen: { body?: Record<string, unknown>; headers?: Record<string, unknown> } = {}
  const fastify = Fastify()
  fastify.post("/v1/site-capture", async (req, reply) => {
    seen.body = req.body as Record<string, unknown>
    seen.headers = req.headers as Record<string, unknown>
    return reply.code(status).send(body)
  })
  return { fastify, seen }
}

function serverWith(fastify = Fastify(), session = executeSession()) {
  const server = buildServer()
  registerSiteCaptureVerb({ server, session, fastify })
  return server
}

beforeEach(() => {
  h.on = true
  h.denied = false
})

describe("capture_site — registration", () => {
  it("is listed under workflows:execute, with the job output schema and open-world annotations", async () => {
    // tools/list serves the whole definition; McpToolDef types only part of it.
    const tool = (await listTools(serverWith())).find((t) => t.name === "capture_site") as
      | (ListedTool & { annotations?: Record<string, unknown>; outputSchema?: unknown })
      | undefined
    expect(tool).toBeDefined()
    expect(tool!.annotations).toMatchObject({ readOnlyHint: false, openWorldHint: true })
    expect(tool!.outputSchema).toBeDefined()
  })
  it("is not listed without workflows:execute", async () => {
    const session = newSession({ userId: "u1", scopes: [] as Scope[], clientName: "Claude" })
    expect((await listTools(serverWith(Fastify(), session))).map((t) => t.name)).not.toContain("capture_site")
  })
  it("is not listed when the switch is off", async () => {
    h.on = false
    expect((await listTools(serverWith())).map((t) => t.name)).not.toContain("capture_site")
  })
  it("is not listed when a surface profile denies site-capture", async () => {
    h.denied = true
    expect((await listTools(serverWith())).map((t) => t.name)).not.toContain("capture_site")
  })
})

describe("capture_site — the handler", () => {
  it("dispatches { url, maxStills, respondAsync, mcp_client, userId } and the retry token as an idempotency key", async () => {
    const { fastify, seen } = routeAnswering(200, { jobId: "job-1", status: "pending" })
    const result = await callTool(serverWith(fastify), "capture_site", { url: "example.com", max_stills: 5, client_request_id: "retry-123456" })
    expect(result.isError).toBeFalsy()
    expect(seen.body).toEqual({ url: "example.com", maxStills: 5, respondAsync: true, mcp_client: "Claude", userId: "u1" })
    expect(seen.headers!["idempotency-key"]).toBe("mcp:retry-123456")
  })
  it("leaves maxStills and the idempotency key out when not given", async () => {
    const { fastify, seen } = routeAnswering(200, { jobId: "job-1", status: "pending" })
    await callTool(serverWith(fastify), "capture_site", { url: "https://example.com/" })
    expect(seen.body).not.toHaveProperty("maxStills")
    expect(seen.headers!["idempotency-key"]).toBeUndefined()
  })
  it("surfaces the route's 4xx message", async () => {
    const message = "This site asks automated tools not to load this page (robots.txt). Send screenshots of it instead."
    const { fastify } = routeAnswering(422, { error: { code: "robots_disallowed", message } })
    const result = await callTool(serverWith(fastify), "capture_site", { url: "https://example.com/" })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain("robots.txt")
  })
})

describe("capture_site — the documented keys exist", () => {
  it("the description names exactly the keys a completed job's outputData.stills[0] carries", () => {
    const description = captureSiteDescription()
    expect(description).toContain(`each with ${CAPTURE_STILL_KEYS[0]} and ${CAPTURE_STILL_KEYS[1]}`)
    const view = jobView({
      id: "job-1",
      status: "completed",
      output_data: { stills: [{ index: 0, sectionOrder: 0, label: "Top", category: "hero", assetId: "asset-1", url: "https://r2.example/a.png", width: 1082, height: 1286 }], sections: [], usableStills: 1 },
    })
    const still = (view.outputData as { stills: Array<Record<string, unknown>> }).stills[0]!
    for (const key of CAPTURE_STILL_KEYS) expect(still).toHaveProperty(key)
    expect(view.outputUrl).toBeNull()
  })
  it("ends with the price read from the credit table", () => {
    expect(captureSiteDescription()).toMatch(/(\d+ cr|credits: see list_models) per capture\.$/)
  })
})
