import Fastify, { type FastifyInstance } from "fastify"
import { describe, expect, it, vi } from "vitest"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool, listTools } from "./_helpers.js"

/**
 * `cast_swap` — the MCP face of `POST /v1/cast-swap` (Cloud plugin).
 *
 * The contracts under test:
 *  - without `confirm` it quotes (`/v1/cast-swap/estimate`) and never runs;
 *  - with `confirm: true` it runs (`/v1/cast-swap`) and hands back the job id,
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

const { registerCastSwapTools } = await import("../cast-swap.js")
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

describe("cast_swap", () => {
  it("quotes without confirm and does not run", async () => {
    const { fastify, calls } = stubFastify({ "/v1/cast-swap/estimate": { statusCode: 200, body: QUOTE } })
    const res = await callTool(serverWith(fastify), "cast_swap", ARGS)

    expect(res.isError).toBeFalsy()
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(["POST /v1/cast-swap/estimate"])
    expect(calls[0]!.payload).toEqual(BODY)
    expect(res.structuredContent).toEqual({ ...QUOTE, confirmed: false })
    expect(res.content[0]!.text).toContain("12 credits")
    expect(res.content[0]!.text).toContain("confirm: true")
  })

  it("says when the final charge is expected to come out lower", async () => {
    const { fastify } = stubFastify({ "/v1/cast-swap/estimate": { statusCode: 200, body: { ...QUOTE, settlesLower: true } } })
    const res = await callTool(serverWith(fastify), "cast_swap", ARGS)
    expect(res.content[0]!.text).toMatch(/lower/)
  })

  it("names the reference preparation in the quote when it costs something", async () => {
    const withPrep = { totalCredits: 15, breakdown: { castSwap: 5, seedance: 7, references: 3 }, settlesLower: false }
    const { fastify } = stubFastify({ "/v1/cast-swap/estimate": { statusCode: 200, body: withPrep } })
    const res = await callTool(serverWith(fastify), "cast_swap", ARGS)
    expect(res.content[0]!.text).toContain("15 credits")
    expect(res.content[0]!.text).toMatch(/3 credits?[^.]*prepar/i)
    expect(res.content[0]!.text).toContain("prepare_references: false")
    expect(res.structuredContent).toEqual({ ...withPrep, confirmed: false })
  })

  it("says nothing of the preparation when it costs nothing", async () => {
    const { fastify } = stubFastify({ "/v1/cast-swap/estimate": { statusCode: 200, body: QUOTE } })
    const res = await callTool(serverWith(fastify), "cast_swap", ARGS)
    expect(res.content[0]!.text).not.toMatch(/prepar/i)
  })

  it("sends pet and product roles, their preview settings, resolution, draft and prepare_references to the route in camelCase", async () => {
    const { fastify, calls } = stubFastify({ "/v1/cast-swap/estimate": { statusCode: 200, body: QUOTE } })
    const res = await callTool(serverWith(fastify), "cast_swap", {
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

  it("sends fixed references to the route as given", async () => {
    const { fastify, calls } = stubFastify({ "/v1/cast-swap/estimate": { statusCode: 200, body: QUOTE } })
    const references = [
      { images: ["https://cdn.example/glass.png"], line: "the glass she drinks from" },
      { images: ["https://cdn.example/sky.png", "https://cdn.example/sky2.png"], line: "Use {image} for the sky" },
    ]
    const res = await callTool(serverWith(fastify), "cast_swap", { ...ARGS, references })
    expect(res.isError).toBeFalsy()
    expect(calls[0]!.payload).toEqual({ ...BODY, references })
  })

  it("trims a reference's line, as the route does", async () => {
    const { fastify, calls } = stubFastify({ "/v1/cast-swap/estimate": { statusCode: 200, body: QUOTE } })
    const references = [{ images: ["https://cdn.example/glass.png"], line: "  the glass she drinks from \n" }]
    const res = await callTool(serverWith(fastify), "cast_swap", { ...ARGS, references })
    expect(res.isError).toBeFalsy()
    expect(calls[0]!.payload).toEqual({
      ...BODY,
      references: [{ images: ["https://cdn.example/glass.png"], line: "the glass she drinks from" }],
    })
  })

  it("refuses a reference the route would refuse, before any call", async () => {
    const { fastify, calls } = stubFastify({ "/v1/cast-swap/estimate": { statusCode: 200, body: QUOTE } })
    const server = serverWith(fastify)
    const cases: Array<[string, { images: string[]; line: string }]> = [
      ["a whitespace-only line", { images: ["https://cdn.example/glass.png"], line: "   " }],
      ["a non-http(s) image", { images: ["ftp://cdn.example/glass.png"], line: "the glass" }],
      ["a data: image", { images: ["data:image/png;base64,AAAA"], line: "the glass" }],
      ["an image URL over 4096 characters", { images: [`https://cdn.example/${"a".repeat(4096)}.png`], line: "the glass" }],
    ]
    for (const [what, reference] of cases) {
      const res = await callTool(server, "cast_swap", { ...ARGS, references: [reference] })
      expect(res.isError, what).toBe(true)
    }
    expect(calls).toHaveLength(0)
  })

  it("sends face_masking to the route as faceMasking, every key in camelCase", async () => {
    const { fastify, calls } = stubFastify({ "/v1/cast-swap/estimate": { statusCode: 200, body: QUOTE } })
    const res = await callTool(serverWith(fastify), "cast_swap", {
      ...ARGS,
      face_masking: {
        mode: "auto",
        fill: "depth",
        min_face_height_pct: 10,
        max_face_height_pct: 60,
        zone: { left_pct: 5, right_pct: 6, top_pct: 0, bottom_pct: 20 },
        blur_strength_pct: 3,
        threshold: 0.4,
      },
    })

    expect(res.isError).toBeFalsy()
    expect(calls[0]!.payload).toEqual({
      ...BODY,
      faceMasking: {
        mode: "auto",
        fill: "depth",
        minFaceHeightPct: 10,
        maxFaceHeightPct: 60,
        zone: { leftPct: 5, rightPct: 6, topPct: 0, bottomPct: 20 },
        blurStrengthPct: 3,
        threshold: 0.4,
      },
    })
  })

  it("sends only the face_masking keys given, so the route's defaults apply", async () => {
    const { fastify, calls } = stubFastify({ "/v1/cast-swap/estimate": { statusCode: 200, body: QUOTE } })
    await callTool(serverWith(fastify), "cast_swap", { ...ARGS, face_masking: { mode: "always", zone: { top_pct: 10 } } })
    expect(calls[0]!.payload).toEqual({ ...BODY, faceMasking: { mode: "always", zone: { topPct: 10 } } })
  })

  it("leaves a zone left out to the route's default margins, and sends zone: null as all four margins 0 (no margins)", async () => {
    const { fastify, calls } = stubFastify({ "/v1/cast-swap/estimate": { statusCode: 200, body: QUOTE } })
    await callTool(serverWith(fastify), "cast_swap", { ...ARGS, face_masking: { mode: "auto" } })
    expect(calls[0]!.payload).toEqual({ ...BODY, faceMasking: { mode: "auto" } })
    // Not null: an engine that predates zone: null refuses it, and reads all 0 as no margins.
    await callTool(serverWith(fastify), "cast_swap", { ...ARGS, face_masking: { mode: "auto", zone: null } })
    expect(calls[1]!.payload).toEqual({ ...BODY, faceMasking: { mode: "auto", zone: { leftPct: 0, rightPct: 0, topPct: 0, bottomPct: 0 } } })
  })

  it("sends no faceMasking key at all without face_masking", async () => {
    const { fastify, calls } = stubFastify({ "/v1/cast-swap/estimate": { statusCode: 200, body: QUOTE } })
    await callTool(serverWith(fastify), "cast_swap", ARGS)
    expect("faceMasking" in (calls[0]!.payload as Record<string, unknown>)).toBe(false)
  })

  it("refuses a face_masking value outside its range before calling the route", async () => {
    const { fastify, calls } = stubFastify({ "/v1/cast-swap/estimate": { statusCode: 200, body: QUOTE } })
    for (const face_masking of [
      { mode: "sometimes" },
      { mode: "auto", fill: "pixelate" },
      { mode: "auto", zone: { left_pct: 50 } },
      { mode: "auto", threshold: 1 },
      { mode: "auto", blur_strength_pct: 0 },
      { mode: "auto", min_face_height_pct: 101 },
    ]) {
      const res = await callTool(serverWith(fastify), "cast_swap", { ...ARGS, face_masking })
      expect(res.isError, JSON.stringify(face_masking)).toBe(true)
    }
    expect(calls).toEqual([])
  })

  it("names the masking credits that auto charges only if masking runs", async () => {
    const auto = { totalCredits: 12, breakdown: { castSwap: 5, seedance: 7, references: 0, masking: 4 }, maskingCredits: 4, settlesLower: false }
    const { fastify } = stubFastify({ "/v1/cast-swap/estimate": { statusCode: 200, body: auto } })
    const res = await callTool(serverWith(fastify), "cast_swap", { ...ARGS, face_masking: { mode: "auto" } })
    expect(res.content[0]!.text).toContain("12 credits")
    expect(res.content[0]!.text).toMatch(/4 more credits?[^.]*only if/i)
    expect(res.structuredContent).toEqual({ ...auto, confirmed: false })
  })

  it("names the masking included in the quote with always", async () => {
    const always = { totalCredits: 16, breakdown: { castSwap: 5, seedance: 7, references: 0, masking: 4 }, settlesLower: false }
    const { fastify } = stubFastify({ "/v1/cast-swap/estimate": { statusCode: 200, body: always } })
    const res = await callTool(serverWith(fastify), "cast_swap", { ...ARGS, face_masking: { mode: "always" } })
    expect(res.content[0]!.text).toContain("16 credits")
    expect(res.content[0]!.text).toMatch(/includes 4 credits?[^.]*mask/i)
    expect(res.content[0]!.text).not.toMatch(/only if/i)
  })

  it("words the masking by the mode asked for, not by which numbers the quote carries", async () => {
    const both = { totalCredits: 12, breakdown: { castSwap: 5, seedance: 7, references: 0, masking: 4 }, maskingCredits: 4, settlesLower: false }
    const onlyBreakdown = { totalCredits: 12, breakdown: { castSwap: 5, seedance: 7, references: 0, masking: 4 }, settlesLower: false }
    const text = async (body: unknown, args: Record<string, unknown>) => {
      const { fastify } = stubFastify({ "/v1/cast-swap/estimate": { statusCode: 200, body } })
      return (await callTool(serverWith(fastify), "cast_swap", { ...ARGS, ...args })).content[0]!.text
    }
    // auto: the retry wording, even when only the breakdown names the masking.
    const auto = await text(onlyBreakdown, { face_masking: { mode: "auto" } })
    expect(auto).toMatch(/4 more credits?[^.]*only if/i)
    expect(auto).not.toMatch(/includes 4/i)
    // always: the "included" wording, even when the quote also carries maskingCredits.
    const always = await text(both, { face_masking: { mode: "always" } })
    expect(always).toMatch(/includes 4 credits?[^.]*mask/i)
    expect(always).not.toMatch(/only if/i)
    // off, or no face_masking: nothing about masking.
    expect(await text(both, { face_masking: { mode: "off" } })).not.toMatch(/mask/i)
    expect(await text(both, {})).not.toMatch(/mask/i)
  })

  it("says nothing of masking when the quote has none", async () => {
    const { fastify } = stubFastify({ "/v1/cast-swap/estimate": { statusCode: 200, body: QUOTE } })
    const res = await callTool(serverWith(fastify), "cast_swap", ARGS)
    expect(res.content[0]!.text).not.toMatch(/mask/i)
  })

  it("still passes the deprecated quality through", async () => {
    const { fastify, calls } = stubFastify({ "/v1/cast-swap/estimate": { statusCode: 200, body: QUOTE } })
    await callTool(serverWith(fastify), "cast_swap", { ...ARGS, quality: "draft" })
    expect(calls[0]!.payload).toEqual({ ...BODY, quality: "draft" })
  })

  it("runs with confirm and returns jobId", async () => {
    const { fastify, calls } = stubFastify({ "/v1/cast-swap": { statusCode: 202, body: { jobId: "job-9" } } })
    const res = await callTool(serverWith(fastify), "cast_swap", { ...ARGS, confirm: true, client_request_id: "retry-token-1" })

    expect(res.isError).toBeFalsy()
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(["POST /v1/cast-swap"])
    expect(calls[0]!.payload).toEqual(BODY)
    expect(calls[0]!.headers?.["idempotency-key"]).toBe("mcp:retry-token-1")
    expect(res.structuredContent).toEqual({ jobId: "job-9", confirmed: true })
    expect(res.content[0]!.text).toContain("job-9")
    expect(res.content[0]!.text).toContain("wait_for_job")
  })

  it("passes a route refusal back as a tool error", async () => {
    const { fastify } = stubFastify({
      "/v1/cast-swap/estimate": {
        statusCode: 400,
        body: { error: { code: "validation_error", message: "The clip must be 4–30 seconds long." } },
      },
    })
    const res = await callTool(serverWith(fastify), "cast_swap", ARGS)
    expect(res.isError).toBe(true)
    expect(res.content[0]!.text).toContain("The clip must be 4–30 seconds long.")
  })

  it("answers not_available where the plugin's routes are not served", async () => {
    const { fastify } = stubFastify({})
    for (const confirm of [false, true]) {
      const res = await callTool(serverWith(fastify), "cast_swap", { ...ARGS, confirm })
      expect(res.isError).toBe(true)
      expect(res.content[0]!.text).toContain("not_available")
      expect(res.content[0]!.text).toContain("not served on this deployment")
    }
  })

  it("is not offered to a session that may not execute", async () => {
    const { fastify } = stubFastify({})
    const names = (await listTools(serverWith(fastify, ["workflows:read"]))).map((t) => t.name)
    expect(names).not.toContain("cast_swap")
  })
})

describe("cast_swap's session_id reaches the job", () => {
  const OWN = "00000000-0000-4000-8000-0000000005e1"
  const FOREIGN = "00000000-0000-4000-8000-0000000005e2"
  db.ownSession = OWN

  /** A real app: the internal hop as the auth hook sets it, and a /v1/cast-swap that files its job through the funnel's session read. */
  async function realApp(seen: { sessionId?: string | null }) {
    const app = Fastify({ logger: false })
    app.addHook("preHandler", async (req) => {
      if (req.headers["x-internal-orchestrator-secret"] === config.INTERNAL_ORCHESTRATOR_SECRET) {
        req.authKind = "internal"
        req.isInternalCall = true
        req.userId = req.headers["x-internal-user-id"] as string
      }
    })
    app.post("/v1/cast-swap", async (req, reply) => {
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
    const res = await callTool(serverWith(app, ["workflows:execute", "assets:write"]), "cast_swap", { ...ARGS, session_id: OWN, confirm: true })
    expect(res.isError).toBeFalsy()
    expect(seen.sessionId).toBe(OWN)
    await app.close()
  })

  it("a session that is not the caller's is the route's 404, as a tool error", async () => {
    const seen: { sessionId?: string | null } = {}
    const app = await realApp(seen)
    const res = await callTool(serverWith(app, ["workflows:execute", "assets:write"]), "cast_swap", { ...ARGS, session_id: FOREIGN, confirm: true })
    expect(res.isError).toBe(true)
    expect(res.content[0]!.text).toContain("not_found")
    expect(seen.sessionId).toBeUndefined()
    await app.close()
  })

  it("a grant without assets:write may not file it, even in the caller's own session: the route's 404", async () => {
    const seen: { sessionId?: string | null } = {}
    const app = await realApp(seen)
    const res = await callTool(serverWith(app, ["workflows:execute"]), "cast_swap", { ...ARGS, session_id: OWN, confirm: true })
    expect(res.isError).toBe(true)
    expect(res.content[0]!.text).toContain("not_found")
    expect(seen.sessionId).toBeUndefined()
    await app.close()
  })

  it("without session_id the run is filed in none", async () => {
    const seen: { sessionId?: string | null } = {}
    const app = await realApp(seen)
    const { session_id: _s, ...noSession } = ARGS
    const res = await callTool(serverWith(app), "cast_swap", { ...noSession, confirm: true })
    expect(res.isError).toBeFalsy()
    expect(seen.sessionId).toBeNull()
    await app.close()
  })
})

describe("cast_swap is gated on the edition", () => {
  async function names(credits: boolean) {
    h.credits = credits
    const server = await buildMcpServer({ userId: "u1", scopes: ["workflows:execute"], clientName: "Claude", fastify: Fastify() })
    return (await listTools(server)).map((t) => t.name)
  }

  it("is not registered without credits", async () => {
    const off = await names(false)
    expect(off).not.toContain("cast_swap")
    expect(off).toContain("ping")
  })

  it("is registered on Nodaro Cloud", async () => {
    expect(await names(true)).toContain("cast_swap")
  })
})
