import { describe, expect, it } from "vitest"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { registerResearchTools } from "../research.js"
import { buildServer, callTool, executeSession, listTools, stubRoute } from "./_helpers.js"

describe("social_search", () => {
  it("is hidden without workflows:execute", async () => {
    const server = buildServer()
    const { fastify } = stubRoute("POST", "/v1/social-search", { jobId: "job-1" })
    registerResearchTools({ server, session: newSession({ userId: "u1", scopes: ["workflows:read"] as Scope[], clientName: "Claude" }), fastify })
    expect((await listTools(server)).map((t) => t.name)).not.toContain("social_search")
  })

  it("dispatches the search to the plugin route in the route's own field names", async () => {
    const server = buildServer()
    const stub = stubRoute("POST", "/v1/social-search", { jobId: "job-1" })
    registerResearchTools({ server, session: executeSession(), fastify: stub.fastify })
    const res = await callTool(server, "social_search", {
      platform: "meta_ads",
      query: "Brand Six",
      mode: "account",
      count: 40,
      country: "us",
      active_only: false,
    })
    expect(res.isError).toBeFalsy()
    expect(stub.received.url).toBe("/v1/social-search")
    expect(stub.received.body).toMatchObject({
      platform: "meta_ads",
      mode: "account",
      query: "Brand Six",
      count: 40,
      country: "US",
      activeOnly: false,
      mcp_client: "Claude",
      userId: "u1",
    })
    expect(stub.received.body).not.toHaveProperty("active_only")
  })

  it("refuses a mode the platform does not have before any request", async () => {
    const server = buildServer()
    const stub = stubRoute("POST", "/v1/social-search", { jobId: "job-1" })
    registerResearchTools({ server, session: executeSession(), fastify: stub.fastify })
    const res = await callTool(server, "social_search", { platform: "reddit", mode: "account", query: "x" })
    expect(res.isError).toBe(true)
    expect(JSON.stringify(res.content)).toContain("reddit supports keyword or community search")
    expect(stub.received.url).toBeUndefined()
  })
})
