import Fastify, { type FastifyInstance } from "fastify"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DIRECTION_ID_MAX_CHARS } from "@nodaro/prompts/prompt-builder"
import { newSession } from "../../session.js"
import { _resetPluginSupportsForTests, setPluginSupports } from "../../../private-plugins/supports-registry.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool, listTools } from "./_helpers.js"

/**
 * `video_remake` — the MCP face of `POST /v1/video-remake` (Video Remake, Cloud plugin).
 *
 * The contracts under test:
 *  - without `confirm` it quotes (`/v1/video-remake/estimate`) and never runs;
 *  - with `confirm: true` it runs (`/v1/video-remake`) and hands back the job id,
 *    without quoting again;
 *  - it is registered only on Nodaro Cloud (`hasCredits()`), and only for a
 *    session that may execute;
 *  - a router 404 (the plugin is not served here) reads `not_available`;
 *  - `session_id` reaches the job: the route files it in the caller's own
 *    session, and refuses one that is not theirs as it would a public request.
 *
 * The numbers are neutral on purpose: this repo is publicly mirrored.
 */
const h = vi.hoisted(() => ({ credits: true }))
const db = vi.hoisted(() => ({ ownSession: "" }))

vi.mock("../../../supabase.js", async () => {
  const { makeFakeFrom, has } = await import("../../../__tests__/fake-supabase-query.js")
  return {
    supabase: {
      // Only the caller's own session (user u1, personal side) is found.
      from: makeFakeFrom([], (q) => ({
        data: q.table === "generation_sessions" && has(q, "eq", "id", db.ownSession) && has(q, "eq", "user_id", "u1") && has(q, "is", "workspace_id", null)
          ? { id: db.ownSession }
          : null,
        error: null,
      })),
    },
  }
})
vi.mock("../../../config.js", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return { ...orig, hasCredits: () => h.credits }
})

const { registerCastSwapTools, CUSTOM_STYLE_MAX_CHARS, CUSTOM_STYLE_NOTE_MAX_CHARS_FALLBACK, CUSTOM_STYLE_QUOTE_PLACEHOLDER, _resetCustomStyleNoteLimitForTests } = await import("../cast-swap.js")
const { buildMcpServer } = await import("../../server.js")
const { resolveRequestSession } = await import("../../../generation-session-scope.js")
const { sendInternalError } = await import("../../../http-errors.js")
const { config } = await import("../../../config.js")

interface InjectCall {
  method?: string
  url?: string
  payload?: unknown
  headers?: Record<string, string>
}

/** A fastify stand-in answering one reply per exact URL, recording every call. */
function stubFastify(routes: Record<string, { statusCode: number; body: unknown }>) {
  const calls: InjectCall[] = []
  const fastify = {
    inject: async (opts: InjectCall) => {
      calls.push(opts)
      const res = routes[opts.url ?? ""]
      if (!res) return { statusCode: 404, body: JSON.stringify({ message: `Route POST:${opts.url} not found`, error: "Not Found" }) }
      return { statusCode: res.statusCode, body: typeof res.body === "string" ? res.body : JSON.stringify(res.body) }
    },
  } as unknown as FastifyInstance
  return { fastify, calls }
}

function serverWith(fastify: FastifyInstance, scopes: Scope[] = ["workflows:execute"]) {
  const server = buildServer()
  registerCastSwapTools({ server, session: newSession({ userId: "u1", scopes, clientName: "test" }), fastify })
  return server
}

const QUOTE = { totalCredits: 12, breakdown: { castSwap: 5, seedance: 7, references: 0 }, settlesLower: false }
/** What the tool adds to a quote that names no engine (an older engine's: Nodaro Prism). */
const PRO = { engine: "nodaro-prism", engineName: "Nodaro Prism" }

const ARGS = {
  video_url: "https://cdn.example/clip.mp4",
  roles: [
    { kind: "person", name: "the singer", images: ["https://cdn.example/me.png"], outfit: "original" },
    { kind: "person", name: "the drummer", preview_name: "the tall drummer", in_preview: false },
    { kind: "location", images: ["https://cdn.example/beach.png"] },
  ],
  pre_prompt: "{role:2} in slow motion",
  post_prompt: "{role:1} smiles at the end",
  preview: true,
  preview_start: 2,
  session_id: "s-1",
}

/** What the route receives for ARGS: camelCase, a role with no images sent as `null`. */
const BODY = {
  videoUrl: "https://cdn.example/clip.mp4",
  roles: [
    { kind: "person", name: "the singer", images: ["https://cdn.example/me.png"], outfit: "original" },
    { kind: "person", name: "the drummer", images: null, previewName: "the tall drummer", inPreview: false },
    { kind: "location", images: ["https://cdn.example/beach.png"] },
  ],
  prePrompt: "{role:2} in slow motion",
  postPrompt: "{role:1} smiles at the end",
  preview: true,
  previewStart: 2,
  sessionId: "s-1",
}

describe("video_remake", () => {
  it("quotes without confirm and does not run", async () => {
    const { fastify, calls } = stubFastify({ "/v1/video-remake/estimate": { statusCode: 200, body: QUOTE } })
    const res = await callTool(serverWith(fastify), "video_remake", ARGS)

    expect(res.isError).toBeFalsy()
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(["POST /v1/video-remake/estimate"])
    expect(calls[0]!.payload).toEqual(BODY)
    expect(res.structuredContent).toEqual({ ...PRO, totalCredits: 12, breakdown: { base: 5, references: 0, motion: 7 }, settlesLower: false, confirmed: false })
    expect(res.content[0]!.text).toContain("12 credits")
    expect(res.content[0]!.text).toContain("confirm: true")
  })

  it("forwards style to the quote and the run, and sends none when it is left out", async () => {
    const { fastify, calls } = stubFastify({
      "/v1/video-remake/estimate": { statusCode: 200, body: QUOTE },
      "/v1/video-remake": { statusCode: 202, body: { jobId: "00000000-0000-4000-8000-000000000001" } },
    })
    const server = serverWith(fastify)
    for (const style of ["precise", "motion"] as const) {
      await callTool(server, "video_remake", { ...ARGS, style })
      await callTool(server, "video_remake", { ...ARGS, style, confirm: true })
    }
    expect(calls.map((c) => `${c.url} ${(c.payload as { style?: string }).style}`)).toEqual([
      "/v1/video-remake/estimate precise",
      "/v1/video-remake precise",
      "/v1/video-remake/estimate motion",
      "/v1/video-remake motion",
    ])
    calls.length = 0
    await callTool(server, "video_remake", ARGS)
    expect(calls[0]!.payload).not.toHaveProperty("style")
  })

  it("refuses a style it does not list", async () => {
    const { fastify, calls } = stubFastify({ "/v1/video-remake/estimate": { statusCode: 200, body: QUOTE } })
    const res = await callTool(serverWith(fastify), "video_remake", { ...ARGS, style: "loose" })
    expect(res.isError).toBe(true)
    expect(calls).toEqual([])
  })

  it("refuses art_style before any quote or run where the loaded engine takes none, and runs as before without it", async () => {
    const { fastify, calls } = stubFastify({
      "/v1/video-remake/estimate": { statusCode: 200, body: QUOTE },
      "/v1/video-remake": { statusCode: 202, body: { jobId: "00000000-0000-4000-8000-000000000004" } },
    })
    try {
      // No declaration at all, an engine that predates art styles, and one that says it takes none.
      for (const castSwap of [
        undefined,
        { engines: ["nodaro-prism", "nodaro-pulse"], engineAliases: true },
        { engines: ["nodaro-prism", "nodaro-pulse"], engineAliases: true, artStyle: false },
      ]) {
        _resetPluginSupportsForTests()
        if (castSwap) setPluginSupports({ castSwap: castSwap as never })
        for (const confirm of [undefined, true]) {
          const res = await callTool(serverWith(fastify), "video_remake", { ...ARGS, style: "motion", art_style: "pop-art", ...(confirm ? { confirm } : {}) })
          expect(res.isError, JSON.stringify(castSwap)).toBe(true)
          // Its own sentence, not the generic 503 wording of a model outage.
          expect(res.content).toEqual([{ type: "text", text: "Nodaro: art styles are not available on this deployment yet. [art_style_unavailable]" }])
        }
      }
      // An older engine would strip `direction` and run without the style: nothing is sent.
      expect(calls).toEqual([])
      // Without art_style the same engine quotes and runs as before.
      await callTool(serverWith(fastify), "video_remake", ARGS)
      await callTool(serverWith(fastify), "video_remake", { ...ARGS, confirm: true })
      expect(calls.map((c) => c.url)).toEqual(["/v1/video-remake/estimate", "/v1/video-remake"])
      for (const c of calls) expect(c.payload).toEqual(BODY)
    } finally {
      _resetPluginSupportsForTests()
    }
  })

  describe("art_style, on an engine that takes one (castSwap.artStyle)", () => {
    beforeEach(() => setPluginSupports({ castSwap: { artStyle: true } as never }))
    afterEach(() => _resetPluginSupportsForTests())

    it("sends art_style to the quote and the run as direction.style, and no direction without it", async () => {
      const { fastify, calls } = stubFastify({
        "/v1/video-remake/estimate": { statusCode: 200, body: QUOTE },
        "/v1/video-remake": { statusCode: 202, body: { jobId: "00000000-0000-4000-8000-000000000002" } },
      })
      const server = serverWith(fastify)
      await callTool(server, "video_remake", { ...ARGS, style: "motion", art_style: "pop-art" })
      await callTool(server, "video_remake", { ...ARGS, style: "motion", art_style: "pop-art", confirm: true })
      expect(calls.map((c) => c.url)).toEqual(["/v1/video-remake/estimate", "/v1/video-remake"])
      for (const c of calls) expect(c.payload).toEqual({ ...BODY, style: "motion", direction: { style: "pop-art" } })
      calls.length = 0
      await callTool(server, "video_remake", ARGS)
      await callTool(server, "video_remake", { ...ARGS, confirm: true })
      expect(calls).toHaveLength(2)
      // Without it the body is the one sent before art_style existed, byte for byte.
      for (const c of calls) {
        expect(c.payload).not.toHaveProperty("direction")
        expect(JSON.stringify(c.payload)).toBe(JSON.stringify(BODY))
      }
    })

    it("refuses a direction of the agent's own (the REST field) before any quote or run, pointing at art_style", async () => {
      const { fastify, calls } = stubFastify({
        "/v1/video-remake/estimate": { statusCode: 200, body: QUOTE },
        "/v1/video-remake": { statusCode: 202, body: { jobId: "00000000-0000-4000-8000-000000000003" } },
      })
      const server = serverWith(fastify)
      // Not a listed argument: the loose schema lets it reach the handler, where dropping it would run the clip unstyled.
      for (const extra of [
        { direction: { style: "pop-art" } },
        { direction: { style: "watercolor", camera: "dolly-in" } },
        { direction: { style: "watercolor" }, art_style: "pop-art" },
        { direction: null },
      ]) {
        for (const confirm of [undefined, true]) {
          const res = await callTool(server, "video_remake", { ...ARGS, style: "motion", ...extra, ...(confirm ? { confirm } : {}) })
          expect(res.isError, JSON.stringify(extra)).toBe(true)
          expect(res.content[0]!.text).toBe(
            'Nodaro rejected the request (400 use_art_style): video_remake takes no direction. Give an art style as art_style instead, a "style" picker catalog id (get_picker_catalog "style").',
          )
        }
      }
      expect(calls).toEqual([])
    })

    it("refuses an empty art_style, one longer than a direction id, or not a string, before any call; one at the limit is sent", async () => {
      const { fastify, calls } = stubFastify({ "/v1/video-remake/estimate": { statusCode: 200, body: QUOTE } })
      const server = serverWith(fastify)
      // As the route parses a direction id: 1 to DIRECTION_ID_MAX_CHARS characters.
      for (const art_style of ["", "x".repeat(DIRECTION_ID_MAX_CHARS + 1), 7, { style: "pop-art" }]) {
        const res = await callTool(server, "video_remake", { ...ARGS, style: "motion", art_style })
        expect(res.isError, JSON.stringify(art_style)).toBe(true)
      }
      expect(calls).toEqual([])
      const atLimit = "x".repeat(DIRECTION_ID_MAX_CHARS)
      await callTool(server, "video_remake", { ...ARGS, style: "motion", art_style: atLimit })
      expect(calls).toHaveLength(1)
      expect(calls[0]!.payload).toMatchObject({ direction: { style: atLimit } })
    })

    it("leaves the art style's rules to the route: its refusal comes back as a tool error, quote and run alike", async () => {
      const refused = { statusCode: 400, body: { error: { code: "art_style_needs_flex", message: "An art style is only available on a Flex run." } } }
      const { fastify, calls } = stubFastify({ "/v1/video-remake/estimate": refused, "/v1/video-remake": refused })
      const server = serverWith(fastify)
      // A Precise run (no style): sent as asked, for the route to refuse.
      for (const confirm of [undefined, true]) {
        const res = await callTool(server, "video_remake", { ...ARGS, art_style: "pop-art", ...(confirm ? { confirm } : {}) })
        expect(res.isError).toBe(true)
        expect(res.content[0]!.text).toContain("art_style_needs_flex")
        expect(res.content[0]!.text).toContain("An art style is only available on a Flex run.")
      }
      expect(calls.map((c) => `${c.url} ${JSON.stringify((c.payload as { direction?: unknown }).direction)}`)).toEqual([
        '/v1/video-remake/estimate {"style":"pop-art"}',
        '/v1/video-remake {"style":"pop-art"}',
      ])
    })
  })

  it("refuses a custom style before any quote, describe or run where the loaded engine takes none (an engine from before it)", async () => {
    const { fastify, calls } = stubFastify({
      "/v1/video-remake/estimate": { statusCode: 200, body: QUOTE },
      "/v1/video-remake/describe-style": { statusCode: 200, body: { text: "never read" } },
      "/v1/video-remake": { statusCode: 202, body: { jobId: "00000000-0000-4000-8000-000000000005" } },
    })
    try {
      // No declaration at all, an engine that takes art styles but predates custom ones, and one that says it takes none.
      for (const castSwap of [undefined, { artStyle: true }, { artStyle: true, customStyle: false }]) {
        _resetPluginSupportsForTests()
        if (castSwap) setPluginSupports({ castSwap: castSwap as never })
        for (const custom of [{ custom_style: "Hand-drawn ink" }, { custom_style_image_url: "https://cdn.example/look.png" }]) {
          for (const confirm of [undefined, true]) {
            const res = await callTool(serverWith(fastify), "video_remake", { ...ARGS, style: "motion", ...custom, ...(confirm ? { confirm } : {}) })
            expect(res.isError, JSON.stringify([castSwap, custom])).toBe(true)
            expect(res.content).toEqual([{ type: "text", text: "Nodaro: custom styles are not available on this deployment yet. [custom_style_unavailable]" }])
          }
        }
      }
      // Its strict schema would refuse the key, and it has no route that reads an image: nothing is sent.
      expect(calls).toEqual([])
    } finally {
      _resetPluginSupportsForTests()
    }
  })

  describe("a custom style, on an engine that takes one (castSwap.customStyle)", () => {
    const TEXT = "Hand-drawn ink on rough paper, heavy outlines, flat muted colours"
    const IMAGE = "https://cdn.example/look.png"
    const DESCRIBED = "Loose watercolour washes over pencil lines, soft edges, pale warm palette"
    const JOB = "00000000-0000-4000-8000-000000000006"
    const routes = (describe: { statusCode: number; body: unknown } = { statusCode: 200, body: { text: DESCRIBED, medium: "2d", tones: "colour" } }) =>
      stubFastify({
        "/v1/video-remake/estimate": { statusCode: 200, body: QUOTE },
        "/v1/video-remake/describe-style": describe,
        "/v1/video-remake": { statusCode: 202, body: { jobId: JOB } },
      })
    const urls = (calls: InjectCall[]) => calls.map((c) => c.url)
    /** The engine's own custom-style route, the platform's read of its limits. */
    const NOTE_LIMIT_URL = "/v1/video-remake/custom-style"

    beforeEach(() => {
      setPluginSupports({ castSwap: { artStyle: true, customStyle: true } as never })
      _resetCustomStyleNoteLimitForTests()
    })
    afterEach(() => _resetPluginSupportsForTests())

    it("lists both arguments, with what each is for", async () => {
      const { fastify } = routes()
      const tool = (await listTools(serverWith(fastify))).find((t) => t.name === "video_remake")!
      const props = (tool.inputSchema as { properties: Record<string, { description?: string; maxLength?: number }> }).properties
      expect(props.custom_style!.description).toBe(
        "The style in your own words, instead of art_style (never both). Write it yourself: describe the visual style only — the medium (drawn, 3D-rendered or filmed), line, colour, lighting and texture — never who or what is in the video, and no names of people. At most 600 characters. Nodaro Prism only.",
      )
      expect(props.custom_style!.maxLength).toBe(600)
      expect(props.custom_style_image_url!.description).toBe(
        "A public https image whose visual style the video should take. Nodaro reads the image's style (never its content) and restyles the clip in it. With custom_style too, your text is a note on the image's style (for example 'like this, but darker'). Not with art_style.",
      )
    })

    it("text alone: the quote and the run carry it as direction.customStyle, as written, and no image is read", async () => {
      const { fastify, calls } = routes()
      const server = serverWith(fastify)
      const quote = await callTool(server, "video_remake", { ...ARGS, style: "motion", custom_style: TEXT })
      const run = await callTool(server, "video_remake", { ...ARGS, style: "motion", custom_style: TEXT, confirm: true })
      expect(urls(calls)).toEqual(["/v1/video-remake/estimate", "/v1/video-remake"])
      for (const c of calls) expect(c.payload).toEqual({ ...BODY, style: "motion", direction: { customStyle: TEXT } })
      // Nothing about an image in a quote that has none.
      expect(quote.content[0]!.text).not.toMatch(/image's style/)
      expect(run.structuredContent).toEqual({ jobId: JOB, confirmed: true })
    })

    it("an image, on the quote: the image is NOT read; the quote is sent a neutral placeholder and says when the image is read", async () => {
      const { fastify, calls } = routes()
      const res = await callTool(serverWith(fastify), "video_remake", { ...ARGS, style: "motion", custom_style_image_url: IMAGE })
      expect(res.isError).toBeFalsy()
      expect(urls(calls)).toEqual(["/v1/video-remake/estimate"])
      expect(calls[0]!.payload).toEqual({ ...BODY, style: "motion", direction: { customStyle: CUSTOM_STYLE_QUOTE_PLACEHOLDER } })
      // The address never reaches the quote.
      expect(JSON.stringify(calls[0]!.payload)).not.toContain(IMAGE)
      expect(res.content[0]!.text).toContain("The image's style is read when the run is confirmed; the price does not depend on it.")
      expect(res.structuredContent).toMatchObject({ confirmed: false, totalCredits: 12 })
    })

    it("the placeholder is plain words the route takes: not blank, no curly braces, within the limit", () => {
      expect(CUSTOM_STYLE_QUOTE_PLACEHOLDER.trim().length).toBeGreaterThan(0)
      expect(CUSTOM_STYLE_QUOTE_PLACEHOLDER.length).toBeLessThanOrEqual(CUSTOM_STYLE_MAX_CHARS)
      expect(CUSTOM_STYLE_QUOTE_PLACEHOLDER).not.toMatch(/[{}]/)
    })

    it("an image, on the confirmed run: its style is put into words first, then the run carries that text; one call, no round trip", async () => {
      const { fastify, calls } = routes()
      const res = await callTool(serverWith(fastify), "video_remake", { ...ARGS, style: "motion", custom_style_image_url: IMAGE, confirm: true, client_request_id: "req-12345678" })
      expect(res.isError).toBeFalsy()
      // The describe step, the run, then the job read back for the words it recorded.
      expect(urls(calls)).toEqual(["/v1/video-remake/describe-style", "/v1/video-remake", `/v1/jobs/${JOB}`])
      expect(calls[0]!.method).toBe("POST")
      expect(calls[0]!.payload).toEqual({ imageUrl: IMAGE })
      // The describe call is the session's user's, through the platform's own door.
      expect(calls[0]!.headers).toMatchObject({ "x-internal-user-id": "u1", "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET })
      // It is no run: it carries no idempotency key; the run does.
      expect(Object.keys(calls[0]!.headers ?? {}).map((k) => k.toLowerCase())).not.toContain("idempotency-key")
      expect(calls[1]!.payload).toEqual({ ...BODY, style: "motion", direction: { customStyle: DESCRIBED } })
      expect(JSON.stringify(calls[1]!.payload)).not.toContain(IMAGE)
      // The words the image was read as, for information only: nothing waits on them.
      expect(res.structuredContent).toEqual({ jobId: JOB, confirmed: true, custom_style_text: DESCRIBED })
      expect(res.content[0]!.text).toContain(`Video Remake started (job ${JOB}).`)
      expect(res.content[0]!.text).toContain(`The image's style was read as: "${DESCRIBED}"`)
      expect(res.content[0]!.text).not.toMatch(/confirm/i)
    })

    it("names the style the answered job recorded: a repeat that answers an earlier job says that job's words, not the ones just read", async () => {
      const EARLIER = "Thick oil paint, visible brush strokes, deep saturated colour"
      const { fastify, calls } = stubFastify({
        "/v1/video-remake/describe-style": { statusCode: 200, body: { text: DESCRIBED } },
        "/v1/video-remake": { statusCode: 200, body: { jobId: JOB, deduped: true } },
        [`/v1/jobs/${JOB}`]: { statusCode: 200, body: { data: { id: JOB, input_data: { direction: { customStyle: EARLIER } } } } },
      })
      const res = await callTool(serverWith(fastify), "video_remake", { ...ARGS, style: "motion", custom_style_image_url: IMAGE, confirm: true, client_request_id: "req-12345678" })
      expect(calls[2]).toMatchObject({ method: "GET", url: `/v1/jobs/${JOB}` })
      expect(res.structuredContent).toEqual({ jobId: JOB, confirmed: true, custom_style_text: EARLIER })
      expect(res.content[0]!.text).toContain(`The image's style was read as: "${EARLIER}"`)
    })

    it("a run without an image reads no job back and says nothing of a style", async () => {
      const { fastify, calls } = routes()
      const res = await callTool(serverWith(fastify), "video_remake", { ...ARGS, style: "motion", custom_style: TEXT, confirm: true })
      expect(urls(calls)).toEqual(["/v1/video-remake"])
      expect(res.structuredContent).toEqual({ jobId: JOB, confirmed: true })
      expect(res.content[0]!.text).not.toMatch(/image's style/)
    })

    it("an image and text: the text is a note on the image's style — the quote's text, and the describe step's note", async () => {
      const { fastify, calls } = routes()
      const server = serverWith(fastify)
      const both = { ...ARGS, style: "motion", custom_style_image_url: IMAGE, custom_style: "like this, but darker" }
      await callTool(server, "video_remake", both)
      await callTool(server, "video_remake", { ...both, confirm: true })
      const sent = calls.filter((c) => c.url !== NOTE_LIMIT_URL && !c.url!.startsWith("/v1/jobs/"))
      expect(urls(sent)).toEqual(["/v1/video-remake/estimate", "/v1/video-remake/describe-style", "/v1/video-remake"])
      expect(sent[0]!.payload).toMatchObject({ direction: { customStyle: "like this, but darker" } })
      expect(sent[1]!.payload).toEqual({ imageUrl: IMAGE, note: "like this, but darker" })
      // The run carries what the image was read as, never the note itself.
      expect(sent[2]!.payload).toMatchObject({ direction: { customStyle: DESCRIBED } })
      // A blank text beside an image is no note, and asks the engine no limit.
      calls.length = 0
      await callTool(server, "video_remake", { ...both, custom_style: "   ", confirm: true })
      expect(calls[0]!.payload).toEqual({ imageUrl: IMAGE })
      expect(urls(calls)).not.toContain(NOTE_LIMIT_URL)
    })

    it("a note's limit is the engine's own: one past it is refused on the quote already, typed, before any quote, describe or run", async () => {
      const { fastify, calls } = stubFastify({
        "/v1/video-remake/estimate": { statusCode: 200, body: QUOTE },
        "/v1/video-remake/describe-style": { statusCode: 200, body: { text: DESCRIBED } },
        "/v1/video-remake": { statusCode: 202, body: { jobId: JOB } },
        // An engine whose describe step takes a shorter note than a style's 600 characters.
        [NOTE_LIMIT_URL]: { statusCode: 200, body: { noteMaxChars: 300, maxChars: 600 } },
      })
      const server = serverWith(fastify)
      const note = "x".repeat(301)
      for (const confirm of [undefined, true]) {
        const res = await callTool(server, "video_remake", { ...ARGS, style: "motion", custom_style_image_url: IMAGE, custom_style: note, ...(confirm ? { confirm } : {}) })
        expect(res.isError).toBe(true)
        expect(res.content[0]!.text).toBe(
          "Nodaro rejected the request (400 custom_style_note_too_long): With custom_style_image_url, custom_style is a note on the image's style of at most 300 characters.",
        )
      }
      // The engine was asked its limit once (as the platform, for the session's user) and nothing else was sent.
      expect(urls(calls)).toEqual([NOTE_LIMIT_URL])
      expect(calls[0]).toMatchObject({ method: "POST", payload: {} })
      expect(calls[0]!.headers).toMatchObject({ "x-internal-user-id": "u1", "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET })
      // A note at the engine's limit goes through, the limit not asked again.
      calls.length = 0
      await callTool(server, "video_remake", { ...ARGS, style: "motion", custom_style_image_url: IMAGE, custom_style: "x".repeat(300) })
      expect(urls(calls)).toEqual(["/v1/video-remake/estimate"])
      // The same long text with no image is a style of its own, within a style's limit.
      calls.length = 0
      await callTool(server, "video_remake", { ...ARGS, style: "motion", custom_style: note })
      expect(urls(calls)).toEqual(["/v1/video-remake/estimate"])
    })

    it("with an image the note may be as long as a style (600) where the engine says so, and where its limit cannot be read", async () => {
      expect(CUSTOM_STYLE_NOTE_MAX_CHARS_FALLBACK).toBe(CUSTOM_STYLE_MAX_CHARS)
      const note = "x".repeat(CUSTOM_STYLE_MAX_CHARS)
      for (const limit of [
        { statusCode: 200, body: { noteMaxChars: 600 } },
        { statusCode: 200, body: { data: { noteMaxChars: 600 } } },
        // No answer, a refusal, or an answer without a usable figure: the fallback, asked again next time.
        undefined,
        { statusCode: 500, body: { error: { code: "boom" } } },
        { statusCode: 200, body: { noteMaxChars: "many" } },
        { statusCode: 200, body: "not json" },
      ]) {
        _resetCustomStyleNoteLimitForTests()
        const { fastify, calls } = stubFastify({
          "/v1/video-remake/estimate": { statusCode: 200, body: QUOTE },
          "/v1/video-remake/describe-style": { statusCode: 200, body: { text: DESCRIBED } },
          "/v1/video-remake": { statusCode: 202, body: { jobId: JOB } },
          ...(limit ? { [NOTE_LIMIT_URL]: limit } : {}),
        })
        const server = serverWith(fastify)
        const quote = await callTool(server, "video_remake", { ...ARGS, style: "motion", custom_style_image_url: IMAGE, custom_style: note })
        expect(quote.isError, JSON.stringify(limit)).toBeFalsy()
        await callTool(server, "video_remake", { ...ARGS, style: "motion", custom_style_image_url: IMAGE, custom_style: note, confirm: true })
        const describe = calls.find((c) => c.url === "/v1/video-remake/describe-style")!
        expect(describe.payload, JSON.stringify(limit)).toEqual({ imageUrl: IMAGE, note })
        // A figure the engine gave is kept for the process; anything else is asked again.
        expect(calls.filter((c) => c.url === NOTE_LIMIT_URL)).toHaveLength(limit && limit.statusCode === 200 && typeof limit.body === "object" && JSON.stringify(limit.body).includes("600") ? 1 : 2)
      }
    })

    it("refuses a custom style beside art_style, text or image, before any call (one style a run)", async () => {
      const { fastify, calls } = routes()
      const server = serverWith(fastify)
      for (const custom of [{ custom_style: TEXT }, { custom_style_image_url: IMAGE }, { custom_style: TEXT, custom_style_image_url: IMAGE }]) {
        for (const confirm of [undefined, true]) {
          const res = await callTool(server, "video_remake", { ...ARGS, style: "motion", art_style: "pop-art", ...custom, ...(confirm ? { confirm } : {}) })
          expect(res.isError, JSON.stringify(custom)).toBe(true)
          expect(res.content[0]!.text).toBe(
            "Nodaro rejected the request (400 custom_style_with_art_style): Give an art style (art_style) or a custom style (custom_style, custom_style_image_url), not both.",
          )
        }
      }
      expect(calls).toEqual([])
    })

    it("a describe refusal is the tool's answer, typed, and nothing runs or is held", async () => {
      for (const [statusCode, code, message] of [
        [400, "image_unreadable", "The image could not be read."],
        [502, "describe_style_failed", "The image's style could not be described just now."],
        [422, "style_not_described", "No style could be described from this image."],
        [403, "custom_style_not_available", "A custom style is not available here."],
        // The describe step's own limit per account: worded as every rate limit is.
        [429, "rate limited", "Too many requests. Retry in 20s."],
      ] as const) {
        const { fastify, calls } = routes({ statusCode, body: { error: { code, message } } })
        const res = await callTool(serverWith(fastify), "video_remake", { ...ARGS, style: "motion", custom_style_image_url: IMAGE, confirm: true })
        expect(res.isError, code).toBe(true)
        expect(res.content[0]!.text, code).toContain(code)
        // The run route is never reached: no job, no hold.
        expect(urls(calls), code).toEqual(["/v1/video-remake/describe-style"])
      }
    })

    it("an answer with no usable text starts nothing either", async () => {
      for (const body of [{}, { text: "   " }, { text: 7 }, "not json"]) {
        const { fastify, calls } = routes({ statusCode: 200, body })
        const res = await callTool(serverWith(fastify), "video_remake", { ...ARGS, style: "motion", custom_style_image_url: IMAGE, confirm: true })
        expect(res.isError, JSON.stringify(body)).toBe(true)
        expect(res.content[0]!.text).toBe("The image's style could not be read. Nothing was started or charged.")
        expect(urls(calls)).toEqual(["/v1/video-remake/describe-style"])
      }
    })

    it("leaves the custom style's rules to the route: its refusal comes back as a tool error, quote and run alike", async () => {
      const refused = { statusCode: 403, body: { error: { code: "custom_style_not_available", message: "A custom style is not available here. Choose an art style from the list instead." } } }
      const { fastify, calls } = stubFastify({ "/v1/video-remake/estimate": refused, "/v1/video-remake": refused })
      const server = serverWith(fastify)
      for (const confirm of [undefined, true]) {
        const res = await callTool(server, "video_remake", { ...ARGS, style: "motion", custom_style: TEXT, ...(confirm ? { confirm } : {}) })
        expect(res.isError).toBe(true)
        expect(res.content[0]!.text).toContain("custom_style_not_available")
      }
      expect(urls(calls)).toEqual(["/v1/video-remake/estimate", "/v1/video-remake"])
    })

    it("refuses a text past 600 characters and an image that is not an https address, before any call", async () => {
      const { fastify, calls } = routes()
      const server = serverWith(fastify)
      for (const bad of [
        { custom_style: "x".repeat(CUSTOM_STYLE_MAX_CHARS + 1) },
        { custom_style: 7 },
        { custom_style_image_url: "http://cdn.example/look.png" },
        { custom_style_image_url: "data:image/png;base64,AAAA" },
        { custom_style_image_url: "look.png" },
      ]) {
        const res = await callTool(server, "video_remake", { ...ARGS, style: "motion", ...bad })
        expect(res.isError, JSON.stringify(bad)).toBe(true)
      }
      expect(calls).toEqual([])
      const atLimit = "x".repeat(CUSTOM_STYLE_MAX_CHARS)
      await callTool(server, "video_remake", { ...ARGS, style: "motion", custom_style: atLimit })
      expect(calls[0]!.payload).toMatchObject({ direction: { customStyle: atLimit } })
    })
  })

  it("says when the final charge is expected to come out lower", async () => {
    const { fastify } = stubFastify({ "/v1/video-remake/estimate": { statusCode: 200, body: { ...QUOTE, settlesLower: true } } })
    const res = await callTool(serverWith(fastify), "video_remake", ARGS)
    expect(res.content[0]!.text).toMatch(/lower/)
  })

  it("names the expected charge and the hold when the engine answers both", async () => {
    const quote = {
      totalCredits: 40,
      expectedCredits: 31,
      breakdown: { castSwap: 5, seedance: 32, seedanceExpected: 23, references: 3 },
      settlesLower: true,
    }
    const { fastify } = stubFastify({ "/v1/video-remake/estimate": { statusCode: 200, body: quote } })
    const res = await callTool(serverWith(fastify), "video_remake", ARGS)
    expect(res.content[0]!.text).toContain("costs about 31 credits (up to 40 held while it runs).")
    // The expected charge already is the lower figure: no "lower than this quote" after it.
    expect(res.content[0]!.text).not.toMatch(/lower than this quote/)
    expect(res.structuredContent).toEqual({
      ...PRO,
      totalCredits: 40,
      expectedCredits: 31,
      // The engine's old key names are answered by their neutral ones.
      breakdown: { base: 5, references: 3, motion: 32, motionExpected: 23 },
      settlesLower: true,
      confirmed: false,
    })
  })

  it("names the reference preparation in the quote when it costs something", async () => {
    const withPrep = { totalCredits: 15, breakdown: { castSwap: 5, seedance: 7, references: 3 }, settlesLower: false }
    const { fastify } = stubFastify({ "/v1/video-remake/estimate": { statusCode: 200, body: withPrep } })
    const res = await callTool(serverWith(fastify), "video_remake", ARGS)
    expect(res.content[0]!.text).toContain("15 credits")
    expect(res.content[0]!.text).toMatch(/3 credits?[^.]*prepar/i)
    expect(res.content[0]!.text).toContain("prepare_references: false")
    expect(res.structuredContent).toEqual({ ...PRO, totalCredits: 15, breakdown: { base: 5, references: 3, motion: 7 }, settlesLower: false, confirmed: false })
  })

  it("says nothing of the preparation when it costs nothing", async () => {
    const { fastify } = stubFastify({ "/v1/video-remake/estimate": { statusCode: 200, body: QUOTE } })
    const res = await callTool(serverWith(fastify), "video_remake", ARGS)
    expect(res.content[0]!.text).not.toMatch(/prepar/i)
  })

  it("sends pet and product roles, their preview settings, resolution, draft and prepare_references to the route in camelCase", async () => {
    const { fastify, calls } = stubFastify({ "/v1/video-remake/estimate": { statusCode: 200, body: QUOTE } })
    const res = await callTool(serverWith(fastify), "video_remake", {
      video_url: "https://cdn.example/clip.mp4",
      roles: [
        { kind: "pet", name: "the dog", images: ["https://cdn.example/dog.png"], coat: "original", preview_name: "  the puppy  " },
        { kind: "product", name: "the can", images: ["https://cdn.example/can.png"], finish: "original", in_preview: true },
      ],
      resolution: "720p",
      draft: false,
      prepare_references: false,
    })

    expect(res.isError).toBeFalsy()
    expect(calls[0]!.payload).toEqual({
      videoUrl: "https://cdn.example/clip.mp4",
      roles: [
        { kind: "pet", name: "the dog", images: ["https://cdn.example/dog.png"], coat: "original", previewName: "the puppy" },
        { kind: "product", name: "the can", images: ["https://cdn.example/can.png"], finish: "original", inPreview: true },
      ],
      resolution: "720p",
      draft: false,
      prepareReferences: false,
    })
  })

  it("sends an unnamed person as it is (named by its first image), and a blank location without its name (its default)", async () => {
    const { fastify, calls } = stubFastify({ "/v1/video-remake/estimate": { statusCode: 200, body: QUOTE } })
    const res = await callTool(serverWith(fastify), "video_remake", {
      video_url: "https://cdn.example/clip.mp4",
      roles: [
        { kind: "person", images: ["https://cdn.example/me.png"] },
        { kind: "person", name: "", images: ["https://cdn.example/you.png"] },
        { kind: "location", name: "  ", images: ["https://cdn.example/beach.png"] },
      ],
    })
    expect(res.isError).toBeFalsy()
    expect((calls[0]!.payload as { roles: unknown[] }).roles).toEqual([
      { kind: "person", images: ["https://cdn.example/me.png"] },
      { kind: "person", name: "", images: ["https://cdn.example/you.png"] },
      { kind: "location", images: ["https://cdn.example/beach.png"] },
    ])
  })

  it("sends fixed references to the route as given", async () => {
    const { fastify, calls } = stubFastify({ "/v1/video-remake/estimate": { statusCode: 200, body: QUOTE } })
    const references = [
      { images: ["https://cdn.example/glass.png"], line: "the glass she drinks from" },
      { images: ["https://cdn.example/sky.png", "https://cdn.example/sky2.png"], line: "Use {image} for the sky" },
    ]
    const res = await callTool(serverWith(fastify), "video_remake", { ...ARGS, references })
    expect(res.isError).toBeFalsy()
    expect(calls[0]!.payload).toEqual({ ...BODY, references })
  })

  it("trims a reference's line, as the route does", async () => {
    const { fastify, calls } = stubFastify({ "/v1/video-remake/estimate": { statusCode: 200, body: QUOTE } })
    const references = [{ images: ["https://cdn.example/glass.png"], line: "  the glass she drinks from \n" }]
    const res = await callTool(serverWith(fastify), "video_remake", { ...ARGS, references })
    expect(res.isError).toBeFalsy()
    expect(calls[0]!.payload).toEqual({
      ...BODY,
      references: [{ images: ["https://cdn.example/glass.png"], line: "the glass she drinks from" }],
    })
  })

  it("refuses a reference the route would refuse, before any call", async () => {
    const { fastify, calls } = stubFastify({ "/v1/video-remake/estimate": { statusCode: 200, body: QUOTE } })
    const server = serverWith(fastify)
    const cases: Array<[string, { images: string[]; line: string }]> = [
      ["a whitespace-only line", { images: ["https://cdn.example/glass.png"], line: "   " }],
      ["a non-http(s) image", { images: ["ftp://cdn.example/glass.png"], line: "the glass" }],
      ["a data: image", { images: ["data:image/png;base64,AAAA"], line: "the glass" }],
      ["an image URL over 4096 characters", { images: [`https://cdn.example/${"a".repeat(4096)}.png`], line: "the glass" }],
    ]
    for (const [what, reference] of cases) {
      const res = await callTool(server, "video_remake", { ...ARGS, references: [reference] })
      expect(res.isError, what).toBe(true)
    }
    expect(calls).toHaveLength(0)
  })

  it("accepts face_masking from an older client and ignores it: nothing of it reaches the route (Nodaro sets it per engine)", async () => {
    const { fastify, calls } = stubFastify({
      "/v1/video-remake/estimate": { statusCode: 200, body: QUOTE },
      "/v1/video-remake": { statusCode: 202, body: { jobId: "job-fm" } },
    })
    const server = serverWith(fastify)
    for (const face_masking of [
      { mode: "always", target: "face", fill: "depth", zone: { left_pct: 5 } },
      { mode: "auto" },
      // Shapes the tool once refused are no error now: the key is not the tool's any more.
      { mode: "sometimes", threshold: 7 },
      "on",
    ]) {
      for (const confirm of [undefined, true]) {
        const res = await callTool(server, "video_remake", { ...ARGS, face_masking, ...(confirm ? { confirm } : {}) })
        expect(res.isError, JSON.stringify(face_masking)).toBeFalsy()
      }
    }
    expect(calls).toHaveLength(8)
    for (const c of calls) {
      expect(c.payload).toEqual(BODY)
      expect("faceMasking" in (c.payload as Record<string, unknown>)).toBe(false)
    }
  })

  it("lists no face_masking argument", async () => {
    const { fastify } = stubFastify({})
    const tool = (await listTools(serverWith(fastify))).find((t) => t.name === "video_remake")!
    expect(Object.keys((tool.inputSchema as { properties: Record<string, unknown> }).properties)).not.toContain("face_masking")
    expect(Object.keys((tool.inputSchema as { properties: Record<string, unknown> }).properties)).not.toContain("kling_length")
    expect(JSON.stringify(tool)).not.toMatch(/mask|blur|depth|seedance|kling|SAM\b|Motion (Pro|Lite)\b|motion-(pro|lite)\b/i)
  })

  it("says an art style alone is enough on a nodaro-prism Flex run where the engine takes style-only runs, and what it does", async () => {
    const { fastify } = stubFastify({})
    const tool = (await listTools(serverWith(fastify))).find((t) => t.name === "video_remake")!
    const properties = (tool.inputSchema as { properties: Record<string, { description?: string }> }).properties
    expect(properties.roles.description).toContain("a pre_prompt or post_prompt")
    expect(properties.roles.description).toContain("on a nodaro-prism Flex run where the engine takes style-only runs, an art_style alone")
    expect(properties.roles.description).toContain("restyles the whole clip")
    expect(properties.art_style.description).toContain("With no role images and no references it restyles the whole clip")
    expect(properties.art_style.description).toContain("where the engine takes style-only runs")
  })

  it("says 480p is plain by default, a draft only with draft: true, and that nodaro-pulse has no Full Quality", async () => {
    const { fastify } = stubFastify({})
    const tool = (await listTools(serverWith(fastify))).find((t) => t.name === "video_remake")!
    const properties = (tool.inputSchema as { properties: Record<string, { description?: string }> }).properties
    expect(properties.draft.description).toContain("Default false")
    expect(properties.draft.description).toContain("full_quality")
    expect(properties.engine.description).toContain("no Full Quality")
    expect(JSON.stringify(tool)).not.toMatch(/Default true at 480p|480p draft,|Full Quality is a new take/)
  })

  it("takes an older client's kling_length as motion_length (unlisted), and refuses one that is not a length fit", async () => {
    const { fastify, calls } = stubFastify({ "/v1/video-remake/estimate": { statusCode: 200, body: QUOTE } })
    await callTool(serverWith(fastify), "video_remake", { ...ARGS, kling_length: "cut-start" })
    expect(calls[0]!.payload).toEqual({ ...BODY, klingLength: "cut-start" })
    // motion_length wins over it.
    await callTool(serverWith(fastify), "video_remake", { ...ARGS, motion_length: "cut-end", kling_length: "cut-start" })
    expect(calls[1]!.payload).toEqual({ ...BODY, klingLength: "cut-end" })
    const bad = await callTool(serverWith(fastify), "video_remake", { ...ARGS, kling_length: "pad" })
    expect(bad.isError).toBe(true)
    expect(calls).toHaveLength(2)
  })

  it("refuses a nodaro-pulse run (or an older id of it), sending nothing, where the loaded engine does not declare it (an older engine would run Prism)", async () => {
    const { fastify, calls } = stubFastify({ "/v1/video-remake/estimate": { statusCode: 200, body: QUOTE } })
    try {
      for (const castSwap of [
        undefined,
        { engines: ["seedance-2-5" as const] },
        { engines: ["motion-pro" as const], engineAliases: true },
        { engines: ["nodaro-prism" as const], engineAliases: true },
      ]) {
        _resetPluginSupportsForTests()
        if (castSwap) setPluginSupports({ castSwap: castSwap as never })
        for (const engine of ["nodaro-pulse", "motion-lite", "kling-4"]) {
          for (const confirm of [undefined, true]) {
            const res = await callTool(serverWith(fastify), "video_remake", { ...ARGS, engine, ...(confirm ? { confirm } : {}) })
            expect(res.isError).toBe(true)
            expect(res.content[0]!.text).toContain("engine_unavailable")
            expect(res.content[0]!.text).not.toMatch(/kling/i)
          }
        }
      }
      expect(calls).toEqual([])
      // Prism named outright, by any id, still runs anywhere, sent as the internal id.
      await callTool(serverWith(fastify), "video_remake", { ...ARGS, engine: "nodaro-prism" })
      await callTool(serverWith(fastify), "video_remake", { ...ARGS, engine: "motion-pro" })
      await callTool(serverWith(fastify), "video_remake", { ...ARGS, engine: "seedance-2-5" })
      expect(calls.map((c) => (c.payload as { engine?: string }).engine)).toEqual(["seedance-2-5", "seedance-2-5", "seedance-2-5"])
    } finally {
      _resetPluginSupportsForTests()
    }
  })

  it("answers the quote's engine by its public id and name, whichever vocabulary the engine answered in", async () => {
    for (const [answered, engine, engineName] of [
      [undefined, "nodaro-prism", "Nodaro Prism"],
      ["seedance-2-5", "nodaro-prism", "Nodaro Prism"],
      ["motion-pro", "nodaro-prism", "Nodaro Prism"],
      ["nodaro-prism", "nodaro-prism", "Nodaro Prism"],
      ["kling-4", "nodaro-pulse", "Nodaro Pulse"],
      ["motion-lite", "nodaro-pulse", "Nodaro Pulse"],
      ["nodaro-pulse", "nodaro-pulse", "Nodaro Pulse"],
    ] as const) {
      const { fastify } = stubFastify({ "/v1/video-remake/estimate": { statusCode: 200, body: { ...QUOTE, ...(answered ? { engine: answered } : {}) } } })
      const res = await callTool(serverWith(fastify), "video_remake", ARGS)
      expect(res.structuredContent).toMatchObject({ engine, engineName, confirmed: false })
      expect(res.content[0]!.text).toContain(`This ${engineName} preview costs`)
    }
  })

  // An older engine declares the internal ids; 0.394.0 – 0.397.0 the earlier public ids with
  // `engineAliases` (and records and quotes them); a newer one the current public ids alone.
  for (const declared of [
    { engines: ["seedance-2-5", "kling-4"], answers: "kling-4" },
    { engines: ["motion-pro", "motion-lite", "seedance-2-5", "kling-4"], engineAliases: true, answers: "motion-lite" },
    { engines: ["nodaro-prism", "nodaro-pulse"], engineAliases: true, answers: "nodaro-pulse" },
  ]) {
    describe(`on an engine that declares ${declared.engines.join(" + ")}`, () => {
      beforeEach(() => setPluginSupports({ castSwap: declared as never }))
      afterEach(() => _resetPluginSupportsForTests())

      it("quotes a nodaro-pulse run (expected = hold) as one price, named Nodaro Pulse, with nothing held beside it", async () => {
        const lite = { engine: declared.answers, totalCredits: 420, expectedCredits: 420, breakdown: { castSwap: 40, kling: 380, references: 0 }, settlesLower: false }
        const { fastify } = stubFastify({ "/v1/video-remake/estimate": { statusCode: 200, body: lite } })
        const res = await callTool(serverWith(fastify), "video_remake", { ...ARGS, preview: false, engine: "nodaro-pulse" })
        expect(res.structuredContent).toEqual({ engine: "nodaro-pulse", engineName: "Nodaro Pulse", totalCredits: 420, expectedCredits: 420, breakdown: { base: 40, references: 0, motion: 380 }, settlesLower: false, confirmed: false })
        expect(res.content[0]!.text).toContain("This Nodaro Pulse run costs about 420 credits.")
        expect(res.content[0]!.text).not.toMatch(/held|lower|kling/i)
      })

      it("sends engine to the route as the internal id, public or older id alike (quote and run), and no engine key without it", async () => {
        const { fastify, calls } = stubFastify({
          "/v1/video-remake/estimate": { statusCode: 200, body: QUOTE },
          "/v1/video-remake": { statusCode: 202, body: { jobId: "job-k" } },
        })
        // motion_length, or the deprecated kling_length from an older client.
        for (const [engine, length] of [["nodaro-pulse", "motion_length"], ["motion-lite", "motion_length"], ["kling-4", "kling_length"]]) {
          await callTool(serverWith(fastify), "video_remake", { ...ARGS, engine, resolution: "1080p", [length!]: "cut-start" })
          await callTool(serverWith(fastify), "video_remake", { ...ARGS, engine, resolution: "1080p", [length!]: "cut-start", confirm: true })
        }
        expect(calls).toHaveLength(6)
        // Sent as motionLength only where the engine takes Video Remake's names; an older one knows klingLength alone.
        const lengthKey = declared.engineAliases ? "motionLength" : "klingLength"
        for (const c of calls) expect(c.payload).toEqual({ ...BODY, engine: "kling-4", resolution: "1080p", [lengthKey]: "cut-start" })
        calls.length = 0
        await callTool(serverWith(fastify), "video_remake", ARGS)
        expect("engine" in (calls[0]!.payload as Record<string, unknown>)).toBe(false)
      })

      it("refuses an engine it does not know before calling the route; leaves draft on nodaro-pulse to the route", async () => {
        const { fastify, calls } = stubFastify({ "/v1/video-remake/estimate": { statusCode: 400, body: { error: { code: "draft_unsupported", message: "Nodaro Pulse has no draft." } } } })
        expect((await callTool(serverWith(fastify), "video_remake", { ...ARGS, engine: "kling-3" })).isError).toBe(true)
        expect((await callTool(serverWith(fastify), "video_remake", { ...ARGS, engine: "motion-max" })).isError).toBe(true)
        expect((await callTool(serverWith(fastify), "video_remake", { ...ARGS, engine: "nodaro-pulse", motion_length: "pad" })).isError).toBe(true)
        expect(calls).toEqual([])
        const res = await callTool(serverWith(fastify), "video_remake", { ...ARGS, engine: "nodaro-pulse", draft: true })
        expect(res.isError).toBe(true)
        expect(res.content[0]!.text).toContain("draft_unsupported")
        expect(calls[0]!.payload).toMatchObject({ engine: "kling-4", draft: true })
      })
    })
  }

  describe("the Flash choices (nodaro-prism-flash, nodaro-pulse-flash)", () => {
    beforeEach(() => setPluginSupports({ castSwap: { engines: ["nodaro-prism", "nodaro-pulse", "nodaro-prism-flash", "nodaro-pulse-flash"], engineAliases: true, flashChoices: true } as never }))
    afterEach(() => _resetPluginSupportsForTests())

    it("sends a Flash choice to the route as it is (quote and run), and names the quote by the choice", async () => {
      const flash = { engine: "nodaro-pulse-flash", totalCredits: 300, expectedCredits: 300, breakdown: { base: 40, references: 0, motion: 260 }, settlesLower: false }
      const { fastify, calls } = stubFastify({
        "/v1/video-remake/estimate": { statusCode: 200, body: flash },
        "/v1/video-remake": { statusCode: 202, body: { jobId: "job-f" } },
      })
      const res = await callTool(serverWith(fastify), "video_remake", { ...ARGS, preview: false, engine: "nodaro-pulse-flash" })
      expect(res.structuredContent).toMatchObject({ engine: "nodaro-pulse-flash", engineName: "Nodaro Pulse Flash", totalCredits: 300, confirmed: false })
      expect(res.content[0]!.text).toContain("This Nodaro Pulse Flash run costs about 300 credits.")
      await callTool(serverWith(fastify), "video_remake", { ...ARGS, preview: false, engine: "nodaro-pulse-flash", confirm: true })
      expect(calls.map((c) => (c.payload as { engine?: unknown }).engine)).toEqual(["nodaro-pulse-flash", "nodaro-pulse-flash"])
    })

    it("a refusal the route answers (not offered) is the tool's answer", async () => {
      const { fastify } = stubFastify({
        "/v1/video-remake/estimate": { statusCode: 409, body: { error: { code: "flash_not_offered", message: "Nodaro Prism Flash isn't available right now. Choose Nodaro Prism." } } },
      })
      const res = await callTool(serverWith(fastify), "video_remake", { ...ARGS, engine: "nodaro-prism-flash" })
      expect(res.isError).toBe(true)
      expect(res.content[0]!.text).toContain("flash_not_offered")
    })

    it("every rule of the tool reads a Flash choice as its engine: an art style on Nodaro Pulse Flash is Pulse's refusal", async () => {
      const { fastify, calls } = stubFastify({ "/v1/video-remake/estimate": { statusCode: 200, body: QUOTE } })
      const pulse = await callTool(serverWith(fastify), "video_remake", { ...ARGS, engine: "nodaro-pulse", art_style: "pop-art" })
      const flash = await callTool(serverWith(fastify), "video_remake", { ...ARGS, engine: "nodaro-pulse-flash", art_style: "pop-art" })
      expect(flash.isError).toBe(pulse.isError)
      expect(calls.length === 0 || (calls.at(-1)!.payload as { engine?: unknown }).engine === "nodaro-pulse-flash").toBe(true)
    })
  })

  it("names the credits of a retry that Nodaro's setting charges only if the clip is refused, never naming masking", async () => {
    const auto = { totalCredits: 12, breakdown: { castSwap: 5, seedance: 7, references: 0, masking: 4 }, maskingCredits: 4, settlesLower: false }
    const { fastify } = stubFastify({ "/v1/video-remake/estimate": { statusCode: 200, body: auto } })
    const res = await callTool(serverWith(fastify), "video_remake", ARGS)
    expect(res.content[0]!.text).toContain("12 credits")
    expect(res.content[0]!.text).toMatch(/retried once, for 4 more credits charged only then/)
    expect(res.content[0]!.text).not.toMatch(/mask|blur|depth|seedance|kling/i)
    expect(res.structuredContent).toMatchObject({ totalCredits: 12, privacyCredits: 4, breakdown: { base: 5, motion: 7, references: 0, privacy: 4 }, confirmed: false })
    expect(JSON.stringify(res.structuredContent)).not.toMatch(/seedance|kling|masking|Motion (Pro|Lite)\b|motion-(pro|lite)\b/i)
  })

  it("reads the neutral key names first (an engine that sends both), and the old ones from an older engine", async () => {
    const both = {
      totalCredits: 12, breakdown: { castSwap: 99, base: 5, seedance: 99, motion: 7, references: 0, masking: 9, privacy: 4 },
      maskingCredits: 9, privacyCredits: 4, settlesLower: false,
    }
    const fresh = { totalCredits: 12, breakdown: { base: 5, motion: 7, references: 0, privacy: 4 }, privacyCredits: 4, settlesLower: false }
    // Before 0.396.0 the base fee is castSwap only.
    const castSwapOnly = { ...fresh, breakdown: { castSwap: 5, motion: 7, references: 0, privacy: 4 } }
    for (const body of [both, fresh, castSwapOnly]) {
      const { fastify } = stubFastify({ "/v1/video-remake/estimate": { statusCode: 200, body } })
      const res = await callTool(serverWith(fastify), "video_remake", ARGS)
      expect(res.structuredContent).toEqual({ ...PRO, totalCredits: 12, breakdown: { base: 5, motion: 7, references: 0, privacy: 4 }, privacyCredits: 4, settlesLower: false, confirmed: false })
      expect(res.content[0]!.text).toMatch(/for 4 more credits/)
      expect(JSON.stringify(res.structuredContent)).not.toContain("castSwap")
    }
  })

  it("says nothing more when the setting's charge is already in the totals, or there is none", async () => {
    const always = { totalCredits: 16, breakdown: { castSwap: 5, seedance: 7, references: 0, masking: 4 }, settlesLower: false }
    for (const body of [always, QUOTE, { ...QUOTE, maskingCredits: 0 }]) {
      const { fastify } = stubFastify({ "/v1/video-remake/estimate": { statusCode: 200, body } })
      const text = (await callTool(serverWith(fastify), "video_remake", ARGS)).content[0]!.text
      expect(text).not.toMatch(/retried|mask/i)
    }
  })

  it("still passes the deprecated quality through", async () => {
    const { fastify, calls } = stubFastify({ "/v1/video-remake/estimate": { statusCode: 200, body: QUOTE } })
    await callTool(serverWith(fastify), "video_remake", { ...ARGS, quality: "draft" })
    expect(calls[0]!.payload).toEqual({ ...BODY, quality: "draft" })
  })

  it("runs with confirm and returns jobId", async () => {
    const { fastify, calls } = stubFastify({ "/v1/video-remake": { statusCode: 202, body: { jobId: "job-9" } } })
    const res = await callTool(serverWith(fastify), "video_remake", { ...ARGS, confirm: true, client_request_id: "retry-token-1" })

    expect(res.isError).toBeFalsy()
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(["POST /v1/video-remake"])
    expect(calls[0]!.payload).toEqual(BODY)
    expect(calls[0]!.headers?.["idempotency-key"]).toBe("mcp:retry-token-1")
    expect(res.structuredContent).toEqual({ jobId: "job-9", confirmed: true })
    expect(res.content[0]!.text).toContain("job-9")
    expect(res.content[0]!.text).toContain("wait_for_job")
  })

  it("passes a route refusal back as a tool error", async () => {
    const { fastify } = stubFastify({
      "/v1/video-remake/estimate": {
        statusCode: 400,
        body: { error: { code: "validation_error", message: "The clip must be 4–30 seconds long." } },
      },
    })
    const res = await callTool(serverWith(fastify), "video_remake", ARGS)
    expect(res.isError).toBe(true)
    expect(res.content[0]!.text).toContain("The clip must be 4–30 seconds long.")
  })

  it("answers not_available where the plugin's routes are not served", async () => {
    const { fastify } = stubFastify({})
    for (const confirm of [false, true]) {
      const res = await callTool(serverWith(fastify), "video_remake", { ...ARGS, confirm })
      expect(res.isError).toBe(true)
      expect(res.content[0]!.text).toContain("not_available")
      expect(res.content[0]!.text).toContain("not served on this deployment")
    }
  })

  it("is not offered to a session that may not execute", async () => {
    const { fastify } = stubFastify({})
    const names = (await listTools(serverWith(fastify, ["workflows:read"]))).map((t) => t.name)
    expect(names).not.toContain("video_remake")
  })
})

describe("video_remake's session_id reaches the job", () => {
  const OWN = "00000000-0000-4000-8000-0000000005e1"
  const FOREIGN = "00000000-0000-4000-8000-0000000005e2"
  db.ownSession = OWN

  /** A real app: the internal hop as the auth hook sets it, and a /v1/video-remake that files its job through the funnel's session read. */
  async function realApp(seen: { sessionId?: string | null }) {
    const app = Fastify({ logger: false })
    app.addHook("preHandler", async (req) => {
      if (req.headers["x-internal-orchestrator-secret"] === config.INTERNAL_ORCHESTRATOR_SECRET) {
        req.authKind = "internal"
        req.isInternalCall = true
        req.userId = req.headers["x-internal-user-id"] as string
      }
    })
    app.post("/v1/video-remake", async (req, reply) => {
      try {
        seen.sessionId = await resolveRequestSession(req)
      } catch (err) {
        return sendInternalError(reply, req, err, "cast swap")
      }
      return reply.status(202).send({ jobId: "job-9" })
    })
    await app.ready()
    return app
  }

  it("files the run in the caller's own session", async () => {
    const seen: { sessionId?: string | null } = {}
    const app = await realApp(seen)
    const res = await callTool(serverWith(app, ["workflows:execute", "assets:write"]), "video_remake", { ...ARGS, session_id: OWN, confirm: true })
    expect(res.isError).toBeFalsy()
    expect(seen.sessionId).toBe(OWN)
    await app.close()
  })

  it("a session that is not the caller's is the route's 404, as a tool error", async () => {
    const seen: { sessionId?: string | null } = {}
    const app = await realApp(seen)
    const res = await callTool(serverWith(app, ["workflows:execute", "assets:write"]), "video_remake", { ...ARGS, session_id: FOREIGN, confirm: true })
    expect(res.isError).toBe(true)
    expect(res.content[0]!.text).toContain("not_found")
    expect(seen.sessionId).toBeUndefined()
    await app.close()
  })

  it("a grant without assets:write may not file it, even in the caller's own session: the route's 404", async () => {
    const seen: { sessionId?: string | null } = {}
    const app = await realApp(seen)
    const res = await callTool(serverWith(app, ["workflows:execute"]), "video_remake", { ...ARGS, session_id: OWN, confirm: true })
    expect(res.isError).toBe(true)
    expect(res.content[0]!.text).toContain("not_found")
    expect(seen.sessionId).toBeUndefined()
    await app.close()
  })

  it("without session_id the run is filed in none", async () => {
    const seen: { sessionId?: string | null } = {}
    const app = await realApp(seen)
    const { session_id: _s, ...noSession } = ARGS
    const res = await callTool(serverWith(app), "video_remake", { ...noSession, confirm: true })
    expect(res.isError).toBeFalsy()
    expect(seen.sessionId).toBeNull()
    await app.close()
  })
})

describe("video_remake is gated on the edition", () => {
  async function names(credits: boolean) {
    h.credits = credits
    const server = await buildMcpServer({ userId: "u1", scopes: ["workflows:execute"], clientName: "Claude", fastify: Fastify() })
    return (await listTools(server)).map((t) => t.name)
  }

  it("is not registered without credits", async () => {
    const off = await names(false)
    expect(off).not.toContain("video_remake")
    expect(off).toContain("ping")
  })

  it("is registered on Nodaro Cloud", async () => {
    expect(await names(true)).toContain("video_remake")
  })
})

describe("video_remake: the intent check (check_intent) and the run's intent", () => {
  const JOB = { jobId: "00000000-0000-4000-8000-0000000000a1" }
  const MISMATCH = { checked: true, fits: false, code: "wants-extend" }

  it("the quote checks the words only when asked, beside the estimate, with the same body", async () => {
    const { fastify, calls } = stubFastify({
      "/v1/video-remake/estimate": { statusCode: 200, body: QUOTE },
      "/v1/video-remake/intent": { statusCode: 200, body: MISMATCH },
    })
    const plain = await callTool(serverWith(fastify), "video_remake", ARGS)
    expect(calls.map((c) => c.url)).toEqual(["/v1/video-remake/estimate"])
    expect(plain.structuredContent).not.toHaveProperty("intent")
    calls.length = 0

    const res = await callTool(serverWith(fastify), "video_remake", { ...ARGS, check_intent: true })
    expect(res.isError).toBeFalsy()
    expect(calls.map((c) => c.url).sort()).toEqual(["/v1/video-remake/estimate", "/v1/video-remake/intent"])
    for (const c of calls) expect(c.payload).toEqual(BODY)
    expect(res.structuredContent).toMatchObject({ totalCredits: 12, confirmed: false, intent: { code: "wants-extend", meaning: expect.any(String) } })
    expect(res.content[0]!.text).toContain("wants-extend")
    expect(res.content[0]!.text).toContain('intent: { code: "wants-extend", action: "continued" }')
  })

  it("anything but a confident mismatch with a known code is no answer: the quote is as before", async () => {
    for (const intent of [
      { statusCode: 200, body: { checked: false, fits: true } },
      { statusCode: 200, body: { checked: true, fits: true } },
      { statusCode: 200, body: { checked: true, fits: false, code: "wants-something-new" } },
      { statusCode: 200, body: "not json" },
      { statusCode: 429, body: { error: { code: "rate_limit_exceeded", message: "Too many requests." } } },
      { statusCode: 403, body: { error: { code: "node_not_available", message: "No." } } },
    ]) {
      const { fastify } = stubFastify({ "/v1/video-remake/estimate": { statusCode: 200, body: QUOTE }, "/v1/video-remake/intent": intent })
      const res = await callTool(serverWith(fastify), "video_remake", { ...ARGS, check_intent: true })
      expect(res.isError, JSON.stringify(intent)).toBeFalsy()
      expect(res.structuredContent, JSON.stringify(intent)).toEqual({ ...PRO, totalCredits: 12, breakdown: { base: 5, references: 0, motion: 7 }, settlesLower: false, confirmed: false })
    }
    // A host without the route (the router's 404) is no answer too.
    const { fastify } = stubFastify({ "/v1/video-remake/estimate": { statusCode: 200, body: QUOTE } })
    expect((await callTool(serverWith(fastify), "video_remake", { ...ARGS, check_intent: true })).structuredContent).not.toHaveProperty("intent")
  })

  it("the confirmed run sends intent as given, and never checks; the quote never sends intent", async () => {
    const { fastify, calls } = stubFastify({
      "/v1/video-remake/estimate": { statusCode: 200, body: QUOTE },
      "/v1/video-remake/intent": { statusCode: 200, body: MISMATCH },
      "/v1/video-remake": { statusCode: 202, body: JOB },
    })
    const intent = { code: "wants-extend", action: "continued" }
    await callTool(serverWith(fastify), "video_remake", { ...ARGS, intent })
    expect(calls[0]!.payload).toEqual(BODY)
    calls.length = 0
    const res = await callTool(serverWith(fastify), "video_remake", { ...ARGS, confirm: true, check_intent: true, intent })
    expect(res.isError).toBeFalsy()
    expect(calls.map((c) => c.url)).toEqual(["/v1/video-remake"])
    expect(calls[0]!.payload).toEqual({ ...BODY, intent })
  })

  it("refuses an intent that is not the route's shape", async () => {
    const { fastify, calls } = stubFastify({ "/v1/video-remake": { statusCode: 202, body: JOB } })
    for (const intent of [{ code: "x".repeat(41), action: "continued" }, { code: "wants-extend", action: "ignored" }]) {
      const res = await callTool(serverWith(fastify), "video_remake", { ...ARGS, confirm: true, intent })
      expect(res.isError, JSON.stringify(intent)).toBe(true)
    }
    expect(calls).toEqual([])
  })
})

describe("video_remake: the upscale choice", () => {
  afterEach(() => _resetPluginSupportsForTests())
  const run = { statusCode: 202, body: { jobId: "job-up" } }

  it("sends upscale to the quote and the run only where the loaded engine takes the choice", async () => {
    setPluginSupports({ castSwap: { upscaleChoice: true } as never })
    for (const upscale of ["off", "next"] as const) {
      const { fastify, calls } = stubFastify({ "/v1/video-remake/estimate": { statusCode: 200, body: QUOTE }, "/v1/video-remake": run })
      await callTool(serverWith(fastify), "video_remake", { ...ARGS, upscale })
      await callTool(serverWith(fastify), "video_remake", { ...ARGS, upscale, confirm: true })
      expect(calls.map((c) => (c.payload as { upscale?: unknown }).upscale), upscale).toEqual([upscale, upscale])
    }
  })

  it("drops it, quote and run alike, where the engine does not take it (an engine from before it, or a deployment that has not turned it on)", async () => {
    for (const castSwap of [undefined, {}, { upscaleChoice: false }]) {
      _resetPluginSupportsForTests()
      if (castSwap) setPluginSupports({ castSwap: castSwap as never })
      const { fastify, calls } = stubFastify({ "/v1/video-remake/estimate": { statusCode: 200, body: QUOTE }, "/v1/video-remake": run })
      await callTool(serverWith(fastify), "video_remake", { ...ARGS, upscale: "next" })
      await callTool(serverWith(fastify), "video_remake", { ...ARGS, upscale: "next", confirm: true })
      expect(calls.map((c) => c.payload), JSON.stringify(castSwap)).toEqual([BODY, BODY])
    }
  })

  it("refuses a value it does not list", async () => {
    setPluginSupports({ castSwap: { upscaleChoice: true } as never })
    const { fastify, calls } = stubFastify({ "/v1/video-remake/estimate": { statusCode: 200, body: QUOTE } })
    const res = await callTool(serverWith(fastify), "video_remake", { ...ARGS, upscale: "1080p" })
    expect(res.isError).toBe(true)
    expect(calls).toEqual([])
  })

  it("answers the engine's size, the delivered size, the choice and the offer, and says the upscale part", async () => {
    setPluginSupports({ castSwap: { upscaleChoice: true } as never })
    const quote = { totalCredits: 20, breakdown: { base: 5, motion: 7, references: 0, upscale: 8 }, settlesLower: false, resolution: "480p", outputResolution: "720p", upscale: "next", upscaleOffered: true }
    const { fastify } = stubFastify({ "/v1/video-remake/estimate": { statusCode: 200, body: quote } })
    const res = await callTool(serverWith(fastify), "video_remake", ARGS)
    expect(res.structuredContent).toEqual({ ...PRO, totalCredits: 20, breakdown: { base: 5, motion: 7, references: 0, upscale: 8 }, settlesLower: false, resolution: "480p", outputResolution: "720p", upscale: "next", upscaleOffered: true, confirmed: false })
    expect(res.content[0]!.text).toContain("delivered upscaled to 720p, which adds 8 credits")
    expect(res.content[0]!.text).toContain('upscale: "off" keeps 480p')
  })

  it("says a 1080p run is delivered at 4K, and keeps \"4k\" as the engine spells it", async () => {
    setPluginSupports({ castSwap: { upscaleChoice: true } as never })
    const quote = { totalCredits: 20, breakdown: { base: 5, motion: 7, references: 0, upscale: 8 }, settlesLower: false, resolution: "1080p", outputResolution: "4k", upscale: "next", upscaleOffered: true }
    const { fastify } = stubFastify({ "/v1/video-remake/estimate": { statusCode: 200, body: quote } })
    const res = await callTool(serverWith(fastify), "video_remake", { ...ARGS, resolution: "1080p" })
    expect(res.structuredContent).toMatchObject({ resolution: "1080p", outputResolution: "4k", upscale: "next", upscaleOffered: true })
    expect(res.content[0]!.text).toContain("delivered upscaled to 4K, which adds 8 credits")
    expect(res.content[0]!.text).toContain('upscale: "off" keeps 1080p')
  })

  it("says the choice is offered on an \"off\" quote where it is, and nothing where it is not", async () => {
    setPluginSupports({ castSwap: { upscaleChoice: true } as never })
    const off = { ...QUOTE, resolution: "720p", outputResolution: "720p", upscale: "off", upscaleOffered: true }
    let { fastify } = stubFastify({ "/v1/video-remake/estimate": { statusCode: 200, body: off } })
    let res = await callTool(serverWith(fastify), "video_remake", { ...ARGS, upscale: "off" })
    expect(res.content[0]!.text).toContain('upscale: "next"')
    ;({ fastify } = stubFastify({ "/v1/video-remake/estimate": { statusCode: 200, body: { ...off, resolution: "1080p", outputResolution: "1080p", upscaleOffered: false } } }))
    res = await callTool(serverWith(fastify), "video_remake", ARGS)
    expect(res.content[0]!.text).not.toContain("upscale")
    expect(res.structuredContent).toMatchObject({ resolution: "1080p", outputResolution: "1080p", upscale: "off", upscaleOffered: false })
  })

  it("keeps only the contract's values of the fields, and adds none for an engine that answers none", async () => {
    const odd = { ...QUOTE, resolution: "4k", outputResolution: 720, upscale: "applied", upscaleOffered: "yes" }
    const { fastify } = stubFastify({ "/v1/video-remake/estimate": { statusCode: 200, body: odd } })
    const res = await callTool(serverWith(fastify), "video_remake", ARGS)
    expect(res.structuredContent).toEqual({ ...PRO, totalCredits: 12, breakdown: { base: 5, references: 0, motion: 7 }, settlesLower: false, confirmed: false })
  })
})
