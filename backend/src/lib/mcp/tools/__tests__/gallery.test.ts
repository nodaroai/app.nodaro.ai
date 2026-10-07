import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool, listTools } from "./_helpers.js"

vi.mock("../../../supabase.js", () => ({
  supabase: { from: vi.fn() },
}))

const { registerGallery } = await import("../gallery.js")
const { supabase } = await import("../../../supabase.js")

beforeEach(() => {
  vi.clearAllMocks()
})

function readSession() {
  return newSession({
    userId: "u1",
    scopes: ["assets:read"] as Scope[],
    clientName: "Claude",
  })
}

function writeSession() {
  return newSession({
    userId: "u1",
    scopes: ["assets:write"] as Scope[],
    clientName: "Claude",
  })
}

// The by-id tools guard the uuid PK before querying (see _id-guard.ts), so
// tool inputs must be UUID-shaped. The chain-agnostic mocks ignore the value,
// so these constants stand in for any id; assertions still key off the mock
// rows' own ids.
const JOB_UUID = "11111111-1111-4111-8111-111111111111"
const JOB_UUID_2 = "22222222-2222-4222-8222-222222222222"

/**
 * Chain-agnostic supabase mock: returns a Proxy that pretends every
 * method (select / eq / neq / not / in / order / limit / lt / ilike /
 * etc.) is itself a chainable noop, AND is also a thenable resolving
 * to `{ data, error: null }` when `await`-ed at any point. Lets handler
 * code reorder its query chain without breaking tests.
 */
function makeChainable(rows: unknown[], selects?: string[]) {
  const result = { data: rows, error: null }
  let chain: unknown
  const promise: Promise<typeof result> = Promise.resolve(result)
  // eslint-disable-next-line prefer-const
  chain = new Proxy(function () {}, {
    get(_target, prop) {
      if (prop === "then") return promise.then.bind(promise)
      if (prop === "catch") return promise.catch.bind(promise)
      if (prop === "finally") return promise.finally.bind(promise)
      // Optionally record what was SELECTed. The rows a test hands back are
      // fixtures, so a handler that reads a column it never asked for still
      // "works" here while returning undefined in production.
      if (prop === "select" && selects) {
        return (...args: unknown[]) => {
          if (typeof args[0] === "string") selects.push(args[0])
          return chain
        }
      }
      return () => chain
    },
    apply() {
      return chain
    },
  })
  return chain
}

describe("browse_gallery tool", () => {
  it("formats rows as one line per item with cursor footer", async () => {
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      makeChainable([
        {
          id: "g1",
          job_type: "generate-image",
          input_data: { prompt: "knight", provider: "nano-banana" },
          output_data: { imageUrl: "https://r2/x.png" },
          completed_at: "2026-04-29T12:00:00Z",
          created_at: "2026-04-29T12:00:00Z",
          provider: "nano-banana",
          status: "completed",
        },
      ]),
    )
    const server = buildServer()
    registerGallery({ server, session: readSession(), fastify: Fastify() })
    const result = await callTool(server, "browse_gallery", { limit: 1 })
    expect(result.isError).toBeUndefined()
    expect(result.content[0]?.text).toContain("g1: image")
    expect(result.content[0]?.text).toContain("nano-banana")
    expect(result.content[0]?.text).toContain("2026-04-29")
    // Per MCP Apps: text + structuredContent (iframe template at
    // ui://nodaro/widget/gallery consumes the items array).
    expect(result.content.length).toBe(1)
    const sc = (result as { structuredContent?: Record<string, unknown> }).structuredContent
    expect(Array.isArray(sc?.items)).toBe(true)
  })

  it("never hands over another user's input references", async () => {
    // The prompt and the finished picture are what "public" means. The
    // `references` are the INPUTS — the photo that person uploaded to make it,
    // never published, reachable only because the job row carries it.
    const SECRET = "https://r2/private-source-photo.png"
    const selects: string[] = []
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      makeChainable(
        [
        {
          id: "mine",
          user_id: "u1",
          job_type: "generate-image",
          input_data: { prompt: "mine", image_url: SECRET },
          output_data: { imageUrl: "https://r2/mine.png" },
          completed_at: "2026-04-29T12:00:00Z",
          created_at: "2026-04-29T12:00:00Z",
          provider: "nano-banana",
          status: "completed",
        },
        {
          id: "theirs",
          user_id: "someone-else",
          job_type: "generate-image",
          input_data: { prompt: "theirs", image_url: SECRET },
          output_data: { imageUrl: "https://r2/theirs.png" },
          completed_at: "2026-04-29T12:00:00Z",
          created_at: "2026-04-29T12:00:00Z",
          provider: "nano-banana",
          status: "completed",
        },
        ],
        selects,
      ),
    )
    const server = buildServer()
    registerGallery({ server, session: readSession(), fastify: Fastify() })
    const result = await callTool(server, "browse_gallery", { scope: "public", limit: 2 })

    // The rule is per-row, so the row has to carry its owner. Ask for the
    // column or every reference silently becomes nobody's, including the
    // caller's own.
    expect(selects.join(" | ")).toContain("user_id")

    const items = (result as { structuredContent?: { items?: { jobId: string; references?: string[] }[] } })
      .structuredContent?.items
    expect(items?.find((i) => i.jobId === "mine")?.references).toEqual([SECRET])
    expect(items?.find((i) => i.jobId === "theirs")?.references).toEqual([])
    // And nowhere else in the payload either.
    expect(JSON.stringify(items?.find((i) => i.jobId === "theirs"))).not.toContain(SECRET)
  })

  it("does NOT register without assets:read scope", async () => {
    const server = buildServer()
    registerGallery({
      server,
      session: newSession({
        userId: "u1",
        scopes: [] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("browse_gallery")
  })
})

describe("browse_uploads tool", () => {
  it("returns uploaded assets mapped into the gallery widget shape", async () => {
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      makeChainable([
        {
          id: "asset-1",
          type: "image",
          filename: "cat.jpg",
          mime_type: "image/jpeg",
          size_bytes: 1234,
          r2_url: "https://cdn/cat.jpg",
          metadata: { thumbnail_url: "https://cdn/thumb-cat.jpg" },
          created_at: "2026-05-04T10:00:00Z",
        },
      ]),
    )
    const server = buildServer()
    registerGallery({ server, session: readSession(), fastify: Fastify() })
    const result = await callTool(server, "browse_uploads", { limit: 10 })
    expect(result.isError).toBeUndefined()
    const sc = (result as { structuredContent?: Record<string, unknown> }).structuredContent
    expect(Array.isArray(sc?.items)).toBe(true)
    const items = sc?.items as Array<Record<string, unknown>>
    expect(items[0]?.jobId).toBe("asset-1")
    expect(items[0]?.kind).toBe("image")
    expect(items[0]?.assetUrl).toBe("https://cdn/cat.jpg")
    expect(items[0]?.thumbnailUrl).toBe("https://cdn/thumb-cat.jpg")
    expect(sc?.loadMoreTool).toBe("browse_uploads")
  })

  it("labels a render made at proxy quality as a Preview (A1b), from the asset's own record", async () => {
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      makeChainable([
        { id: "a-prev", type: "video", filename: "cut.mp4", mime_type: "video/mp4", size_bytes: 1, r2_url: "https://cdn/cut.mp4", metadata: { thumbnail_url: "https://cdn/t.jpg", quality: "proxy" }, created_at: "2026-10-05T10:00:00Z" },
        { id: "a-final", type: "video", filename: "final.mp4", mime_type: "video/mp4", size_bytes: 1, r2_url: "https://cdn/final.mp4", metadata: { quality: "final" }, created_at: "2026-10-05T09:00:00Z" },
      ]),
    )
    const server = buildServer()
    registerGallery({ server, session: readSession(), fastify: Fastify() })
    const result = await callTool(server, "browse_uploads", { limit: 10 })
    const items = (result as { structuredContent?: { items?: Array<Record<string, unknown>> } }).structuredContent?.items ?? []
    expect(items[0]?.preview).toBe(true)
    expect(items[1]?.preview).toBeUndefined()
    expect(result.content[0]?.text).toContain("- video (preview) a-prev")
    expect(result.content[0]?.text).toContain("- video a-final")
  })

  describe("a render recorded before its label was stored (decided 2026-10-05)", () => {
    function seedTables(assets: unknown[], jobs: unknown[]) {
      const jobSelects: string[] = []
      ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
        if (table === "jobs") return makeChainable(jobs, jobSelects)
        return makeChainable(assets)
      })
      return jobSelects
    }
    const upload = (over: Record<string, unknown>) => ({
      id: "a", type: "video", filename: "cut.mp4", mime_type: "video/mp4", size_bytes: 1, r2_url: "https://cdn/cut.mp4",
      metadata: { thumbnail_url: "https://cdn/t.jpg" }, created_at: "2026-10-05T10:00:00Z", job_id: "j1", ...over,
    })

    it("takes the label from the job that made the file, with one lookup", async () => {
      const jobSelects = seedTables(
        [upload({ id: "a-old", job_id: "j1" }), upload({ id: "a-old-final", job_id: "j2" })],
        [
          { id: "j1", job_type: "apply-edl", input_quality: "proxy", out_quality: null },
          { id: "j2", job_type: "apply-edl", input_quality: "final", out_quality: null },
        ],
      )
      const server = buildServer()
      registerGallery({ server, session: readSession(), fastify: Fastify() })
      const result = await callTool(server, "browse_uploads", { limit: 10 })
      const items = (result as { structuredContent?: { items?: Array<Record<string, unknown>> } }).structuredContent?.items ?? []
      expect(items[0]?.preview).toBe(true)
      expect(items[1]?.preview).toBeUndefined()
      expect(result.content[0]?.text).toContain("- video (preview) a-old")
      expect(jobSelects).toHaveLength(1)
    })

    it("makes no jobs lookup when every file carries its label", async () => {
      const jobSelects = seedTables(
        [upload({ id: "a1", metadata: { quality: "proxy" } }), upload({ id: "a2", metadata: { quality: "final" } })],
        [],
      )
      const server = buildServer()
      registerGallery({ server, session: readSession(), fastify: Fastify() })
      await callTool(server, "browse_uploads", { limit: 10 })
      expect(jobSelects).toHaveLength(0)
    })
  })

  it("hands a loadMoreTool hint to the gallery widget", async () => {
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      makeChainable([]),
    )
    const server = buildServer()
    registerGallery({ server, session: readSession(), fastify: Fastify() })
    const result = await callTool(server, "browse_uploads", { kind: "image" })
    const sc = (result as { structuredContent?: Record<string, unknown> }).structuredContent
    expect(sc?.loadMoreTool).toBe("browse_uploads")
  })
})

describe("list_favorites tool", () => {
  it("returns favorited job_ids", async () => {
    // Two from() calls: first hits gallery_favorites, second hydrates jobs.
    const favoritesChain = {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: [
                { job_id: "f1", created_at: "2026-04-29T12:00:00Z" },
                { job_id: "f2", created_at: "2026-04-29T11:00:00Z" },
              ],
              error: null,
            }),
          }),
        }),
      }),
    }
    const jobsChain = {
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          // #4: hydration now applies a visibility .or() filter before resolving.
          or: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }),
    }
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(favoritesChain)
      .mockReturnValueOnce(jobsChain)
    const server = buildServer()
    registerGallery({ server, session: readSession(), fastify: Fastify() })
    const result = await callTool(server, "list_favorites", {})
    expect(result.isError).toBeUndefined()
    expect(result.content[0]?.text).toContain("\"f1\"")
    expect(result.content[0]?.text).toContain("\"f2\"")
  })

  it("does NOT register without assets:read scope", async () => {
    const server = buildServer()
    registerGallery({
      server,
      session: newSession({
        userId: "u1",
        scopes: [] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("list_favorites")
  })
})

/**
 * Chain-agnostic supabase mock used for `get_asset`. The query chain is
 * `.from().select().eq().or().maybeSingle()` — refactor-friendly to use
 * the same Proxy pattern as `browse_gallery` so adding/reordering filters
 * doesn't break tests. `maybeSingle()` resolves to `{data: rows[0]|null, error: null}`.
 */
function makeChainableSingle(row: unknown) {
  const result = { data: row, error: null }
  let chain: unknown
  const promise: Promise<typeof result> = Promise.resolve(result)
  // eslint-disable-next-line prefer-const
  chain = new Proxy(function () {}, {
    get(_target, prop) {
      if (prop === "then") return promise.then.bind(promise)
      if (prop === "catch") return promise.catch.bind(promise)
      if (prop === "finally") return promise.finally.bind(promise)
      if (prop === "maybeSingle") return () => promise
      return () => chain
    },
    apply() {
      return chain
    },
  })
  return chain
}

describe("get_asset tool", () => {
  it("returns asset data when owned", async () => {
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      makeChainableSingle({
        id: "g1",
        user_id: "u1",
        status: "completed",
        output_data: { imageUrl: "https://r2/x.png" },
      }),
    )
    const server = buildServer()
    registerGallery({ server, session: readSession(), fastify: Fastify() })
    const result = await callTool(server, "get_asset", { job_id: JOB_UUID })
    expect(result.isError).toBeUndefined()
    expect(result.content[0]?.text).toContain("\"g1\"")
  })

  it("returns asset when owned by another user but public + completed", async () => {
    // Visibility now mirrors browse_gallery: any user's public-completed
    // job is fetchable. Caller is u1; row's user_id is u2.
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      makeChainableSingle({
        id: "pub1",
        user_id: "u2",
        status: "completed",
        is_public: true,
        output_data: { imageUrl: "https://r2/pub.png" },
      }),
    )
    const server = buildServer()
    registerGallery({ server, session: readSession(), fastify: Fastify() })
    const result = await callTool(server, "get_asset", { job_id: JOB_UUID })
    expect(result.isError).toBeUndefined()
    expect(result.content[0]?.text).toContain("\"pub1\"")
    const sc = (result as { structuredContent?: Record<string, unknown> })
      .structuredContent
    expect(sc?.outputUrl).toBe("https://r2/pub.png")
  })

  /**
   * The widget polls `get_asset` every 2 s and renders from
   * `structuredContent`. A held job (spec §6.4) fell into the plain read
   * branch: status `pending_review`, `outputUrl: null`, no explanation — an
   * empty preview forever, and a model that re-runs the request.
   */
  it("explains a held asset instead of returning an empty preview forever", async () => {
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      makeChainableSingle({
        id: "held1",
        user_id: "u1",
        status: "pending_review",
        job_type: "generate-image",
        // NULL by contract on a held row (D6).
        output_data: null,
        error_message: null,
        progress: 100,
      }),
    )
    const server = buildServer()
    registerGallery({ server, session: readSession(), fastify: Fastify() })

    const result = await callTool(server, "get_asset", { job_id: JOB_UUID })
    expect(result.isError).toBeUndefined()
    const sc = (result as { structuredContent?: Record<string, unknown> }).structuredContent
    expect(sc?.status).toBe("pending_review")
    expect(sc?.outputUrl).toBeNull()
    expect(sc?.retryable).toBe(false)
    expect(result.content[0]?.text).toMatch(/review/i)
    expect(result.content[0]?.text).toMatch(/do NOT re-run/i)
  })

  it("redacts private remux bases from text and structured output", async () => {
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      makeChainableSingle({
        id: "video1",
        user_id: "u1",
        status: "completed",
        job_type: "generate-video-pro",
        input_data: { unscoredUrl: "https://private.example/input.mp4" },
        output_data: {
          videoUrl: "https://public.example/final.mp4",
          pro: { unscoredUrl: "https://private.example/base.mp4" },
        },
      }),
    )
    const server = buildServer()
    registerGallery({ server, session: readSession(), fastify: Fastify() })

    const result = await callTool(server, "get_asset", { job_id: JOB_UUID })
    const serialized = JSON.stringify(result)

    expect(serialized).toContain("https://public.example/final.mp4")
    expect(serialized).not.toContain("unscoredUrl")
    expect(serialized).not.toContain("private.example")
  })

  it("returns isError when not found", async () => {
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      makeChainableSingle(null),
    )
    const server = buildServer()
    registerGallery({ server, session: readSession(), fastify: Fastify() })
    const result = await callTool(server, "get_asset", { job_id: JOB_UUID })
    expect(result.isError).toBe(true)
  })

  it("returns a clean not-found for a non-UUID id (no raw uuid-cast error)", async () => {
    const server = buildServer()
    registerGallery({ server, session: readSession(), fastify: Fastify() })
    const result = await callTool(server, "get_asset", { job_id: "not-a-uuid" })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).not.toMatch(/invalid input syntax/)
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it("surfaces the failure reason + retryable=false for a content-policy failure", async () => {
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      makeChainableSingle({
        id: "failed1",
        user_id: "u1",
        status: "failed",
        job_type: "generate-image",
        output_data: {},
        error_message:
          "Content policy violation: The output was blocked by the provider's safety filter. Try modifying your prompt or input image.",
      }),
    )
    const server = buildServer()
    registerGallery({ server, session: readSession(), fastify: Fastify() })
    const result = await callTool(server, "get_asset", { job_id: JOB_UUID })
    expect(result.isError).toBeUndefined()
    // The model reads content text — it must state the reason and that
    // re-running is pointless, so it stops retrying a permanent block.
    expect(result.content[0]?.text).toMatch(/Content policy violation/)
    expect(result.content[0]?.text).toMatch(/do NOT retry/)
    const sc = (result as { structuredContent?: Record<string, unknown> })
      .structuredContent
    expect(sc?.status).toBe("failed")
    expect(sc?.retryable).toBe(false)
    expect(sc?.errorMessage).toMatch(/safety filter/)
  })

  it("PR9: offers suggestedProvider + retry guidance for a safety-block hint with a catalog fallback", async () => {
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      makeChainableSingle({
        id: "failed-safety",
        user_id: "u1",
        status: "failed",
        job_type: "generate-image",
        output_data: {},
        error_message: "The provider's safety filter blocked this output.",
        error_hint: { kind: "safety-block", class: "safety", retried: true, suggestedProvider: "nano-banana-pro" },
      }),
    )
    const server = buildServer()
    registerGallery({ server, session: readSession(), fastify: Fastify() })
    const result = await callTool(server, "get_asset", { job_id: JOB_UUID })
    expect(result.isError).toBeUndefined()
    expect(result.content[0]?.text).toMatch(/retry the SAME/)
    expect(result.content[0]?.text).toContain("nano-banana-pro")
    const sc = (result as { structuredContent?: Record<string, unknown> }).structuredContent
    expect(sc?.retryable).toBe(false)
    expect(sc?.suggestedProvider).toBe("nano-banana-pro")
  })

  it("PR9: omits suggestedProvider for a safety-block hint with no catalog fallback", async () => {
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      makeChainableSingle({
        id: "failed-copyright",
        user_id: "u1",
        status: "failed",
        job_type: "generate-image",
        output_data: {},
        error_message: "Blocked for copyright: the provider refused this generation.",
        error_hint: { kind: "safety-block", class: "copyright", retried: false },
      }),
    )
    const server = buildServer()
    registerGallery({ server, session: readSession(), fastify: Fastify() })
    const result = await callTool(server, "get_asset", { job_id: JOB_UUID })
    expect(result.isError).toBeUndefined()
    expect(result.content[0]?.text).toMatch(/change the prompt or the input image/)
    const sc = (result as { structuredContent?: Record<string, unknown> }).structuredContent
    expect(sc?.retryable).toBe(false)
    expect(sc).not.toHaveProperty("suggestedProvider")
  })

  it("marks a transient failure retryable", async () => {
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      makeChainableSingle({
        id: "failed2",
        user_id: "u1",
        status: "failed",
        job_type: "image-to-video",
        output_data: {},
        error_message: "Generation failed. Please try again or contact support.",
      }),
    )
    const server = buildServer()
    registerGallery({ server, session: readSession(), fastify: Fastify() })
    const result = await callTool(server, "get_asset", { job_id: JOB_UUID })
    const sc = (result as { structuredContent?: Record<string, unknown> })
      .structuredContent
    expect(sc?.retryable).toBe(true)
  })
})

describe("display_asset tool", () => {
  it("returns image widget content for an image asset (own)", async () => {
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      makeChainableSingle({
        id: "img1",
        user_id: "u1",
        status: "completed",
        job_type: "generate-image",
        input_data: {
          prompt: "a knight",
          provider: "nano-banana-pro",
          aspect_ratio: "16:9",
          resolution: "2K",
        },
        output_data: { imageUrl: "https://r2/img1.png" },
      }),
    )
    const server = buildServer()
    registerGallery({ server, session: readSession(), fastify: Fastify() })
    const result = await callTool(server, "display_asset", { job_id: JOB_UUID })
    expect(result.isError).toBeUndefined()
    const sc = (result as { structuredContent?: Record<string, unknown> })
      .structuredContent
    expect(sc?.jobId).toBe("img1")
    expect(sc?.outputUrl).toBe("https://r2/img1.png")
    expect(sc?.assetKind).toBe("image")
    expect(sc?.model).toBe("nano-banana-pro")
    expect(sc?.aspectRatio).toBe("16:9")
    // Images opt into the widget's Animate / Edit / Recreate follow-ups.
    expect(sc?.imageActions).toBe(true)
  })

  it("renders a video asset through the widget (no image-only text fallback)", async () => {
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      makeChainableSingle({
        id: "vid1",
        user_id: "u1",
        status: "completed",
        job_type: "image-to-video",
        input_data: { prompt: "knight on horse" },
        output_data: { videoUrl: "https://r2/vid1.mp4" },
      }),
    )
    const server = buildServer()
    registerGallery({ server, session: readSession(), fastify: Fastify() })
    const result = await callTool(server, "display_asset", { job_id: JOB_UUID })
    expect(result.isError).toBeUndefined()
    // Video now returns widget structuredContent (job-auto renders <video>),
    // not the old "image-only right now" text punt.
    const sc = (result as { structuredContent?: Record<string, unknown> })
      .structuredContent
    expect(sc?.jobId).toBe("vid1")
    expect(sc?.outputUrl).toBe("https://r2/vid1.mp4")
    expect(sc?.assetKind).toBe("video")
    // Image-only follow-ups are NOT offered for video.
    expect(sc?.imageActions).toBe(false)
    // Text content still carries the direct URL for non-widget hosts.
    expect(result.content[0]?.text).toContain("https://r2/vid1.mp4")
  })

  it("renders an audio asset through the widget", async () => {
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      makeChainableSingle({
        id: "aud1",
        user_id: "u1",
        status: "completed",
        job_type: "text-to-speech",
        input_data: { prompt: "hello there" },
        output_data: { audioUrl: "https://r2/aud1.mp3" },
      }),
    )
    const server = buildServer()
    registerGallery({ server, session: readSession(), fastify: Fastify() })
    const result = await callTool(server, "display_asset", { job_id: JOB_UUID })
    expect(result.isError).toBeUndefined()
    const sc = (result as { structuredContent?: Record<string, unknown> })
      .structuredContent
    expect(sc?.outputUrl).toBe("https://r2/aud1.mp3")
    expect(sc?.assetKind).toBe("audio")
    expect(sc?.imageActions).toBe(false)
  })

  it("returns asset owned by another user when public + completed", async () => {
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      makeChainableSingle({
        id: "pub1",
        user_id: "u2",
        status: "completed",
        is_public: true,
        job_type: "generate-image",
        input_data: { prompt: "shared", provider: "flux" },
        output_data: { imageUrl: "https://r2/pub1.png" },
      }),
    )
    const server = buildServer()
    registerGallery({ server, session: readSession(), fastify: Fastify() })
    const result = await callTool(server, "display_asset", { job_id: JOB_UUID })
    expect(result.isError).toBeUndefined()
    const sc = (result as { structuredContent?: Record<string, unknown> })
      .structuredContent
    expect(sc?.outputUrl).toBe("https://r2/pub1.png")
  })

  it("returns isError when asset has no output URL yet", async () => {
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      makeChainableSingle({
        id: "pending1",
        user_id: "u1",
        status: "processing",
        job_type: "generate-image",
        input_data: { prompt: "a knight" },
        output_data: {},
      }),
    )
    const server = buildServer()
    registerGallery({ server, session: readSession(), fastify: Fastify() })
    const result = await callTool(server, "display_asset", { job_id: JOB_UUID })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toMatch(/not viewable/)
  })

  it("returns isError when asset not found", async () => {
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      makeChainableSingle(null),
    )
    const server = buildServer()
    registerGallery({ server, session: readSession(), fastify: Fastify() })
    const result = await callTool(server, "display_asset", { job_id: JOB_UUID })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toMatch(/not found/)
  })

  it("returns a clean not-found for a non-UUID id (no raw uuid-cast error)", async () => {
    const server = buildServer()
    registerGallery({ server, session: readSession(), fastify: Fastify() })
    const result = await callTool(server, "display_asset", { job_id: "not-a-uuid" })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).not.toMatch(/invalid input syntax/)
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it("does NOT register without assets:read scope", async () => {
    const server = buildServer()
    registerGallery({
      server,
      session: newSession({
        userId: "u1",
        scopes: [] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("display_asset")
  })
})

describe("get_app_run tool", () => {
  it("returns a clean not-found for a non-UUID execution_id (no raw uuid-cast error)", async () => {
    const server = buildServer()
    registerGallery({ server, session: readSession(), fastify: Fastify() })
    const result = await callTool(server, "get_app_run", {
      execution_id: "not-a-uuid",
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).not.toMatch(/invalid input syntax/)
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it("reads the whole run: outcome, every node's text / media / skip reason, the labels from the workflow, and the output URLs", async () => {
    const execution = {
      id: JOB_UUID,
      status: "completed",
      workflow_id: JOB_UUID_2,
      error_message: null,
      user_id: "u1",
      node_states: {
        feed: { status: "completed", nodeType: "telegram-channel-feed", output: { text: "" } },
        llm: { status: "skipped", nodeType: "llm-chat", skipReason: "empty_input" },
        img: { status: "completed", nodeType: "generate-image", jobId: "job-img", output: { imageUrl: "https://cdn.test/a.png", imageUrls: ["https://cdn.test/a.png", "https://cdn.test/b.png"] } },
      },
    }
    const workflow = { nodes: [{ id: "feed", type: "telegram-channel-feed", data: { label: "Tech news" } }, { id: "llm", type: "llm-chat", data: { label: "Writer" } }, { id: "img", type: "generate-image", data: { label: "Cover" } }] }
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(makeChainableSingle(execution))
      .mockReturnValueOnce(makeChainableSingle(workflow))
      .mockReturnValueOnce(makeChainable([{ id: "job-img", input_data: { prompt: "a cover", provider: "gpt-image-2" }, provider: "gpt-image-2", completed_at: "2026-10-06T10:00:00Z", created_at: "2026-10-06T09:59:00Z" }]))
    const server = buildServer()
    registerGallery({ server, session: readSession(), fastify: Fastify() })
    const result = await callTool(server, "get_app_run", { execution_id: JOB_UUID })
    expect(result.isError).toBeUndefined()
    const sc = result.structuredContent as {
      status: string
      outcome?: string
      errorMessage: string | null
      summary: { total: number; completed: number; skipped: number; skippedForEmptyInput: number }
      nodeStates: Array<{ id: string; label?: string; status: string; skipReason?: string; media?: Array<{ kind: string; url: string }> }>
      outputs: Array<{ kind: string; url: string; prompt?: string; model?: string }>
    }
    expect(sc.status).toBe("completed")
    expect(sc.outcome).toBe("nothing_new")
    expect(sc.errorMessage).toBeNull()
    expect(sc.summary).toMatchObject({ total: 3, completed: 2, skipped: 1, skippedForEmptyInput: 1 })
    expect(sc.nodeStates.map((n) => [n.id, n.label, n.status])).toEqual([
      ["feed", "Tech news", "completed"],
      ["llm", "Writer", "skipped"],
      ["img", "Cover", "completed"],
    ])
    expect(sc.nodeStates[1]?.skipReason).toBe("empty_input")
    expect(sc.nodeStates[2]?.media).toEqual([
      { kind: "image", url: "https://cdn.test/a.png" },
      { kind: "image", url: "https://cdn.test/b.png" },
    ])
    // Every media URL is an output, enriched from its job.
    expect(sc.outputs.map((o) => o.url)).toEqual(["https://cdn.test/a.png", "https://cdn.test/b.png"])
    expect(sc.outputs[0]).toMatchObject({ kind: "image", prompt: "a cover", model: "gpt-image-2" })
    // The text reply carries the same reading.
    expect(result.content[0]?.text).toContain('"outcome": "nothing_new"')
  })

  it("attacker: a node_states jobId naming another user's job adds none of its prompt or model", async () => {
    // node_states was client-writable before 474, so a jobId in it is a
    // pointer: the enrichment reads the caller's own jobs only.
    const execution = {
      id: JOB_UUID,
      status: "completed",
      workflow_id: JOB_UUID_2,
      created_at: "2026-10-06T09:00:00Z",
      completed_at: "2026-10-06T10:00:00Z",
      error_message: null,
      user_id: "u1",
      node_states: {
        img: { status: "completed", nodeType: "generate-image", jobId: "job-planted", output: { imageUrl: "https://cdn.test/mine.png" } },
      },
    }
    const jobFilters: Array<Record<string, unknown>> = []
    const victimJob = { id: "job-planted", user_id: "victim", input_data: { prompt: "victim's private prompt" }, provider: "victim-model", completed_at: "2026-10-01T10:00:00Z", created_at: "2026-10-01T09:00:00Z" }
    const jobsChain = () => {
      const filters: Record<string, unknown> = {}
      const q: Record<string, unknown> = {}
      q.select = () => q
      q.in = () => q
      q.eq = (col: string, v: unknown) => { filters[col] = v; return q }
      q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
        jobFilters.push({ ...filters })
        const rows = [victimJob].filter((r) => filters.user_id === undefined || r.user_id === filters.user_id)
        return Promise.resolve({ data: rows, error: null }).then(res, rej)
      }
      return q
    }
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockImplementation((table: string) =>
      table === "jobs" ? jobsChain() : makeChainableSingle(table === "workflow_executions" ? execution : null))
    const server = buildServer()
    registerGallery({ server, session: readSession(), fastify: Fastify() })
    const result = await callTool(server, "get_app_run", { execution_id: JOB_UUID })
    expect(result.isError).toBeUndefined()
    expect(jobFilters).toEqual([{ user_id: "u1" }])
    const sc = result.structuredContent as { outputs: Array<{ url: string; prompt?: string; model?: string }> }
    expect(sc.outputs.map((o) => o.url)).toEqual(["https://cdn.test/mine.png"])
    expect(sc.outputs[0]?.prompt).toBeUndefined()
    expect(sc.outputs[0]?.model).toBeUndefined()
    expect(JSON.stringify(result)).not.toContain("victim")
  })
})

describe("favorite_asset tool", () => {
  it("inserts a favorite when favorited=true", async () => {
    const insertMock = vi.fn().mockResolvedValue({ error: null })
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>)
      // #4: favorite_asset now first verifies the job is visible to the caller
      // (own, or public+completed) before inserting.
      .mockReturnValueOnce(makeChainableSingle({ id: "g1" }))
      .mockReturnValueOnce({ insert: insertMock })
    const server = buildServer()
    registerGallery({ server, session: writeSession(), fastify: Fastify() })
    const result = await callTool(server, "favorite_asset", {
      job_id: JOB_UUID,
      favorited: true,
    })
    expect(result.isError).toBeUndefined()
    expect(insertMock).toHaveBeenCalledWith({
      user_id: "u1",
      job_id: JOB_UUID,
    })
  })

  it("rejects favoriting a job the caller cannot see (cross-tenant guard)", async () => {
    // Visibility check returns null → the job is neither owned nor public.
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      makeChainableSingle(null),
    )
    const server = buildServer()
    registerGallery({ server, session: writeSession(), fastify: Fastify() })
    const result = await callTool(server, "favorite_asset", {
      job_id: JOB_UUID_2,
      favorited: true,
    })
    expect(result.isError).toBe(true)
  })

  it("deletes a favorite when favorited=false", async () => {
    const eqMock2 = vi.fn().mockResolvedValue({ error: null })
    const eqMock1 = vi.fn().mockReturnValue({ eq: eqMock2 })
    const deleteMock = vi.fn().mockReturnValue({ eq: eqMock1 })
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      delete: deleteMock,
    })
    const server = buildServer()
    registerGallery({ server, session: writeSession(), fastify: Fastify() })
    const result = await callTool(server, "favorite_asset", {
      job_id: JOB_UUID,
      favorited: false,
    })
    expect(result.isError).toBeUndefined()
    expect(deleteMock).toHaveBeenCalled()
  })

  it("returns a clean not-found for a non-UUID id (no raw uuid-cast error)", async () => {
    const server = buildServer()
    registerGallery({ server, session: writeSession(), fastify: Fastify() })
    const result = await callTool(server, "favorite_asset", {
      job_id: "not-a-uuid",
      favorited: true,
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).not.toMatch(/invalid input syntax/)
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it("does NOT register without assets:write scope", async () => {
    const server = buildServer()
    registerGallery({
      server,
      session: newSession({
        userId: "u1",
        scopes: ["assets:read"] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("favorite_asset")
  })
})

// ── The Preview label on an old render (round 2 review, decided 2026-10-06) ──
// get_asset and display_asset read the same job get_job reads, so they must
// agree about it: the label an old render lacks is filled from the order, and a
// Preview is marked `preview: true`.
describe("get_asset and display_asset agree with get_job about a Preview render", () => {
  const render = (over: Record<string, unknown> = {}) => ({
    id: "edl1",
    user_id: "u1",
    status: "completed",
    job_type: "apply-edl",
    progress: 100,
    input_data: { quality: "proxy" },
    output_data: { videoUrl: "https://r2/cut.mp4" },
    error_message: null,
    ...over,
  })
  const use = (row: unknown) =>
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(makeChainableSingle(row))

  it("get_asset: an old render ordered at proxy reads back as a Preview, label filled in the text and the envelope", async () => {
    use(render())
    const server = buildServer()
    registerGallery({ server, session: readSession(), fastify: Fastify() })
    const result = await callTool(server, "get_asset", { job_id: JOB_UUID })
    const sc = (result as { structuredContent?: { outputData?: Record<string, unknown>; preview?: boolean } }).structuredContent
    expect(sc?.outputData?.quality).toBe("proxy")
    expect(sc?.preview).toBe(true)
    const text = JSON.parse(result.content[0]?.text as string) as { data: { output_data: Record<string, unknown> } }
    expect(text.data.output_data.quality).toBe("proxy")
  })

  it("get_asset: the final is labelled final and never a Preview; a stored label wins; another job type is left alone", async () => {
    const server = buildServer()
    registerGallery({ server, session: readSession(), fastify: Fastify() })
    type Sc = { outputData?: Record<string, unknown>; preview?: boolean }
    const read = async () =>
      ((await callTool(server, "get_asset", { job_id: JOB_UUID })) as { structuredContent?: Sc }).structuredContent

    use(render({ input_data: { quality: "final" } }))
    const final = await read()
    expect(final?.outputData?.quality).toBe("final")
    expect(final?.preview).toBeUndefined()

    use(render({ input_data: { quality: "final" }, output_data: { videoUrl: "https://r2/cut.mp4", quality: "proxy" } }))
    expect((await read())?.preview).toBe(true)

    use(render({ job_type: "generate-video" }))
    const other = await read()
    expect(other?.outputData).not.toHaveProperty("quality")
    expect(other?.preview).toBeUndefined()
  })

  it("get_asset declares `preview` in its outputSchema", async () => {
    const server = buildServer()
    registerGallery({ server, session: readSession(), fastify: Fastify() })
    const tool = (await listTools(server)).find((t) => t.name === "get_asset")
    const schema = (tool as { outputSchema?: { properties?: Record<string, unknown> } } | undefined)?.outputSchema
    expect(schema?.properties).toHaveProperty("preview")
  })

  it("display_asset: an old render ordered at proxy is marked a Preview; the final and other jobs are not", async () => {
    const server = buildServer()
    registerGallery({ server, session: readSession(), fastify: Fastify() })
    const show = async (row: unknown) => {
      use(row)
      return ((await callTool(server, "display_asset", { job_id: JOB_UUID })) as { structuredContent?: { preview?: boolean } }).structuredContent
    }
    expect((await show(render()))?.preview).toBe(true)
    expect((await show(render({ input_data: { quality: "final" } })))?.preview).toBeUndefined()
    expect((await show(render({ job_type: "generate-video" })))?.preview).toBeUndefined()
  })
})

// ── Apply EDL renders in the owner's own gallery views (round 3, decided 2026-10-06) ──
// browse_gallery scope=mine and list_favorites list a render (a Preview marked);
// the public scope never does — a Preview is private and a public final would be
// exposure nobody decided. A render's kind is its output's medium, per job.
describe("Apply EDL renders in the gallery tools", () => {
  interface Call { method: string; args: unknown[] }

  /** Like makeChainable, but records every call so a test can say what was asked for. */
  function recording(rows: unknown[]) {
    const calls: Call[] = []
    const result = { data: rows, error: null, count: rows.length }
    const chain: unknown = new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === "then") return (resolve: (v: unknown) => void) => resolve(result)
        return (...args: unknown[]) => {
          calls.push({ method: String(prop), args })
          return chain
        }
      },
      apply() {
        return chain
      },
    })
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain)
    return calls
  }
  const asked = (calls: Call[]) => JSON.stringify(calls.filter((c) => c.method === "in" || c.method === "or").map((c) => c.args))

  const edl = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    user_id: "u1",
    job_type: "apply-edl",
    input_data: { quality: "proxy", output: "video" },
    output_data: { videoUrl: `https://r2/${id}.mp4`, thumbnailUrl: `https://r2/${id}.jpg` },
    completed_at: "2026-10-06T10:00:00Z",
    created_at: "2026-10-06T10:00:00Z",
    provider: null,
    status: "completed",
    ...over,
  })
  const mix = (id: string) =>
    edl(id, { input_data: { quality: "final", output: "audio" }, output_data: { audioUrl: `https://r2/${id}.m4a` } })
  const generated = {
    id: "g1",
    user_id: "u1",
    job_type: "generate-image",
    input_data: { prompt: "knight" },
    output_data: { imageUrl: "https://r2/g1.png" },
    completed_at: "2026-10-06T09:00:00Z",
    created_at: "2026-10-06T09:00:00Z",
    provider: "nano-banana",
    status: "completed",
  }
  const browse = async (args: Record<string, unknown>) => {
    const server = buildServer()
    registerGallery({ server, session: readSession(), fastify: Fastify() })
    const result = await callTool(server, "browse_gallery", args)
    const sc = (result as { structuredContent?: { items?: Array<Record<string, any>> } }).structuredContent
    return { text: result.content[0]?.text as string, items: sc?.items ?? [] }
  }

  describe("browse_gallery scope=mine", () => {
    it("asks for them under the video and audio kinds, never the image kind", async () => {
      for (const [kinds, expected] of [[["video"], true], [["audio"], true], [["image"], false], [["image", "video", "audio"], true]] as const) {
        const calls = recording([])
        await browse({ scope: "mine", kinds })
        expect(asked(calls).includes("apply-edl"), JSON.stringify(kinds)).toBe(expected)
      }
    })

    it("lists a cut as a video and a mix as audio, a proxy render marked a Preview, in the items and the text", async () => {
      recording([edl("prev"), edl("fin", { input_data: { quality: "final", output: "video" } }), mix("mx"), generated])
      const { text, items } = await browse({ scope: "mine", kinds: ["image", "video", "audio"] })
      expect(items.map((i) => [i.jobId, i.kind, i.preview ?? false])).toEqual([
        ["prev", "video", true],
        ["fin", "video", false],
        ["mx", "audio", false],
        ["g1", "image", false],
      ])
      expect(items[0]).toMatchObject({ assetUrl: "https://r2/prev.mp4", thumbnailUrl: "https://r2/prev.jpg" })
      expect(text).toContain("prev: video (preview)")
      expect(text).toContain("fin: video —")
      expect(text).toContain("mx: audio —")
    })

    it("the kind filter keeps the right medium: a mix is not listed under video, a cut not under audio", async () => {
      recording([edl("cut"), mix("mx")])
      expect((await browse({ scope: "mine", kinds: ["video"] })).items.map((i) => i.jobId)).toEqual(["cut"])
      recording([edl("cut"), mix("mx")])
      expect((await browse({ scope: "mine", kinds: ["audio"] })).items.map((i) => i.jobId)).toEqual(["mx"])
    })

    it("fills the marker of an old render from its order", async () => {
      recording([edl("old", { output_data: { videoUrl: "https://r2/old.mp4" } })])
      expect((await browse({ scope: "mine" })).items[0]?.preview).toBe(true)
    })
  })

  describe("browse_gallery scope=public never lists an Apply EDL render", () => {
    it("does not ask for them under any kind", async () => {
      for (const kinds of [["video"], ["audio"], ["image", "video", "audio"]]) {
        const calls = recording([])
        await browse({ scope: "public", kinds })
        expect(asked(calls), JSON.stringify(kinds)).not.toContain("apply-edl")
      }
    })

    it("and drops one a row hands it anyway — a Preview, a final, a mix", async () => {
      const theirs = { user_id: "someone-else" }
      recording([edl("p", theirs), edl("f", { ...theirs, input_data: { quality: "final", output: "video" } }), { ...mix("m"), ...theirs }, { ...generated, ...theirs }])
      const { text, items } = await browse({ scope: "public", kinds: ["image", "video", "audio"] })
      expect(items.map((i) => i.jobId)).toEqual(["g1"])
      expect(text).not.toContain("apply-edl")
      expect(text).not.toMatch(/\b(p|f|m): /)
    })

    it("even the caller's own render does not appear in the public scope", async () => {
      recording([edl("mine-p")])
      expect((await browse({ scope: "public" })).items).toEqual([])
    })
  })

  describe("list_favorites", () => {
    async function favorites(jobs: unknown[]) {
      const favRows = (jobs as Array<{ id: string }>).map((j) => ({ job_id: j.id, created_at: "2026-10-06T10:00:00Z" }))
      ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockImplementation((table: string) =>
        makeChainable(table === "gallery_favorites" ? favRows : jobs),
      )
      const server = buildServer()
      registerGallery({ server, session: readSession(), fastify: Fastify() })
      const result = await callTool(server, "list_favorites", {})
      return ((result as { structuredContent?: { items?: Array<Record<string, any>> } }).structuredContent?.items ?? [])
    }

    it("lists the caller's own favorited render, a Preview marked; a favorited mix as audio", async () => {
      const items = await favorites([edl("prev"), edl("fin", { input_data: { quality: "final", output: "video" } }), mix("mx")])
      expect(items.map((i) => [i.jobId, i.kind, i.preview ?? false, i.favorited])).toEqual([
        ["prev", "video", true, true],
        ["fin", "video", false, true],
        ["mx", "audio", false, true],
      ])
    })

    it("never lists someone else's render a favorite points at, even when it is public", async () => {
      // The hydration admits other users' PUBLIC rows; an Apply EDL final of a
      // user with public outputs is one — listing it would be new exposure.
      const theirs = { user_id: "someone-else" }
      const items = await favorites([edl("p", theirs), edl("f", { ...theirs, input_data: { quality: "final", output: "video" } }), { ...mix("m"), ...theirs }])
      expect(items).toEqual([])
    })
  })

  it("the item shape carries `preview`", async () => {
    const src = readFileSync(join(__dirname, "..", "..", "widgets", "gallery.ts"), "utf8")
    expect(src.slice(src.indexOf("export interface GalleryItem"), src.indexOf("export interface GalleryInitData"))).toMatch(/preview\?: boolean/)
  })
})
