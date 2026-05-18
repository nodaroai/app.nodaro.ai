import { describe, it, expect } from "vitest"
import { buildMcpServer } from "../server.js"
import type { Scope } from "../../scopes.js"
import { listTools } from "../tools/__tests__/_helpers.js"

const FAKE_FASTIFY = {} as Parameters<typeof buildMcpServer>[0]["fastify"]

describe("buildMcpServer wires skill loaders", () => {
  it("exposes start_workflow_editor in tools/list", async () => {
    const server = await buildMcpServer({
      userId: "u-x",
      scopes: [] as Scope[],
      clientName: "Claude",
      fastify: FAKE_FASTIFY,
    })
    const names = (await listTools(server)).map((t) => t.name)
    expect(names).toContain("start_workflow_editor")
  })

  it("exposes get_node_skill in tools/list", async () => {
    const server = await buildMcpServer({
      userId: "u-x",
      scopes: [] as Scope[],
      clientName: "Claude",
      fastify: FAKE_FASTIFY,
    })
    const names = (await listTools(server)).map((t) => t.name)
    expect(names).toContain("get_node_skill")
  })

  it("exposes start_film_director still (no regression)", async () => {
    const server = await buildMcpServer({
      userId: "u-x",
      scopes: [] as Scope[],
      clientName: "Claude",
      fastify: FAKE_FASTIFY,
    })
    const names = (await listTools(server)).map((t) => t.name)
    expect(names).toContain("start_film_director")
  })
})
