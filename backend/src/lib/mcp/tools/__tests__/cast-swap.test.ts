import Fastify, { type FastifyInstance } from "fastify"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { newSession } from "../../session.js"
import { _resetPluginSupportsForTests, setPluginSupports } from "../../../private-plugins/supports-registry.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool, listTools } from "./_helpers.js"

/**
 * `cast_swap` — the MCP face of `POST /v1/cast-swap` (Nodaro Motion, Cloud plugin).
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
/** What the tool adds to a quote that names no engine (an older engine's: Nodaro Motion Pro). */
const PRO = { engine: "motion-pro", engineName: "Nodaro Motion Pro" }

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
    expect(res.structuredContent).toEqual({ ...PRO, totalCredits: 12, breakdown: { castSwap: 5, references: 0, motion: 7 }, settlesLower: false, confirmed: false })
    expect(res.content[0]!.text).toContain("12 credits")
    expect(res.content[0]!.text).toContain("confirm: true")
  })

  it("says when the final charge is expected to come out lower", async () => {
    const { fastify } = stubFastify({ "/v1/cast-swap/estimate": { statusCode: 200, body: { ...QUOTE, settlesLower: true } } })
    const res = await callTool(serverWith(fastify), "cast_swap", ARGS)
    expect(res.content[0]!.text).toMatch(/lower/)
  })

  it("names the expected charge and the hold when the engine answers both", async () => {
    const quote = {
      totalCredits: 40,
      expectedCredits: 31,
      breakdown: { castSwap: 5, seedance: 32, seedanceExpected: 23, references: 3 },
      settlesLower: true,
    }
    const { fastify } = stubFastify({ "/v1/cast-swap/estimate": { statusCode: 200, body: quote } })
    const res = await callTool(serverWith(fastify), "cast_swap", ARGS)
    expect(res.content[0]!.text).toContain("costs about 31 credits (up to 40 held while it runs).")
    // The expected charge already is the lower figure: no "lower than this quote" after it.
    expect(res.content[0]!.text).not.toMatch(/lower than this quote/)
    expect(res.structuredContent).toEqual({
      ...PRO,
      totalCredits: 40,
      expectedCredits: 31,
      // The engine's old key names are answered by their neutral ones.
      breakdown: { castSwap: 5, references: 3, motion: 32, motionExpected: 23 },
      settlesLower: true,
      confirmed: false,
    })
  })

  it("names the reference preparation in the quote when it costs something", async () => {
    const withPrep = { totalCredits: 15, breakdown: { castSwap: 5, seedance: 7, references: 3 }, settlesLower: false }
    const { fastify } = stubFastify({ "/v1/cast-swap/estimate": { statusCode: 200, body: withPrep } })
    const res = await callTool(serverWith(fastify), "cast_swap", ARGS)
    expect(res.content[0]!.text).toContain("15 credits")
    expect(res.content[0]!.text).toMatch(/3 credits?[^.]*prepar/i)
    expect(res.content[0]!.text).toContain("prepare_references: false")
    expect(res.structuredContent).toEqual({ ...PRO, totalCredits: 15, breakdown: { castSwap: 5, references: 3, motion: 7 }, settlesLower: false, confirmed: false })
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

  it("accepts face_masking from an older client and ignores it: nothing of it reaches the route (Nodaro sets it per engine)", async () => {
    const { fastify, calls } = stubFastify({
      "/v1/cast-swap/estimate": { statusCode: 200, body: QUOTE },
      "/v1/cast-swap": { statusCode: 202, body: { jobId: "job-fm" } },
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
        const res = await callTool(server, "cast_swap", { ...ARGS, face_masking, ...(confirm ? { confirm } : {}) })
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
    const tool = (await listTools(serverWith(fastify))).find((t) => t.name === "cast_swap")!
    expect(Object.keys((tool.inputSchema as { properties: Record<string, unknown> }).properties)).not.toContain("face_masking")
    expect(Object.keys((tool.inputSchema as { properties: Record<string, unknown> }).properties)).not.toContain("kling_length")
    expect(JSON.stringify(tool)).not.toMatch(/mask|blur|depth|seedance|kling|SAM\b/i)
  })

  it("takes an older client's kling_length as motion_length (unlisted), and refuses one that is not a length fit", async () => {
    const { fastify, calls } = stubFastify({ "/v1/cast-swap/estimate": { statusCode: 200, body: QUOTE } })
    await callTool(serverWith(fastify), "cast_swap", { ...ARGS, kling_length: "cut-start" })
    expect(calls[0]!.payload).toEqual({ ...BODY, klingLength: "cut-start" })
    // motion_length wins over it.
    await callTool(serverWith(fastify), "cast_swap", { ...ARGS, motion_length: "cut-end", kling_length: "cut-start" })
    expect(calls[1]!.payload).toEqual({ ...BODY, klingLength: "cut-end" })
    const bad = await callTool(serverWith(fastify), "cast_swap", { ...ARGS, kling_length: "pad" })
    expect(bad.isError).toBe(true)
    expect(calls).toHaveLength(2)
  })

  it("refuses a motion-lite run (or the old kling-4 id), sending nothing, where the loaded engine does not declare it (an older engine would run Pro)", async () => {
    const { fastify, calls } = stubFastify({ "/v1/cast-swap/estimate": { statusCode: 200, body: QUOTE } })
    for (const castSwap of [undefined, { engines: ["seedance-2-5" as const] }, { engines: ["motion-pro" as const], engineAliases: true }]) {
      _resetPluginSupportsForTests()
      if (castSwap) setPluginSupports({ castSwap: castSwap as never })
      for (const engine of ["motion-lite", "kling-4"]) {
        for (const confirm of [undefined, true]) {
          const res = await callTool(serverWith(fastify), "cast_swap", { ...ARGS, engine, ...(confirm ? { confirm } : {}) })
          expect(res.isError).toBe(true)
          expect(res.content[0]!.text).toContain("engine_unavailable")
          expect(res.content[0]!.text).not.toMatch(/kling/i)
        }
      }
    }
    expect(calls).toEqual([])
    // Pro named outright, by either id, still runs anywhere, sent as the internal id.
    await callTool(serverWith(fastify), "cast_swap", { ...ARGS, engine: "motion-pro" })
    await callTool(serverWith(fastify), "cast_swap", { ...ARGS, engine: "seedance-2-5" })
    expect(calls.map((c) => (c.payload as { engine?: string }).engine)).toEqual(["seedance-2-5", "seedance-2-5"])
    _resetPluginSupportsForTests()
  })

  it("answers the quote's engine by its public id and name, whichever vocabulary the engine answered in", async () => {
    for (const [answered, engine, engineName] of [
      [undefined, "motion-pro", "Nodaro Motion Pro"],
      ["seedance-2-5", "motion-pro", "Nodaro Motion Pro"],
      ["motion-pro", "motion-pro", "Nodaro Motion Pro"],
    ] as const) {
      const { fastify } = stubFastify({ "/v1/cast-swap/estimate": { statusCode: 200, body: { ...QUOTE, ...(answered ? { engine: answered } : {}) } } })
      const res = await callTool(serverWith(fastify), "cast_swap", ARGS)
      expect(res.structuredContent).toMatchObject({ engine, engineName, confirmed: false })
      expect(res.content[0]!.text).toContain(`This ${engineName} preview costs`)
    }
  })

  // An older engine declares the internal ids; a newer one the public ids with `engineAliases`.
  for (const declared of [
    { engines: ["seedance-2-5", "kling-4"] },
    { engines: ["motion-pro", "motion-lite"], engineAliases: true },
  ]) {
    describe(`on an engine that declares ${declared.engines.join(" + ")}`, () => {
      beforeEach(() => setPluginSupports({ castSwap: declared as never }))
      afterEach(() => _resetPluginSupportsForTests())

      it("quotes a motion-lite run (expected = hold) as one price, named Nodaro Motion Lite, with nothing held beside it", async () => {
        const lite = { engine: declared.engineAliases ? "motion-lite" : "kling-4", totalCredits: 420, expectedCredits: 420, breakdown: { castSwap: 40, kling: 380, references: 0 }, settlesLower: false }
        const { fastify } = stubFastify({ "/v1/cast-swap/estimate": { statusCode: 200, body: lite } })
        const res = await callTool(serverWith(fastify), "cast_swap", { ...ARGS, preview: false, engine: "motion-lite" })
        expect(res.structuredContent).toEqual({ engine: "motion-lite", engineName: "Nodaro Motion Lite", totalCredits: 420, expectedCredits: 420, breakdown: { castSwap: 40, references: 0, motion: 380 }, settlesLower: false, confirmed: false })
        expect(res.content[0]!.text).toContain("This Nodaro Motion Lite run costs about 420 credits.")
        expect(res.content[0]!.text).not.toMatch(/held|lower|kling/i)
      })

      it("sends engine to the route as the internal id, public or old id alike (quote and run), and no engine key without it", async () => {
        const { fastify, calls } = stubFastify({
          "/v1/cast-swap/estimate": { statusCode: 200, body: QUOTE },
          "/v1/cast-swap": { statusCode: 202, body: { jobId: "job-k" } },
        })
        // motion_length, or the deprecated kling_length from an older client.
        for (const [engine, length] of [["motion-lite", "motion_length"], ["kling-4", "kling_length"]]) {
          await callTool(serverWith(fastify), "cast_swap", { ...ARGS, engine, resolution: "1080p", [length!]: "cut-start" })
          await callTool(serverWith(fastify), "cast_swap", { ...ARGS, engine, resolution: "1080p", [length!]: "cut-start", confirm: true })
        }
        expect(calls).toHaveLength(4)
        // Sent as motionLength only where the engine takes Nodaro Motion's names; an older one knows klingLength alone.
        const lengthKey = declared.engineAliases ? "motionLength" : "klingLength"
        for (const c of calls) expect(c.payload).toEqual({ ...BODY, engine: "kling-4", resolution: "1080p", [lengthKey]: "cut-start" })
        calls.length = 0
        await callTool(serverWith(fastify), "cast_swap", ARGS)
        expect("engine" in (calls[0]!.payload as Record<string, unknown>)).toBe(false)
      })

      it("refuses an engine it does not know before calling the route; leaves draft on motion-lite to the route", async () => {
        const { fastify, calls } = stubFastify({ "/v1/cast-swap/estimate": { statusCode: 400, body: { error: { code: "draft_unsupported", message: "Nodaro Motion Lite has no draft." } } } })
        expect((await callTool(serverWith(fastify), "cast_swap", { ...ARGS, engine: "kling-3" })).isError).toBe(true)
        expect((await callTool(serverWith(fastify), "cast_swap", { ...ARGS, engine: "motion-max" })).isError).toBe(true)
        expect((await callTool(serverWith(fastify), "cast_swap", { ...ARGS, engine: "motion-lite", motion_length: "pad" })).isError).toBe(true)
        expect(calls).toEqual([])
        const res = await callTool(serverWith(fastify), "cast_swap", { ...ARGS, engine: "motion-lite", draft: true })
        expect(res.isError).toBe(true)
        expect(res.content[0]!.text).toContain("draft_unsupported")
        expect(calls[0]!.payload).toMatchObject({ engine: "kling-4", draft: true })
      })
    })
  }

  it("names the credits of a retry that Nodaro's setting charges only if the clip is refused, never naming masking", async () => {
    const auto = { totalCredits: 12, breakdown: { castSwap: 5, seedance: 7, references: 0, masking: 4 }, maskingCredits: 4, settlesLower: false }
    const { fastify } = stubFastify({ "/v1/cast-swap/estimate": { statusCode: 200, body: auto } })
    const res = await callTool(serverWith(fastify), "cast_swap", ARGS)
    expect(res.content[0]!.text).toContain("12 credits")
    expect(res.content[0]!.text).toMatch(/retried once, for 4 more credits charged only then/)
    expect(res.content[0]!.text).not.toMatch(/mask|blur|depth|seedance|kling/i)
    expect(res.structuredContent).toMatchObject({ totalCredits: 12, privacyCredits: 4, breakdown: { castSwap: 5, motion: 7, references: 0, privacy: 4 }, confirmed: false })
    expect(JSON.stringify(res.structuredContent)).not.toMatch(/seedance|kling|masking/i)
  })

  it("reads the neutral key names first (an engine that sends both), and the old ones from an older engine", async () => {
    const both = {
      totalCredits: 12, breakdown: { castSwap: 5, seedance: 99, motion: 7, references: 0, masking: 9, privacy: 4 },
      maskingCredits: 9, privacyCredits: 4, settlesLower: false,
    }
    const fresh = { totalCredits: 12, breakdown: { castSwap: 5, motion: 7, references: 0, privacy: 4 }, privacyCredits: 4, settlesLower: false }
    for (const body of [both, fresh]) {
      const { fastify } = stubFastify({ "/v1/cast-swap/estimate": { statusCode: 200, body } })
      const res = await callTool(serverWith(fastify), "cast_swap", ARGS)
      expect(res.structuredContent).toEqual({ ...PRO, totalCredits: 12, breakdown: { castSwap: 5, motion: 7, references: 0, privacy: 4 }, privacyCredits: 4, settlesLower: false, confirmed: false })
      expect(res.content[0]!.text).toMatch(/for 4 more credits/)
    }
  })

  it("says nothing more when the setting's charge is already in the totals, or there is none", async () => {
    const always = { totalCredits: 16, breakdown: { castSwap: 5, seedance: 7, references: 0, masking: 4 }, settlesLower: false }
    for (const body of [always, QUOTE, { ...QUOTE, maskingCredits: 0 }]) {
      const { fastify } = stubFastify({ "/v1/cast-swap/estimate": { statusCode: 200, body } })
      const text = (await callTool(serverWith(fastify), "cast_swap", ARGS)).content[0]!.text
      expect(text).not.toMatch(/retried|mask/i)
    }
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
