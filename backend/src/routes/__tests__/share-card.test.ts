/**
 * The share card route (routes/share-card.ts): `GET /og/s/:token`, which the
 * bundled proxy answers `/s/<token>` with. For each kind of link (a picture, a
 * video, a song, a speech take, a trend run, a session, a project) it writes
 * the result's own name and tool, one line in the link's language, the card's
 * own picture once it is rendered (else the best one already ours, else the
 * brand's card; never a provider's address), sends people on to
 * `${SHARE_SITE_ORIGIN}/shared/<token>` with the shared address as og:url and
 * canonical, answers every preview reader the same, keeps user text inert, and
 * answers a link that is unknown or turned off with a 404 page that says
 * nothing about any content.
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
  return { ...actual, config: { ...actual.config, SHARE_SITE_ORIGIN: "https://next.share.example/", PUBLIC_URL: "https://app.example", R2_PUBLIC_URL: "https://cdn.example" } }
})
const gates = vi.hoisted(() => ({ publicOutputs: true, blocked: new Set<string>() }))
vi.mock("../../lib/surface-profile.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/surface-profile.js")>()),
  surfaceAllowsPublicOutputs: () => gates.publicOutputs,
}))
vi.mock("../../lib/access-blocks.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/access-blocks.js")>()),
  isUserBlocked: async (id: string) => gates.blocked.has(id),
}))
vi.mock("../../lib/content-restriction-set.js", () => ({ restrictedKeysNow: () => new Set<string>() }))
/** The card picture service: which pictures are rendered, and which renders were started. */
const pictures = vi.hoisted(() => ({ rendered: new Set<string>(), asked: [] as Array<{ token: string; picture: unknown }> }))
vi.mock("../../lib/share-links/card-image/service.js", () => ({
  renderedCardImage: async (token: string, picture: unknown) => {
    pictures.asked.push({ token, picture })
    const key = JSON.stringify(picture)
    return pictures.rendered.has(key) ? { url: "https://cdn.example/share-cards/t/rendered.jpg", width: 1200, height: 630, type: "image/jpeg" } : null
  },
}))

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
  gates.blocked.clear()
  pictures.rendered.clear()
  pictures.asked.length = 0
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
  it("a picture: its name and tool, one line, the picture already ours until its own is rendered", async () => {
    share("job", JOB)
    db.jobs.push(jobRow())
    const res = await card()
    expect(res.statusCode).toBe(200)
    expect(res.headers["content-type"]).toBe("text/html; charset=utf-8")
    // Its own picture is not rendered yet: caches keep this answer for a minute only.
    expect(res.headers["cache-control"]).toBe("public, max-age=60")
    expect(res.headers["x-robots-tag"]).toBe("noindex")
    expect(String(res.headers["content-security-policy"])).toContain("default-src 'none'")
    expect(tags(res.body)).toMatchObject({
      "og:type": "website",
      "og:site_name": "Nodaro",
      "og:title": "a red car on a beach · Image Generation",
      "og:description": "A picture made with Nodaro",
      "og:url": `https://next.share.example/s/${TOKEN}`,
      "og:image": "https://cdn.example/images/a1.png",
      "og:image:width": "1024",
      "og:image:height": "768",
      "og:image:type": "image/png",
      "og:image:alt": "a red car on a beach · Image Generation",
      "twitter:card": "summary_large_image",
      "twitter:image": "https://cdn.example/images/a1.png",
    })
    expect(res.body).toContain("<title>a red car on a beach · Image Generation — Nodaro</title>")
    expect(res.body).toContain(`<link rel="canonical" href="https://next.share.example/s/${TOKEN}">`)
    expect(res.body).toContain(`<meta http-equiv="refresh" content="0; url=https://next.share.example/shared/${TOKEN}">`)
    expect(res.body).toContain(`location.replace("https://next.share.example/shared/${TOKEN}")`)
    expect(res.body).toContain(`<a href="https://next.share.example/shared/${TOKEN}">`)
    // A card never hands out references, whatever the link allows.
    expect(res.body).not.toContain("uploads/ref.png")
    // Its own picture was asked for (and so its render started), by the link's token.
    expect(pictures.asked).toEqual([{ token: TOKEN, picture: { kind: "picture", source: "https://cdn.example/images/a1.png" } }])
  })

  it("once its own picture is rendered: that one, 1200 × 630 JPEG, and the full five minutes", async () => {
    share("job", JOB)
    db.jobs.push(jobRow())
    pictures.rendered.add(JSON.stringify({ kind: "picture", source: "https://cdn.example/images/a1.png" }))
    const res = await card()
    expect(res.headers["cache-control"]).toBe("public, max-age=300")
    expect(tags(res.body)).toMatchObject({
      "og:image": "https://cdn.example/share-cards/t/rendered.jpg",
      "og:image:secure_url": "https://cdn.example/share-cards/t/rendered.jpg",
      "og:image:type": "image/jpeg",
      "og:image:width": "1200",
      "og:image:height": "630",
      "twitter:image": "https://cdn.example/share-cards/t/rendered.jpg",
    })
  })

  it("a video: its poster, our video, and a play-badged frame to render", async () => {
    share("job", JOB)
    db.jobs.push(
      jobRow({
        input_data: { type: "image-to-video", userPrompt: "a red car driving" },
        output_data: { videoUrl: "https://cdn.example/videos/v.mp4", thumbnailUrl: "https://cdn.example/images/t.jpg", width: 1280, height: 720 },
      }),
    )
    const res = await card()
    expect(tags(res.body)).toMatchObject({
      "og:type": "video.other",
      "og:title": "a red car driving · Image to Video",
      "og:description": "A video made with Nodaro",
      "og:image": "https://cdn.example/images/t.jpg",
      "og:video": "https://cdn.example/videos/v.mp4",
      "og:video:secure_url": "https://cdn.example/videos/v.mp4",
      "og:video:type": "video/mp4",
      "og:video:width": "1280",
      "og:video:height": "720",
    })
    expect(pictures.asked[0]!.picture).toEqual({ kind: "video", poster: "https://cdn.example/images/t.jpg", video: "https://cdn.example/videos/v.mp4" })
  })

  it("a song: the song's own title and the tool; never the provider's art as the picture; our sound as og:audio", async () => {
    share("job", JOB)
    db.jobs.push(
      jobRow({
        input_data: { type: "suno-mashup", prompt: "blend these" },
        output_data: {
          audioUrl: "https://cdn.example/audios/s.mp3",
          sunoTitle: "Lady's on the Loose",
          sunoImageUrl: "https://musicfile.provider.example/c.jpeg",
          sunoTracks: [{ audioUrl: "https://cdn.example/audios/s.mp3", title: "Lady's on the Loose" }],
        },
      }),
    )
    const res = await card()
    const t = tags(res.body)
    expect(t).toMatchObject({
      "og:title": "Lady&#39;s on the Loose · Song Mashup",
      "twitter:title": "Lady&#39;s on the Loose · Song Mashup",
      "og:description": "A song made with Nodaro",
      "og:image": "https://app.example/share-card.jpg",
      "og:image:width": "1200",
      "og:image:height": "630",
      "og:image:type": "image/jpeg",
      "og:audio": "https://cdn.example/audios/s.mp3",
      "og:audio:type": "audio/mpeg",
    })
    expect(res.body).not.toContain("provider.example")
    expect(res.body).toContain("<title>Lady&#39;s on the Loose · Song Mashup — Nodaro</title>")
    // The art is drawn into the card's own picture, with the title.
    expect(pictures.asked[0]!.picture).toEqual({ kind: "sound", art: "https://musicfile.provider.example/c.jpeg", title: "Lady's on the Loose", work: "song" })
  })

  it("a speech take: its tool and a voice line; the speech's text is not drawn", async () => {
    share("job", JOB)
    db.jobs.push(jobRow({ input_data: { type: "text-to-speech", text: "Hello there, welcome to the show" }, output_data: { audioUrl: "https://cdn.example/audios/v.mp3" } }))
    const t = tags((await card()).body)
    expect(t).toMatchObject({
      "og:title": "Hello there, welcome to the show · Text to Speech",
      "og:description": "A voice recording made with Nodaro",
      "og:image": "https://app.example/share-card.jpg",
      "og:audio": "https://cdn.example/audios/v.mp3",
    })
    expect(pictures.asked[0]!.picture).toEqual({ kind: "sound", art: null, title: null, work: "speech" })
  })

  it("in the language the link was shared in", async () => {
    share("job", JOB, { locale: "he" })
    db.jobs.push(jobRow({ input_data: { type: "suno-generate", prompt: "lofi" }, output_data: { audioUrl: "https://cdn.example/audios/s.mp3", sunoTitle: "שיר" } }))
    const res = await card()
    expect(tags(res.body)).toMatchObject({ "og:title": "שיר · Song", "og:description": "שיר שנוצר עם Nodaro", "og:locale": "he_IL" })
    expect(res.body).toContain('<html lang="he" dir="rtl">')
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
    expect(tags(res.body)).toMatchObject({ "og:title": "Office Dance · Video Remake", "og:description": "Made with the Office Dance trend on Nodaro" })
    expect(res.body).not.toContain("platform's own wording")
  })

  it("a session and a project: their own title or name, and a grid of their first pictures", async () => {
    db.rpc.mockImplementation(async (_fn: string, args: unknown) => ({
      data: (args as { p_session_ids: string[] }).p_session_ids.map((id) => ({
        session_id: id,
        item_count: 2,
        recent: [
          { job_id: JOB, output_data: { imageUrl: "https://cdn.example/images/cover.png" } },
          { job_id: "j2", output_data: { imageUrl: "https://cdn.example/images/second.png" } },
        ],
      })),
      error: null,
    }))
    db.sessions.push({ id: SESSION, user_id: OWNER, project_id: PROJECT, workspace_id: null, archived_at: null, title: "Beach day", tool: "create-image", created_at: "x" })
    db.projects.push({ id: PROJECT, user_id: OWNER, workspace_id: null, name: "Holiday" })
    share("session", SESSION)
    expect(tags((await card()).body)).toMatchObject({
      "og:title": "Beach day",
      "og:description": "2 results made with Nodaro",
      "og:image": "https://cdn.example/images/cover.png",
    })
    expect(pictures.asked[0]!.picture).toEqual({ kind: "grid", sources: ["https://cdn.example/images/cover.png", "https://cdn.example/images/second.png"] })
    db.shares.length = 0
    share("project", PROJECT)
    expect(tags((await card()).body)).toMatchObject({ "og:title": "Holiday", "og:description": "1 session made with Nodaro", "og:image": "https://cdn.example/images/cover.png" })
  })

  it("every preview reader gets the same card, with its tags in the first bytes of the head", async () => {
    share("job", JOB)
    db.jobs.push(jobRow())
    for (const ua of ["WhatsApp/2.24 A", "facebookexternalhit/1.1", "TelegramBot (like TwitterBot)", "Twitterbot/1.0", "LinkedInBot/1.0", "Mozilla/5.0 (iPhone) AppleWebKit Safari"]) {
      const res = await app.inject({ method: "GET", url: `/og/s/${TOKEN}`, headers: { "user-agent": ua } })
      expect(res.statusCode, ua).toBe(200)
      const t = tags(res.body)
      expect(t["og:title"], ua).toBe("a red car on a beach · Image Generation")
      expect(t["og:image"], ua).toBe("https://cdn.example/images/a1.png")
      expect(t["twitter:card"], ua).toBe("summary_large_image")
      // Charset, title, then the Open Graph tags, within the first kilobyte.
      expect(res.body.indexOf('property="og:image"'), ua).toBeLessThan(1024)
      expect(res.body.indexOf("<meta charset")).toBeLessThan(res.body.indexOf("<title>"))
    }
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

  it("404s, saying nothing and rendering nothing, every link of a blocked account", async () => {
    share("job", JOB)
    db.jobs.push(jobRow())
    gates.blocked.add(OWNER)
    const res = await card()
    expect(res.statusCode).toBe(404)
    expect(res.headers["cache-control"]).toBe("no-store")
    expect(res.body).not.toMatch(/og:|twitter:|red car/)
    expect(pictures.asked).toEqual([])
  })

  it("404s every card where public work is not allowed", async () => {
    share("job", JOB)
    db.jobs.push(jobRow())
    gates.publicOutputs = false
    expect((await card()).statusCode).toBe(404)
  })
})
