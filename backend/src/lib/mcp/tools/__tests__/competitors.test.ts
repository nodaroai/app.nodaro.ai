import { describe, expect, it } from "vitest"
import Fastify from "fastify"
import type { CompetitorCardsResult, TrackedCompetitor } from "@nodaro/shared"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { cardsText, competitorLine, registerCompetitorTools } from "../competitors.js"
import { buildServer, callTool, listTools } from "./_helpers.js"

const COMPETITOR: TrackedCompetitor = {
  id: "00000000-0000-4000-8000-0000000000c1",
  brand: "Acme Paint",
  website: "https://acme.example/",
  accounts: { tiktok: "acmepaint" },
  aboutPlatforms: ["reddit"],
  isOwn: false,
  schedule: "weekly",
  nextScanAt: null,
  lastScanAt: "2026-10-01T10:00:00Z",
  lastScanId: null,
  lastScanError: null,
  scanning: false,
  searches: 2,
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
}

function session(scopes: Scope[]) {
  return newSession({ userId: "u1", scopes, clientName: "Claude" })
}

function stubApp() {
  const fastify = Fastify()
  const received: Array<{ url: string; body?: Record<string, unknown>; user?: unknown }> = []
  fastify.get("/v1/competitors", async (req) => {
    received.push({ url: req.url, user: req.headers["x-internal-user-id"] })
    return { data: [COMPETITOR] }
  })
  fastify.post("/v1/competitor-discover", async (req) => {
    received.push({ url: req.url, body: req.body as Record<string, unknown> })
    return { brand: "Acme Paint", website: "https://acme.example/", accounts: { tiktok: { value: "acmepaint", from: "site" }, x: { value: "acmepaint", from: "guess" } } }
  })
  fastify.post("/v1/competitors", async (req, reply) => {
    received.push({ url: req.url, body: req.body as Record<string, unknown> })
    return reply.status(201).send(COMPETITOR)
  })
  fastify.post("/v1/competitor-scan", async (req) => {
    received.push({ url: req.url, body: req.body as Record<string, unknown> })
    return { jobId: "job-7" }
  })
  return { fastify, received }
}

describe("competitor MCP tools", () => {
  it("each tool needs its own scope", async () => {
    const server = buildServer()
    registerCompetitorTools({ server, session: session(["assets:read"]), fastify: stubApp().fastify })
    expect((await listTools(server)).map((t) => t.name).sort()).toEqual(["competitor_cards", "list_competitors"])
  })

  it("add_competitor finds the accounts from the website, then tracks the brand, saying what was guessed", async () => {
    const server = buildServer()
    const stub = stubApp()
    registerCompetitorTools({ server, session: session(["assets:write"]), fastify: stub.fastify })
    const res = await callTool(server, "add_competitor", { website: "acme.example" })

    expect(res.isError).toBeFalsy()
    expect(stub.received.map((r) => r.url)).toEqual(["/v1/competitor-discover", "/v1/competitors"])
    expect(stub.received[1]!.body).toMatchObject({ brand: "Acme Paint", website: "acme.example", accounts: { tiktok: "acmepaint", x: "acmepaint" }, userId: "u1" })
    expect(JSON.stringify(res.content)).toContain("Guessed (check them): x")
  })

  it("scan_competitor starts a job as the session's user", async () => {
    const server = buildServer()
    const stub = stubApp()
    registerCompetitorTools({ server, session: session(["workflows:execute"]), fastify: stub.fastify })
    const res = await callTool(server, "scan_competitor", { competitor_id: COMPETITOR.id })
    expect(res.isError).toBeFalsy()
    expect(stub.received[0]).toMatchObject({ url: "/v1/competitor-scan", body: { competitorId: COMPETITOR.id, userId: "u1" } })
  })

  it("lists brands and cards as plain lines", async () => {
    expect(competitorLine(COMPETITOR)).toContain("Acme Paint — id 00000000-0000-4000-8000-0000000000c1")
    const result: CompetitorCardsResult = {
      cards: [
        { id: "c", kind: "outlier", priority: 1, subjectId: COMPETITOR.id, params: {}, evidence: ["tiktok:1"], title: "Acme Paint's TikTok post did 5x their usual", why: "5K views", action: "Make your own version" },
      ],
      posts: { "tiktok:1": { id: "tiktok:1", platform: "tiktok", url: "https://www.tiktok.com/@acmepaint/video/1", text: "", author: { handle: "acmepaint", name: "" }, metrics: {}, media: { kind: "video" }, hashtags: [], extra: {}, role: "own" } },
    }
    expect(cardsText(result)).toBe(
      "1. [act now] Acme Paint's TikTok post did 5x their usual\n   5K views\n   → Make your own version\n   https://www.tiktok.com/@acmepaint/video/1",
    )
    expect(cardsText({ cards: [], posts: {} })).toContain("No action cards yet")
  })
})
