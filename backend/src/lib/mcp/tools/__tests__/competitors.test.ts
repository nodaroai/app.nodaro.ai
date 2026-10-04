import { describe, expect, it } from "vitest"
import Fastify from "fastify"
import type { CardAction, CompetitorActionsResult, CompetitorCardsResult, TrackedCompetitor } from "@nodaro/shared"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { cardsText, competitorLine, lessonsText, outcomeText, registerCompetitorTools, triedText } from "../competitors.js"
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

const MARK: CardAction = {
  id: "00000000-0000-4000-8000-0000000000a1",
  cardId: "sound:c1:7",
  cardKind: "sound",
  card: { title: "Sound in 3 of Acme's new videos", why: "w", action: "a", evidence: [] },
  subjectId: "c1",
  postUrl: "https://www.tiktok.com/@me/video/1",
  linkedAt: "2026-10-03T00:00:00Z",
  actedAt: "2026-10-02T00:00:00Z",
  verdict: null,
  seenAt: null,
  onWall: true,
  outcome: { state: "waiting" },
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
  fastify.post("/v1/competitors/actions", async (req) => {
    received.push({ url: req.url, body: req.body as Record<string, unknown> })
    return { action: MARK, posts: {}, created: false }
  })
  fastify.patch("/v1/competitors/actions/:id", async (req) => {
    received.push({ url: req.url, body: req.body as Record<string, unknown> })
    return { action: { ...MARK, postUrl: (req.body as { postUrl: string }).postUrl, outcome: { state: "waiting" } }, posts: {} }
  })
  return { fastify, received }
}

describe("competitor MCP tools", () => {
  it("each tool needs its own scope", async () => {
    const server = buildServer()
    registerCompetitorTools({ server, session: session(["assets:read"]), fastify: stubApp().fastify })
    expect((await listTools(server)).map((t) => t.name).sort()).toEqual(["competitor_cards", "competitor_lessons", "competitor_tried", "list_competitors"])
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

  it("says what works for a brand, per platform, with the posts each lesson rests on", () => {
    const lessons = {
      subjectId: "c1",
      isOwn: true,
      minPosts: 6,
      platforms: [
        {
          platform: "tiktok",
          posts: 12,
          usual: 1150,
          unit: "views" as const,
          winners: ["tiktok:1"],
          misses: [],
          lessons: [{ id: "tiktok:short_videos:short", kind: "short_videos" as const, platform: "tiktok", params: {}, evidence: ["tiktok:1"], strength: 2.4, text: "On TikTok, videos of 15 seconds or less got 2.4x your usual views (4 posts, 3 of the best)." }],
        },
        { platform: "instagram", posts: 3, usual: null, unit: "views" as const, winners: [], misses: [], lessons: [] },
      ],
    }
    const posts = { "tiktok:1": { url: "https://www.tiktok.com/@acme/video/1" } } as never
    expect(lessonsText({ lessons, posts })).toBe(
      "tiktok: 12 posts, usually 1150 views.\n" +
        "   - On TikTok, videos of 15 seconds or less got 2.4x your usual views (4 posts, 3 of the best).\n" +
        "     https://www.tiktok.com/@acme/video/1\n\n" +
        "instagram: 3 posts — needs 6 to tell what works.",
    )
    expect(lessonsText({ lessons: { ...lessons, platforms: [] }, posts: {} })).toContain("No posts of its own yet")
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
      "1. [act now] Acme Paint's TikTok post did 5x their usual\n   5K views\n   → Make your own version\n   https://www.tiktok.com/@acmepaint/video/1\n   card id (for mark_card_done): c",
    )
    expect(cardsText({ cards: [], posts: {} })).toContain("No action cards yet")
  })
})

describe("did it work, over MCP", () => {
  it("mark_card_done marks a card, and sets the link on a card marked before", async () => {
    const server = buildServer()
    const stub = stubApp()
    registerCompetitorTools({ server, session: session(["assets:write"]), fastify: stub.fastify })
    const res = await callTool(server, "mark_card_done", { card_id: "sound:c1:7", post_url: "https://www.tiktok.com/@me/video/2" })
    expect(res.isError).toBeFalsy()
    expect(stub.received.map((r) => r.url)).toEqual(["/v1/competitors/actions", `/v1/competitors/actions/${MARK.id}`])
    expect(stub.received[0]!.body).toMatchObject({ cardId: "sound:c1:7", postUrl: "https://www.tiktok.com/@me/video/2", userId: "u1" })
    expect(stub.received[1]!.body).toMatchObject({ postUrl: "https://www.tiktok.com/@me/video/2" })
    expect(JSON.stringify(res.content)).toContain("Already marked")
  })

  it("mark_card_done keeps a verdict: a card judged on one post is not relinked to another", async () => {
    const server = buildServer()
    const fastify = Fastify()
    const received: string[] = []
    const verdict = { state: "worked" as const, ratio: 2.1, reach: 2100, usual: 1000, unit: "views" as const, platform: "tiktok", postId: "tiktok:1", matchedBy: "link" as const, at: "2026-10-04T00:00:00Z" }
    fastify.post("/v1/competitors/actions", async (req) => {
      received.push(req.url)
      return { action: { ...MARK, verdict, outcome: { state: "worked", ratio: 2.1 } }, posts: {}, created: false }
    })
    fastify.patch("/v1/competitors/actions/:id", async (req) => {
      received.push(req.url)
      return { action: MARK, posts: {} }
    })
    registerCompetitorTools({ server, session: session(["assets:write"]), fastify })
    const res = await callTool(server, "mark_card_done", { card_id: "sound:c1:7", post_url: "https://www.tiktok.com/@me/video/9" })
    expect(received).toEqual(["/v1/competitors/actions"])
    expect(JSON.stringify(res.content)).toContain("Kept: it was already judged on https://www.tiktok.com/@me/video/1")
    const bad = await callTool(server, "mark_card_done", { card_id: "sound:c1:7", post_url: "javascript:alert(1)" })
    expect(bad.isError).toBe(true)
  })

  it("says how each tried card went, and what has worked, newest first", () => {
    const result: CompetitorActionsResult = {
      actions: [
        { ...MARK, outcome: { state: "worked", ratio: 2.1, reach: 8400, usual: 4000, unit: "views", platform: "tiktok" } },
        { ...MARK, id: "m2", onWall: false, postUrl: null, outcome: { state: "no_posts_yet" } },
      ],
      record: [
        { family: "sound", tried: 4, worked: 3, flat: 1, missed: 0, avgRatio: 2.1, shown: true, tier: "proven" },
        { family: "launch", tried: 1, worked: 1, flat: 0, missed: 0, avgRatio: 3, shown: false, tier: "neutral" },
      ],
      posts: {},
    }
    const out = triedText(result, 20)
    expect(out).toContain("Sound advice: 3 of 4 worked for the user (on average 2.1x their usual).")
    expect(out).not.toContain("Answering a launch")
    expect(out).toContain("Worked: 2.1x the user's usual (8400 views against a usual 4000 on tiktok).")
    expect(out).toContain("(no longer on the wall)")
    expect(triedText(result, 1)).toContain("(1 older marks not shown)")
    expect(triedText({ actions: [], record: [], posts: {} }, 20)).toContain("No card marked done yet")
    for (const state of ["flat", "missed", "waiting", "not_found", "older_than_advice", "no_baseline", "posts_since", "no_brand"] as const) {
      expect(outcomeText({ state, ratio: 1.2 }).length).toBeGreaterThan(10)
    }
  })
})
