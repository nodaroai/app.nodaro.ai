/**
 * A dub over MCP, after it is made: `get_dubbing` (its overview, or one
 * language's lines a page at a time) and `get_dubbing_captions` (the text of an
 * SRT or WebVTT file), both under assets:read, the scope the REST reads ask an
 * OAuth app for. Each is a call to its route, so the route's ownership check,
 * rate limit and refusals are the tool's too; an id that cannot be a job is
 * refused before any call.
 */
import { describe, it, expect } from "vitest"
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify"
import type { DubbingSegment, DubbingSourceSegment, DubbingStructure } from "@nodaro/shared/media"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { registerDubbingTools } from "../dubbing.js"
import { buildServer, callTool, listTools } from "./_helpers.js"

const USER = "u1"
const JOB = "00000000-0000-4000-8000-000000000001"
const PORTUGUESE_JOB = "00000000-0000-4000-8000-000000000002"
const HEBREW_JOB = "00000000-0000-4000-8000-000000000003"

const sourceLine = (n: number): DubbingSourceSegment => ({
  id: `s${n}`,
  speakerId: "sp1",
  start: n * 2,
  end: n * 2 + 1.5,
  text: `Original line ${n}.`,
})

const line = (n: number): DubbingSegment => ({
  id: `t${n}`,
  speakerId: "sp1",
  start: n * 2,
  end: n * 2 + 1.5,
  sourceSegmentId: `s${n}`,
  sourceText: `Original line ${n}.`,
  text: `Translated line ${n}.`,
})

const lines = (count: number): DubbingSegment[] => Array.from({ length: count }, (_, n) => line(n))

/** A dub with a long language, a regional one made by a later job, and one still being made. */
const STRUCTURE: DubbingStructure = {
  jobId: JOB,
  durationSec: 240,
  source: { language: "en", segments: [sourceLine(0), sourceLine(1), sourceLine(2)] },
  languages: [
    { code: "es", jobId: JOB, status: "completed", segments: lines(120) },
    { code: "pt-BR", jobId: PORTUGUESE_JOB, status: "completed", segments: lines(3) },
    { code: "he", jobId: HEBREW_JOB, status: "processing", segments: [] },
  ],
  speakers: [{ id: "sp1", name: null, voice: null, segmentCount: 120 }],
  capabilities: { editSegments: false, regenerate: false, setSpeakerVoice: false, render: false, addLanguage: true, captions: true },
  addLanguage: {
    billableMinutes: 4,
    creditId: "elevenlabs-dubbing:4u",
    creditIdByLanguage: { he: "elevenlabs-dubbing-v2:4u", heb: "elevenlabs-dubbing-v2:4u" },
  },
}

const VTT = "WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.500\nTranslated line 0.\n"

/** The text of a tool result (its first content block). */
const textOf = (res: { content: Array<{ text?: string }> }): string => res.content[0]?.text ?? ""

function server(scopes: Scope[], fastify: FastifyInstance = Fastify()) {
  const s = buildServer()
  registerDubbingTools({ server: s, session: newSession({ userId: USER, scopes, clientName: "Claude" }), fastify })
  return s
}

type Received = { method: string; path: string; query: Record<string, unknown> }
type Answer = { status: number; body: unknown; type?: string }

const refusal = (status: number, code: string, message: string): Answer => ({ status, body: { error: { code, message } } })

/** A stand-in for the two dubbing reads: records what each tool sent, answers like the route. */
function dubRoutes(answers: { structure?: Answer; captions?: Answer } = {}): { fastify: FastifyInstance; received: Received[] } {
  const fastify = Fastify()
  const received: Received[] = []
  const structure = answers.structure ?? { status: 200, body: STRUCTURE }
  const captions = answers.captions ?? { status: 200, body: VTT, type: "text/vtt; charset=utf-8" }
  const answer = (given: Answer) => async (req: FastifyRequest, reply: import("fastify").FastifyReply) => {
    received.push({ method: req.method, path: req.url.split("?")[0] ?? "", query: { ...(req.query as Record<string, unknown>) } })
    const sized = reply.status(given.status)
    return given.type ? sized.type(given.type).send(given.body) : sized.send(given.body)
  }
  fastify.get("/v1/dubbing/:jobId", answer(structure))
  fastify.get("/v1/dubbing/:jobId/captions", answer(captions))
  return { fastify, received }
}

const read = (routes: { fastify: FastifyInstance }, args: Record<string, unknown>) =>
  callTool(server(["assets:read"], routes.fastify), "get_dubbing", { job_id: JOB, ...args })

const captionsOf = (routes: { fastify: FastifyInstance }, args: Record<string, unknown>) =>
  callTool(server(["assets:read"], routes.fastify), "get_dubbing_captions", { job_id: JOB, ...args })

describe("dubbing tools: registration", () => {
  it("both reads register under assets:read, adding a language under assets:write, and none without them", async () => {
    expect((await listTools(server(["assets:read"]))).map((t) => t.name).sort()).toEqual(["get_dubbing", "get_dubbing_captions"])
    expect((await listTools(server(["assets:write"]))).map((t) => t.name)).toEqual(["add_dubbing_language"])
    for (const scopes of [[], ["jobs:read"], ["workflows:execute"]] as Scope[][]) {
      expect((await listTools(server(scopes))).map((t) => t.name), scopes.join(",")).toEqual([])
    }
  })

  it("both are marked as reads that change nothing", async () => {
    const tools = (await listTools(server(["assets:read"]))) as Array<{ name: string; annotations?: Record<string, unknown> }>
    expect(tools).toHaveLength(2)
    for (const tool of tools) {
      expect(tool.annotations, tool.name).toMatchObject({ readOnlyHint: true, destructiveHint: false })
    }
  })
})

describe("get_dubbing: the overview", () => {
  it("reads GET /v1/dubbing/:jobId once and answers the dub without its lines", async () => {
    const routes = dubRoutes()
    const res = await read(routes, {})
    expect(res.isError).toBeFalsy()
    expect(routes.received).toEqual([{ method: "GET", path: `/v1/dubbing/${JOB}`, query: {} }])
    expect(JSON.parse(textOf(res))).toEqual({
      jobId: JOB,
      durationSec: 240,
      source: { language: "en", segmentCount: 3 },
      languages: [
        { code: "es", jobId: JOB, status: "completed", segmentCount: 120 },
        { code: "pt-BR", jobId: PORTUGUESE_JOB, status: "completed", segmentCount: 3 },
        { code: "he", jobId: HEBREW_JOB, status: "processing", segmentCount: 0 },
      ],
      speakers: STRUCTURE.speakers,
      capabilities: STRUCTURE.capabilities,
      addLanguage: STRUCTURE.addLanguage,
    })
  })

  it("carries no line of the dub, however long it is", async () => {
    const text = textOf(await read(dubRoutes(), {}))
    expect(text).not.toContain("Translated line")
    expect(text).not.toContain("Original line")
    expect(text).not.toContain('"segments"')
  })

  it("answers a null source when the original speech cannot be read", async () => {
    const routes = dubRoutes({ structure: { status: 200, body: { ...STRUCTURE, source: null } } })
    expect(JSON.parse(textOf(await read(routes, {}))).source).toBeNull()
  })

  it("ignores offset and limit when no language is asked for", async () => {
    const plain = textOf(await read(dubRoutes(), {}))
    expect(textOf(await read(dubRoutes(), { offset: 10, limit: 5 }))).toBe(plain)
  })
})

describe("get_dubbing: one language's lines", () => {
  it("answers the first 50 lines of the language, and where the next page starts", async () => {
    const routes = dubRoutes()
    const res = await read(routes, { language: "es" })
    expect(res.isError).toBeFalsy()
    expect(routes.received).toEqual([{ method: "GET", path: `/v1/dubbing/${JOB}`, query: {} }])
    expect(JSON.parse(textOf(res))).toEqual({
      jobId: JOB,
      language: "es",
      languageJobId: JOB,
      status: "completed",
      total: 120,
      offset: 0,
      nextOffset: 50,
      segments: lines(120).slice(0, 50),
    })
  })

  it("pages by offset and limit, and the last page has no next one", async () => {
    const middle = JSON.parse(textOf(await read(dubRoutes(), { language: "es", offset: 50, limit: 30 })))
    expect(middle).toMatchObject({ total: 120, offset: 50, nextOffset: 80 })
    expect(middle.segments).toEqual(lines(120).slice(50, 80))

    const last = JSON.parse(textOf(await read(dubRoutes(), { language: "es", offset: 100 })))
    expect(last).toMatchObject({ total: 120, offset: 100, nextOffset: null })
    expect(last.segments).toEqual(lines(120).slice(100))

    const exact = JSON.parse(textOf(await read(dubRoutes(), { language: "es", offset: 70, limit: 50 })))
    expect(exact).toMatchObject({ offset: 70, nextOffset: null })
    expect(exact.segments).toHaveLength(50)
  })

  it("reads up to 200 lines in one page", async () => {
    const all = JSON.parse(textOf(await read(dubRoutes(), { language: "es", limit: 200 })))
    expect(all).toMatchObject({ total: 120, offset: 0, nextOffset: null })
    expect(all.segments).toHaveLength(120)
  })

  it("answers an empty page past the end, not a refusal", async () => {
    const res = await read(dubRoutes(), { language: "es", offset: 500 })
    expect(res.isError).toBeFalsy()
    expect(JSON.parse(textOf(res))).toMatchObject({ total: 120, offset: 500, nextOffset: null, segments: [] })
  })

  it("finds a language whatever the case of the code, and names it as the dub lists it", async () => {
    const page = JSON.parse(textOf(await read(dubRoutes(), { language: " PT-br " })))
    expect(page).toMatchObject({ language: "pt-BR", languageJobId: PORTUGUESE_JOB, status: "completed", total: 3, nextOffset: null })
    expect(page.segments).toEqual(lines(3))
  })

  it("reads both codes of a language that has two, and a language still being made as an empty page with its status", async () => {
    const res = await read(dubRoutes(), { language: "heb" })
    expect(res.isError).toBeFalsy()
    expect(JSON.parse(textOf(res))).toEqual({
      jobId: JOB,
      language: "he",
      languageJobId: HEBREW_JOB,
      status: "processing",
      total: 0,
      offset: 0,
      nextOffset: null,
      segments: [],
    })
  })

  it("refuses a language the dub does not list, in the route's own code", async () => {
    const routes = dubRoutes()
    const res = await read(routes, { language: "fr" })
    expect(res.isError).toBe(true)
    expect(textOf(res)).toBe("Nodaro rejected the request (404 dubbing_language_not_found): This dub has no such language.")
    expect(routes.received).toHaveLength(1)
  })
})

describe("get_dubbing: the original speech", () => {
  it('answers the original lines for the language "source", paged like any other', async () => {
    const res = await read(dubRoutes(), { language: "source" })
    expect(res.isError).toBeFalsy()
    expect(JSON.parse(textOf(res))).toEqual({
      jobId: JOB,
      language: "source",
      sourceLanguage: "en",
      total: 3,
      offset: 0,
      nextOffset: null,
      segments: [sourceLine(0), sourceLine(1), sourceLine(2)],
    })
    const second = JSON.parse(textOf(await read(dubRoutes(), { language: " Source ", offset: 1, limit: 1 })))
    expect(second).toMatchObject({ language: "source", total: 3, offset: 1, nextOffset: 2 })
    expect(second.segments).toEqual([sourceLine(1)])
  })

  it("answers null lines when the original speech cannot be read, as the route does", async () => {
    const routes = dubRoutes({ structure: { status: 200, body: { ...STRUCTURE, source: null } } })
    const res = await read(routes, { language: "source" })
    expect(res.isError).toBeFalsy()
    expect(JSON.parse(textOf(res))).toEqual({
      jobId: JOB,
      language: "source",
      sourceLanguage: null,
      total: 0,
      offset: 0,
      nextOffset: null,
      segments: null,
    })
  })

  it("keeps the start it was asked for when the original speech cannot be read", async () => {
    const routes = dubRoutes({ structure: { status: 200, body: { ...STRUCTURE, source: null } } })
    const page = JSON.parse(textOf(await read(routes, { language: "source", offset: 40, limit: 10 })))
    expect(page).toEqual({
      jobId: JOB,
      language: "source",
      sourceLanguage: null,
      total: 0,
      offset: 40,
      nextOffset: null,
      segments: null,
    })
  })
})

describe("get_dubbing: refusals", () => {
  it("answers an id that cannot be a job as a job that is not found, before any call", async () => {
    const routes = dubRoutes()
    for (const id of ["abc", "../api-tokens", `${JOB}/captions`, ""]) {
      const res = await callTool(server(["assets:read"], routes.fastify), "get_dubbing", { job_id: id })
      expect(res.isError, id).toBe(true)
    }
    const res = await callTool(server(["assets:read"], routes.fastify), "get_dubbing", { job_id: "abc" })
    expect(textOf(res)).toBe("Nodaro rejected the request (404 not_found): Job not found")
    expect(routes.received).toEqual([])
  })

  it("passes on a refusal of the route with its code and its words", async () => {
    const notReady = dubRoutes({ structure: refusal(409, "dubbing_not_ready", "This dub is still being made. Try again when it is done.") })
    const res = await read(notReady, {})
    expect(res.isError).toBe(true)
    expect(textOf(res)).toBe("Nodaro rejected the request (409 dubbing_not_ready): This dub is still being made. Try again when it is done.")

    const notADub = dubRoutes({ structure: refusal(422, "not_a_dubbing_job", "This job is not a dub.") })
    const asked = await read(notADub, { language: "es" })
    expect(asked.isError).toBe(true)
    expect(textOf(asked)).toContain("422 not_a_dubbing_job")
  })

  it("names the code of a failed read without repeating the service's words", async () => {
    const down = dubRoutes({ structure: refusal(502, "dubbing_read_failed", "The dubbing service did not answer. Try again.") })
    const res = await read(down, {})
    expect(res.isError).toBe(true)
    expect(textOf(res)).toContain("server error (502)")
    expect(textOf(res)).toContain("[dubbing_read_failed]")
  })

  it("refuses a page size or a start outside the limits, before any call", async () => {
    const routes = dubRoutes()
    for (const args of [{ limit: 201 }, { limit: 0 }, { limit: 1.5 }, { offset: -1 }, { offset: 0.5 }, { language: "e" }, { language: "a".repeat(11) }]) {
      const res = await read(routes, { language: "es", ...args })
      expect(res.isError, JSON.stringify(args)).toBe(true)
    }
    expect(routes.received).toEqual([])
  })
})

describe("get_dubbing_captions", () => {
  it("reads GET /v1/dubbing/:jobId/captions with the language and the format, and answers the file's text as it came", async () => {
    const routes = dubRoutes()
    const res = await captionsOf(routes, { language: "es", format: "vtt" })
    expect(res.isError).toBeFalsy()
    expect(routes.received).toEqual([{ method: "GET", path: `/v1/dubbing/${JOB}/captions`, query: { language: "es", format: "vtt" } }])
    expect(textOf(res)).toBe(VTT)
  })

  it("leaves the format to the route when none is given", async () => {
    const routes = dubRoutes()
    await captionsOf(routes, { language: "es" })
    expect(routes.received).toEqual([{ method: "GET", path: `/v1/dubbing/${JOB}/captions`, query: { language: "es" } }])
  })

  it("sends each format it is asked for, and the original speech as its own language", async () => {
    const routes = dubRoutes()
    await captionsOf(routes, { language: " source ", format: "srt" })
    expect(routes.received).toEqual([{ method: "GET", path: `/v1/dubbing/${JOB}/captions`, query: { language: "source", format: "srt" } }])
  })

  it("answers an id that cannot be a job as a job that is not found, before any call", async () => {
    const routes = dubRoutes()
    const res = await callTool(server(["assets:read"], routes.fastify), "get_dubbing_captions", { job_id: "not-a-job", language: "es" })
    expect(res.isError).toBe(true)
    expect(textOf(res)).toBe("Nodaro rejected the request (404 not_found): Job not found")
    expect(routes.received).toEqual([])
  })

  it("passes on a refusal of the route with its code and its words", async () => {
    const routes = dubRoutes({ captions: refusal(422, "dubbing_captions_unavailable", "Captions cannot be read for this language.") })
    const res = await captionsOf(routes, { language: "es" })
    expect(res.isError).toBe(true)
    expect(textOf(res)).toBe("Nodaro rejected the request (422 dubbing_captions_unavailable): Captions cannot be read for this language.")
  })

  it("refuses a format it does not make and a language that cannot be a code, before any call", async () => {
    const routes = dubRoutes()
    for (const args of [{ language: "es", format: "ass" }, { language: "e" }, { language: "a".repeat(11) }, {}]) {
      const res = await captionsOf(routes, args)
      expect(res.isError, JSON.stringify(args)).toBe(true)
    }
    expect(routes.received).toEqual([])
  })
})

describe("add_dubbing_language", () => {
  type Sent = { path: string; body: unknown }
  /** A stand-in for the add-language route: records what the tool sent, answers like the route. */
  function addRoute(answer: Answer = { status: 200, body: { jobId: PORTUGUESE_JOB } }): { fastify: FastifyInstance; sent: Sent[] } {
    const fastify = Fastify()
    const sent: Sent[] = []
    fastify.post("/v1/dubbing/:jobId/languages", async (req, reply) => {
      sent.push({ path: req.url, body: req.body })
      return reply.status(answer.status).send(answer.body)
    })
    return { fastify, sent }
  }
  const add = (routes: { fastify: FastifyInstance }, args: Record<string, unknown>) =>
    callTool(server(["assets:write"], routes.fastify), "add_dubbing_language", { job_id: JOB, ...args })

  it("posts the language to POST /v1/dubbing/:jobId/languages and answers the job that delivers it", async () => {
    const routes = addRoute()
    const res = await add(routes, { target_language: "pt-BR", confirmation_id: "00000000-0000-4000-8000-0000000000ee" })
    expect(res.isError).toBeFalsy()
    expect(routes.sent).toEqual([
      {
        path: `/v1/dubbing/${JOB}/languages`,
        body: { targetLanguage: "pt-BR", confirmationId: "00000000-0000-4000-8000-0000000000ee", mcp_client: "Claude" },
      },
    ])
    expect(textOf(res)).toContain(PORTUGUESE_JOB)
  })

  it("sends no confirmation when none is given", async () => {
    const routes = addRoute()
    await add(routes, { target_language: "de" })
    expect(routes.sent[0]?.body).toEqual({ targetLanguage: "de", mcp_client: "Claude" })
  })

  it("answers an id that cannot be a job as a job that is not found, before any call", async () => {
    const routes = addRoute()
    const res = await add(routes, { job_id: "../credits", target_language: "de" })
    expect(res.isError).toBe(true)
    expect(textOf(res)).toBe("Nodaro rejected the request (404 not_found): Job not found")
    expect(routes.sent).toEqual([])
  })

  it("passes on a refusal of the route with its code and its words", async () => {
    const routes = addRoute(refusal(409, "dubbing_language_exists", "This dub already has this language."))
    const res = await add(routes, { target_language: "es" })
    expect(res.isError).toBe(true)
    expect(textOf(res)).toContain("dubbing_language_exists")
    expect(textOf(res)).toContain("This dub already has this language.")
  })

  it("is marked as a change that destroys nothing", async () => {
    const tools = (await listTools(server(["assets:write"]))) as Array<{ name: string; annotations?: Record<string, unknown> }>
    expect(tools[0]?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false })
  })
})
