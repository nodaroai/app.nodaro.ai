/**
 * The share card route (routes/share-card.ts): `GET /og/s/:token`, which the
 * bundled proxy answers `/s/<token>` with. For each kind of link it writes the
 * tags of what the link shows (an image, a video, a sound with and without a
 * cover, a trend run, a session, a project), sends people on to
 * `${SHARE_SITE_ORIGIN}/shared/<token>` with the shared address as og:url and
 * canonical, keeps user text inert, and answers a link that is unknown or
 * turned off with a 404 page that says nothing about any content.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import type { QueryResult, RecordedQuery } from "../../lib/__tests__/fake-supabase-query.js"

const OWNER = "00000000-0000-4000-8000-000000000001"
const JOB = "00000000-0000-4000-8000-0000000000a1"
const SESSION = "00000000-0000-4000-8000-000000000020"
const PROJECT = "00000000-0000-4000-8000-000000000030"
const TOKEN = "Tok_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-ab"

type Row = Record<string, unknown>

const db = vi.hoisted(() => ({
  log: [] as RecordedQuery[],
  shares: [] as Row[],
  jobs: [] as Row[],
  sessions: [] as Row[],
  projects: [] as Row[],
  rpc: vi.fn(async (_fn: string, _args: unknown) => ({ data: [] as unknown, error: null as unknown })),
}))

function matches(q: RecordedQuery, row: Row): boolean {
  return q.ops.every((o) => (o.m !== "eq" && o.m !== "is") || String(o.a[0]).includes(".") || (row[String(o.a[0])] ?? null) === o.a[1])
}

function respond(q: RecordedQuery): QueryResult {
  const table = { share_links: db.shares, jobs: db.jobs, generation_sessions: db.sessions, projects: db.projects }[
    q.table as "share_links" | "jobs" | "generation_sessions" | "projects"
  ]
  if (!table) return { data: null, error: null }
  if (q.ops.some((o) => o.m === "order")) return { data: table.filter((r) => matches(q, r)), error: null }
  return { data: table.find((r) => matches(q, r)) ?? null, error: null }
}

vi.mock("../../lib/supabase.js", async () => {
  const { makeFakeFrom } = await import("../../lib/__tests__/fake-supabase-query.js")
  return { supabase: { from: makeFakeFrom(db.log, (q) => respond(q)), rpc: (fn: string, args: unknown) => db.rpc(fn, args) } }
})
vi.mock("../../lib/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/config.js")>()
  return { ...actual, config: { ...actual.config, SHARE_SITE_ORIGIN: "https://next.share.example/", PUBLIC_URL: "https://app.example" } }
})
const gates = vi.hoisted(() => ({ publicOutputs: true }))
vi.mock("../../lib/surface-profile.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/surface-profile.js")>()),
  surfaceAllowsPublicOutputs: () => gates.publicOutputs,
}))
vi.mock("../../lib/access-blocks.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/access-blocks.js")>()),
  isUserBlocked: async () => false,
}))
vi.mock("../../lib/content-restriction-set.js", () => ({ restrictedKeysNow: () => new Set<string>() }))

import { shareCardRoutes } from "../share-card.js"
import { __isPublicRouteForTest, isAnonymousRoute } from "../../middleware/auth.js"

function share(kind: "job" | "session" | "project", target: string, over: Row = {}): void {
  db.shares.push({ id: "s1", token: TOKEN, owner_id: OWNER, kind, target_id: target, allow_copy: true, revoked_at: null, created_at: "x", updated_at: "x", ...over })
}

function jobRow(over: Row = {}): Row {
  return {
    id: JOB,
    user_id: OWNER,
    status: "completed",
    job_type: "generate-image",
    created_at: "2026-11-19T10:00:00Z",
    parent_job_id: null,
    restricted_at: null,
    force_private: null,
    deleted_at: null,
    input_data: { type: "generate-image", userPrompt: "a red car on a beach", provider: "nano-banana-pro", referenceImageUrls: ["https://cdn.example/uploads/ref.png"] },
    output_data: { imageUrl: "https://cdn.example/images/a1.png", width: 1024, height: 768 },
    ...over,
  }
}

/** The content of every `<meta property|name=… content=…>`, by key. */
function tags(html: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of html.matchAll(/<meta (?:property|name)="([^"]+)" content="([^"]*)">/g)) out[m[1]!] = m[2]!
  return out
}

let app: FastifyInstance

beforeEach(async () => {
  db.log.length = 0
  db.shares.length = 0
  db.jobs.length = 0
  db.sessions.length = 0
  db.projects.length = 0
  db.rpc.mockReset()
  db.rpc.mockResolvedValue({ data: [], error: null })
  gates.publicOutputs = true
  app = Fastify({ logger: false })
  await app.register(shareCardRoutes)
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

const card = () => app.inject({ method: "GET", url: `/og/s/${TOKEN}` })

describe("the card's address is public", () => {
  it("any method on /og/s/… takes no credential (a preview reader may HEAD first)", () => {
    expect(__isPublicRouteForTest("GET", `/og/s/${TOKEN}`)).toBe(true)
    expect(__isPublicRouteForTest("HEAD", `/og/s/${TOKEN}`)).toBe(true)
    expect(isAnonymousRoute("GET", `/og/s/${TOKEN}`)).toBe(true)
    expect(__isPublicRouteForTest("GET", "/og/x")).toBe(false)
  })
})

describe("GET /og/s/:token", () => {
  it("an image: its tags, people sent to the share page, the shared address as og:url and canonical", async () => {
    share("job", JOB)
    db.jobs.push(jobRow())
    const res = await card()
    expect(res.statusCode).toBe(200)
    expect(res.headers["content-type"]).toBe("text/html; charset=utf-8")
    expect(res.headers["cache-control"]).toBe("public, max-age=300")
    expect(res.headers["x-robots-tag"]).toBe("noindex")
    expect(String(res.headers["content-security-policy"])).toContain("default-src 'none'")
    expect(tags(res.body)).toMatchObject({
      "og:type": "website",
      "og:site_name": "Nodaro",
      "og:title": "a red car on a beach",
      "og:description": "a red car on a beach",
      "og:url": `https://next.share.example/s/${TOKEN}`,
      "og:image": "https://cdn.example/images/a1.png",
      "og:image:width": "1024",
      "og:image:height": "768",
      "twitter:card": "summary_large_image",
      "twitter:image": "https://cdn.example/images/a1.png",
    })
    expect(res.body).toContain(`<link rel="canonical" href="https://next.share.example/s/${TOKEN}">`)
    expect(res.body).toContain(`<meta http-equiv="refresh" content="0; url=https://next.share.example/shared/${TOKEN}">`)
    expect(res.body).toContain(`location.replace("https://next.share.example/shared/${TOKEN}")`)
    expect(res.body).toContain(`<a href="https://next.share.example/shared/${TOKEN}">`)
    // A card never hands out references, whatever the link allows.
    expect(res.body).not.toContain("uploads/ref.png")
  })

  it("a video: its poster and the video", async () => {
    share("job", JOB)
    db.jobs.push(jobRow({ output_data: { videoUrl: "https://cdn.example/videos/v.mp4", thumbnailUrl: "https://cdn.example/images/t.jpg", width: 1280, height: 720 } }))
    const t = tags((await card()).body)
    expect(t).toMatchObject({
      "og:type": "video.other",
      "og:image": "https://cdn.example/images/t.jpg",
      "og:video": "https://cdn.example/videos/v.mp4",
      "og:video:secure_url": "https://cdn.example/videos/v.mp4",
      "og:video:type": "video/mp4",
      "og:video:width": "1280",
      "og:video:height": "720",
    })
  })

  it("a sound with a cover shows the cover; without one, the brand picture", async () => {
    share("job", JOB)
    db.jobs.push(jobRow({ input_data: { type: "suno-generate", prompt: "lofi beats" }, output_data: { audioUrl: "https://cdn.example/audios/s.mp3", sunoImageUrl: "https://covers.example/c.jpeg" } }))
    expect(tags((await card()).body)["og:image"]).toBe("https://covers.example/c.jpeg")
    db.jobs[0]!.output_data = { audioUrl: "https://cdn.example/audios/s.mp3" }
    const t = tags((await card()).body)
    expect(t["og:image"]).toBe("https://app.example/logo-512.png")
    expect(t["og:image:width"]).toBe("512")
  })

  it("the title, description and page title read the prompt as a person does", async () => {
    share("job", JOB)
    db.jobs.push(
      jobRow({
        input_data: {
          type: "generate-image",
          userPrompt: "@image-1:1 Viral entrepreneurial transformation",
          connectedReferences: [{ id: "c1", defaultName: "Image 1", source: "manual", url: "https://cdn.example/uploads/me.png" }],
        },
      }),
    )
    const res = await card()
    expect(tags(res.body)).toMatchObject({
      "og:title": "@Image 1 Viral entrepreneurial transformation",
      "og:description": "@Image 1 Viral entrepreneurial transformation",
      "twitter:title": "@Image 1 Viral entrepreneurial transformation",
      "twitter:description": "@Image 1 Viral entrepreneurial transformation",
    })
    expect(res.body).toContain("<title>@Image 1 Viral entrepreneurial transformation — Nodaro</title>")
    expect(res.body).not.toContain("@image-1:1")
    expect(res.body).not.toContain("uploads/me.png")
  })

  it("a trend run: the trend's name, never its prompt", async () => {
    share("job", JOB)
    db.jobs.push(
      jobRow({
        input_data: { type: "cast-swap", trend: { slug: "office-dance", name: "Office Dance" }, prompt: "the platform's own wording" },
        output_data: { videoUrl: "https://cdn.example/videos/r.mp4" },
      }),
    )
    const res = await card()
    expect(tags(res.body)).toMatchObject({ "og:title": "Office Dance", "og:description": "Made with the Office Dance trend on Nodaro." })
    expect(res.body).not.toContain("platform's own wording")
  })

  it("a session and a project: their own title or name, and their first result's picture", async () => {
    db.rpc.mockImplementation(async (_fn: string, args: unknown) => ({
      data: (args as { p_session_ids: string[] }).p_session_ids.map((id) => ({
        session_id: id,
        item_count: 2,
        recent: [{ job_id: JOB, output_data: { imageUrl: "https://cdn.example/images/cover.png" } }],
      })),
      error: null,
    }))
    db.sessions.push({ id: SESSION, user_id: OWNER, project_id: PROJECT, workspace_id: null, archived_at: null, title: "Beach day", tool: "create-image", created_at: "x" })
    db.projects.push({ id: PROJECT, user_id: OWNER, workspace_id: null, name: "Holiday" })
    share("session", SESSION)
    expect(tags((await card()).body)).toMatchObject({ "og:title": "Beach day", "og:description": "2 results on Nodaro.", "og:image": "https://cdn.example/images/cover.png" })
    db.shares.length = 0
    share("project", PROJECT)
    expect(tags((await card()).body)).toMatchObject({ "og:title": "Holiday", "og:description": "1 session on Nodaro.", "og:image": "https://cdn.example/images/cover.png" })
  })

  it('keeps user text inert: a prompt with "<script> is escaped everywhere', async () => {
    share("job", JOB)
    db.jobs.push(jobRow({ input_data: { type: "generate-image", userPrompt: `"><script>alert(1)</script>` }, title: null }))
    const res = await card()
    expect(res.body).not.toContain("<script>alert(1)</script>")
    expect(res.body).toContain("&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;")
    expect(res.body.match(/<script>/g)).toHaveLength(1)
  })

  it("404s, saying nothing, for a link turned off, unknown, malformed, or whose job is gone or private", async () => {
    share("job", JOB, { revoked_at: "2026-11-19T12:00:00Z" })
    db.jobs.push(jobRow())
    for (const url of [`/og/s/${TOKEN}`, `/og/s/${"x".repeat(43)}`, "/og/s/short"]) {
      const res = await app.inject({ method: "GET", url })
      expect(res.statusCode, url).toBe(404)
      expect(res.headers["x-robots-tag"]).toBe("noindex")
      expect(res.headers["cache-control"]).toBe("no-store")
      expect(res.body).not.toMatch(/og:|twitter:|red car/)
    }
    db.shares[0]!.revoked_at = null
    db.jobs[0]!.force_private = true
    expect((await card()).statusCode).toBe(404)
    db.jobs[0]!.force_private = null
    db.jobs[0]!.deleted_at = "2026-11-19T12:00:00Z"
    expect((await card()).statusCode).toBe(404)
  })

  it("404s every card where public work is not allowed", async () => {
    share("job", JOB)
    db.jobs.push(jobRow())
    gates.publicOutputs = false
    expect((await card()).statusCode).toBe(404)
  })
})
