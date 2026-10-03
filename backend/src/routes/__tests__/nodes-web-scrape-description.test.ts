/**
 * Web Scrape's description in GET /v1/nodes names only the sources a user can
 * pick. Its Instagram source follows the Instagram node's availability, and
 * the description used to promise Instagram on deployments that withdraw it
 * (item 10 of the docs rebuild).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const { withdrawn } = vi.hoisted(() => ({ withdrawn: { sources: [] as string[] } }))

vi.mock("@/lib/surface-deny.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/surface-deny.js")>()),
  effectiveDeniedWebScrapeSources: () => withdrawn.sources,
}))
vi.mock("@/lib/pricing/charged-prices.js", () => ({
  loadChargedPrices: async () => ({ credits: () => undefined }),
}))

import { nodesRoutes } from "../nodes.js"
import { webScrapeDescription, NODE_REGISTRY } from "../../lib/node-registry.js"

let app: FastifyInstance

beforeEach(async () => {
  withdrawn.sources = []
  app = Fastify({ logger: false })
  await app.register(async (instance) => nodesRoutes(instance))
  await app.ready()
})

async function listedDescription(): Promise<string | undefined> {
  const body = (await app.inject({ method: "GET", url: "/v1/nodes" })).json() as { data: Array<{ type: string; description: string }> }
  return body.data.find((n) => n.type === "web-scrape")?.description
}

describe("webScrapeDescription", () => {
  it("names every source by default — the registry's text, unchanged", () => {
    expect(webScrapeDescription()).toBe("Fetch data from web pages, Google Search, Instagram, TikTok, or RSS feeds and emit structured JSON.")
    expect(NODE_REGISTRY.find((n) => n.type === "web-scrape")?.description).toBe(webScrapeDescription())
  })

  it("leaves out a withdrawn source", () => {
    expect(webScrapeDescription(new Set(["instagram"]))).toBe("Fetch data from web pages, Google Search, TikTok, or RSS feeds and emit structured JSON.")
  })
})

describe("GET /v1/nodes — Web Scrape", () => {
  it("names Instagram when users can pick it", async () => {
    expect(await listedDescription()).toContain("Instagram")
  })

  it("does not name Instagram when the deployment withdraws it from users", async () => {
    withdrawn.sources = ["instagram"]
    const description = await listedDescription()
    expect(description).not.toContain("Instagram")
    expect(description).toContain("TikTok")
    const detail = (await app.inject({ method: "GET", url: "/v1/nodes/web-scrape" })).json() as { data: { description: string } }
    expect(detail.data.description).not.toContain("Instagram")
  })
})
