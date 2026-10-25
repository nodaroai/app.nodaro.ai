import Fastify, { type FastifyInstance } from "fastify"
import { afterEach, describe, expect, it, vi } from "vitest"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { completeTask, getTask } from "../../tasks.js"
import { buildServer, callTool, listTools } from "./_helpers.js"

/**
 * The trend verbs — the MCP face of `/v1/trends` (Cloud, ee/routes/trends.ts).
 *
 * The contracts under test:
 *  - `list_trends` / `get_trend` read the public routes (jobs:read) and hand
 *    back only what those routes return;
 *  - `run_trend` without `confirm` quotes (`/estimate`) and never runs; with
 *    `confirm: true` it runs (`/runs`, the client's retry token as an
 *    `mcp:`-namespaced idempotency key) and registers the job as a task;
 *  - the route's refusals pass through (a `missing_slot` names the slot); a
 *    router 404 reads `not_available`, the route's own 404 stays itself;
 *  - registered only on Nodaro Cloud (`hasCredits()`), each behind its scope.
 *
 * The numbers are neutral on purpose: this repo is publicly mirrored.
 */
const h = vi.hoisted(() => ({ credits: true }))

vi.mock("../../../supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("../../../config.js", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return { ...orig, hasCredits: () => h.credits }
})

const { registerTrendTools } = await import("../trends.js")
const { buildMcpServer } = await import("../../server.js")

interface InjectCall {
  method?: string
  url?: string
  query?: Record<string, string>
  payload?: unknown
  headers?: Record<string, string>
}

/** A fastify stand-in answering one reply per "METHOD url", recording every call. */
function stubFastify(routes: Record<string, { statusCode: number; body: unknown }>) {
  const calls: InjectCall[] = []
  const fastify = {
    inject: async (opts: InjectCall) => {
      calls.push(opts)
      const res = routes[`${opts.method} ${opts.url}`]
      if (!res) {
        return { statusCode: 404, body: JSON.stringify({ message: `Route ${opts.method}:${opts.url} not found`, error: "Not Found" }) }
      }
      return { statusCode: res.statusCode, body: typeof res.body === "string" ? res.body : JSON.stringify(res.body) }
    },
  } as unknown as FastifyInstance
  return { fastify, calls }
}

function serverWith(fastify: FastifyInstance, scopes: Scope[] = ["jobs:read", "workflows:execute"]) {
  const server = buildServer()
  registerTrendTools({ server, session: newSession({ userId: "u1", scopes, clientName: "test" }), fastify })
  return server
}

const CARD = {
  id: "t-1",
  slug: "dance-off",
  name: "Dance off",
  description: "Two people dance",
  tags: ["dance"],
  badges: ["new"],
  cover: { videoUrl: "https://cdn.example/ex1.mp4", posterUrl: "https://cdn.example/ex1.jpg", width: 720, height: 1280 },
  needs: { person: 2, location: 0, product: 0, pet: 0 },
  durationSec: 8,
  isFavorite: false,
}

const DETAIL = {
  ...CARD,
  version: 3,
  previewSec: 4,
  engine: "seedance-2-5",
  resolutions: ["480p", "720p", "1080p"],
  slots: [
    { key: "lead", label: "Lead", kind: "person", required: true, hint: "A clear face", hintImageUrl: "https://cdn.example/hint-lead.png", chips: ["outfit", "hair"], defaults: { outfit: "original" } },
    { key: "partner", label: "Partner", kind: "person", required: false, chips: [] },
  ],
  original: {
    videoUrl: "https://cdn.example/original.mp4",
    posterUrl: "https://cdn.example/original.png",
    width: 720,
    height: 1280,
    durationSec: 8.04,
    previewStartSec: 2,
  },
  examples: [
    {
      videoUrl: "https://cdn.example/ex1.mp4",
      width: 720,
      height: 1280,
      slots: { lead: ["https://cdn.example/a.png"], partner: ["https://cdn.example/b.png"] },
    },
  ],
}

const ARGS = {
  slug: "dance-off",
  slots: { lead: { images: ["https://cdn.example/me.png"], outfit: "original" }, partner: { images: [] } },
  example: 1,
  details: "{slot:lead} waves",
  preview: true,
  resolution: "480p",
  draft: true,
  session_id: "s-1",
}

/** What the route receives for ARGS: camelCase, an empty images list left out. */
const BODY = {
  slots: { lead: { images: ["https://cdn.example/me.png"], outfit: "original" }, partner: {} },
  example: 1,
  details: "{slot:lead} waves",
  preview: true,
  resolution: "480p",
  draft: true,
  sessionId: "s-1",
}

const QUOTE = { data: { expectedCredits: 10, holdCredits: 14, breakdown: { castSwap: 4, seedance: 10 } } }

afterEach(() => {
  h.credits = true
})

describe("list_trends", () => {
  it("reads the catalog with the route's query names", async () => {
    const { fastify, calls } = stubFastify({ "GET /v1/trends": { statusCode: 200, body: { data: [CARD], next: "c2" } } })
    const res = await callTool(serverWith(fastify, ["jobs:read"]), "list_trends", {
      query: "dance",
      tag: "dance",
      favorites: true,
      cursor: "c1",
    })

    expect(res.isError).toBeFalsy()
    expect(calls).toHaveLength(1)
    expect(calls[0]!.query).toEqual({ q: "dance", tag: "dance", favorites: "1", cursor: "c1" })
    const text = res.content[0]!.text!
    expect(text).toContain("Dance off")
    expect(text).toContain("dance-off")
    expect(text).toContain('"c2"')
    expect(res.structuredContent).toEqual({ trends: [CARD], next: "c2" })
  })

  it("sends no filter it was not given", async () => {
    const { fastify, calls } = stubFastify({ "GET /v1/trends": { statusCode: 200, body: { data: [], next: null } } })
    const res = await callTool(serverWith(fastify), "list_trends", { favorites: false })
    expect(calls[0]!.query ?? {}).toEqual({})
    expect(res.content[0]!.text).toMatch(/no trends/i)
  })
})

describe("get_trend", () => {
  it("returns the trend's slots, examples, preview and resolutions", async () => {
    const { fastify, calls } = stubFastify({ "GET /v1/trends/dance-off": { statusCode: 200, body: { data: DETAIL } } })
    const res = await callTool(serverWith(fastify, ["jobs:read"]), "get_trend", { slug: "dance-off" })

    expect(res.isError).toBeFalsy()
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(["GET /v1/trends/dance-off"])
    expect(res.structuredContent).toEqual(DETAIL)
    expect(JSON.parse(res.content[0]!.text!)).toEqual(DETAIL)
  })

  it("hands back a Kling 4 trend's engine and its resolutions; an unknown or missing engine reads as Seedance 2.5", async () => {
    const kling = { ...DETAIL, engine: "kling-4", resolutions: ["720p", "1080p"] }
    const { fastify } = stubFastify({ "GET /v1/trends/dance-off": { statusCode: 200, body: { data: kling } } })
    expect((await callTool(serverWith(fastify), "get_trend", { slug: "dance-off" })).structuredContent).toEqual(kling)
    const { engine: _e, ...older } = DETAIL
    const { fastify: f2 } = stubFastify({ "GET /v1/trends/dance-off": { statusCode: 200, body: { data: older } } })
    expect((await callTool(serverWith(f2), "get_trend", { slug: "dance-off" })).structuredContent).toMatchObject({ engine: "seedance-2-5" })
  })

  it("hands back only the public fields, whatever else the body carries", async () => {
    const leaky = {
      ...DETAIL,
      source: { videoUrl: "https://cdn.example/source.mp4" },
      trendPrompt: "secret",
      slots: [{ ...DETAIL.slots[0], roleName: "the woman in red" }],
      examples: [{ ...DETAIL.examples[0], jobId: "j-src" }],
    }
    const { fastify } = stubFastify({ "GET /v1/trends/dance-off": { statusCode: 200, body: { data: leaky } } })
    const res = await callTool(serverWith(fastify), "get_trend", { slug: "dance-off" })
    const text = res.content[0]!.text! + JSON.stringify(res.structuredContent)
    for (const hidden of ["source.mp4", "secret", "the woman in red", "j-src", "roleName", "trendPrompt"]) {
      expect(text).not.toContain(hidden)
    }
  })

  it("hands back the original (preview start 0 included); a trend without one has none, and a trend with no example has examples []", async () => {
    const at0 = { ...DETAIL, original: { ...DETAIL.original, previewStartSec: 0 } }
    const { fastify } = stubFastify({ "GET /v1/trends/dance-off": { statusCode: 200, body: { data: at0 } } })
    expect((await callTool(serverWith(fastify), "get_trend", { slug: "dance-off" })).structuredContent).toMatchObject({
      original: { previewStartSec: 0 },
    })

    const { original: _o, ...older } = DETAIL
    const { fastify: f2 } = stubFastify({ "GET /v1/trends/dance-off": { statusCode: 200, body: { data: older } } })
    expect((await callTool(serverWith(f2), "get_trend", { slug: "dance-off" })).structuredContent).not.toHaveProperty("original")

    const { previewStartSec: _p, ...noPreview } = DETAIL.original
    const bare = { ...DETAIL, previewSec: null, original: noPreview, examples: [] }
    const { fastify: f3 } = stubFastify({ "GET /v1/trends/dance-off": { statusCode: 200, body: { data: bare } } })
    const view = (await callTool(serverWith(f3), "get_trend", { slug: "dance-off" })).structuredContent as Record<string, unknown>
    expect(view.original).toEqual(noPreview)
    expect(view.examples).toEqual([])
  })

  it("hands back only the original's public fields", async () => {
    const leaky = { ...DETAIL, original: { ...DETAIL.original, sourceUrl: "https://cdn.example/source.mp4", jobId: "j-src" } }
    const { fastify } = stubFastify({ "GET /v1/trends/dance-off": { statusCode: 200, body: { data: leaky } } })
    const res = await callTool(serverWith(fastify), "get_trend", { slug: "dance-off" })
    expect((res.structuredContent as Record<string, unknown>).original).toEqual(DETAIL.original)
  })

  it("lists only a slot's shown chips, and the defaults of those only", async () => {
    const body = {
      ...DETAIL,
      slots: [{ ...DETAIL.slots[0], chips: ["hair", "coat", 7], defaults: { outfit: "original", hair: "new" } }],
    }
    const { fastify } = stubFastify({ "GET /v1/trends/dance-off": { statusCode: 200, body: { data: body } } })
    const res = await callTool(serverWith(fastify), "get_trend", { slug: "dance-off" })
    const [slot] = (res.structuredContent as { slots: Array<Record<string, unknown>> }).slots
    expect(slot!.chips).toEqual(["hair", "coat"])
    expect(slot!.defaults).toEqual({ hair: "new" })
  })

  it("passes the route's own 404 through as itself", async () => {
    const { fastify } = stubFastify({
      "GET /v1/trends/gone": { statusCode: 404, body: { error: { code: "not_found", message: "Trend not found" } } },
    })
    const res = await callTool(serverWith(fastify), "get_trend", { slug: "gone" })
    expect(res.isError).toBe(true)
    expect(res.content[0]!.text).toContain("not_found")
    expect(res.content[0]!.text).toContain("Trend not found")
  })

  it("refuses a slug that is not one", async () => {
    const { fastify, calls } = stubFastify({})
    const res = await callTool(serverWith(fastify), "get_trend", { slug: "../admin" })
    expect(res.isError).toBe(true)
    expect(calls).toHaveLength(0)
  })
})

describe("the reserved slugs \"runs\" and \"tags\" (GET /v1/trends/runs and /v1/trends/tags)", () => {
  it("are refused by get_trend, estimate_trend and run_trend before any call", async () => {
    const { fastify, calls } = stubFastify({})
    const server = serverWith(fastify)
    for (const slug of ["runs", "tags"]) {
      for (const [tool, args] of [
        ["get_trend", { slug }],
        ["estimate_trend", { slug, slots: {} }],
        ["run_trend", { slug, slots: {}, confirm: true }],
      ] as const) {
        const res = await callTool(server, tool, args)
        expect(res.isError, `${tool} ${slug}`).toBe(true)
      }
    }
    expect(calls).toHaveLength(0)
  })
})

describe("estimate_trend", () => {
  it("quotes the expected credits and the hold", async () => {
    const { fastify, calls } = stubFastify({ "POST /v1/trends/dance-off/estimate": { statusCode: 200, body: QUOTE } })
    const { session_id: _sid, ...args } = ARGS
    const res = await callTool(serverWith(fastify), "estimate_trend", args)

    expect(res.isError).toBeFalsy()
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(["POST /v1/trends/dance-off/estimate"])
    const { sessionId: _s, ...body } = BODY
    expect(calls[0]!.payload).toEqual(body)
    expect(res.content[0]!.text).toContain("about 10 credits (up to 14 held while it runs)")
    expect(res.structuredContent).toEqual(QUOTE.data)
  })

  it("keeps only the breakdown's numeric entries", async () => {
    const { fastify } = stubFastify({
      "POST /v1/trends/dance-off/estimate": {
        statusCode: 200,
        body: { data: { ...QUOTE.data, breakdown: { castSwap: 4, seedance: 10, note: "text", nested: { a: 1 }, none: null } } },
      },
    })
    const res = await callTool(serverWith(fastify), "estimate_trend", { slug: "dance-off", slots: {} })
    expect((res.structuredContent as { breakdown: unknown }).breakdown).toEqual({ castSwap: 4, seedance: 10 })
  })

  it("names the masking credits, and sends preview_job_id as previewJobId", async () => {
    const PREVIEW = "0b7d4b8e-3f1e-4c55-9d1a-6f2c1e9a7b10"
    const { fastify, calls } = stubFastify({
      "POST /v1/trends/dance-off/estimate": {
        statusCode: 200,
        body: { data: { ...QUOTE.data, breakdown: { ...QUOTE.data.breakdown, masking: 6 }, maskingCredits: 6 } },
      },
    })
    const res = await callTool(serverWith(fastify), "estimate_trend", { slug: "dance-off", slots: {}, preview_job_id: PREVIEW })
    expect(res.isError).toBeFalsy()
    expect(calls[0]!.payload).toEqual({ slots: {}, previewJobId: PREVIEW })
    expect(res.content[0]!.text).toContain("Plus 6 only if the clip is refused")
    expect(res.structuredContent).toMatchObject({ maskingCredits: 6, breakdown: { masking: 6 } })

    const run = await callTool(serverWith(fastify), "run_trend", { slug: "dance-off", slots: {}, preview_job_id: PREVIEW })
    expect(run.structuredContent).toMatchObject({ maskingCredits: 6, confirmed: false })
  })

  it("takes any id the route takes as a uuid (no version or variant check)", async () => {
    const LOOSE = "11111111-1111-1111-1111-111111111111"
    const { fastify, calls } = stubFastify({ "POST /v1/trends/dance-off/estimate": { statusCode: 200, body: QUOTE } })
    const res = await callTool(serverWith(fastify), "estimate_trend", { slug: "dance-off", slots: {}, preview_job_id: LOOSE })
    expect(res.isError).toBeFalsy()
    expect(calls[0]!.payload).toEqual({ slots: {}, previewJobId: LOOSE })
  })

  it("refuses a preview_job_id that is not a uuid", async () => {
    const { fastify, calls } = stubFastify({ "POST /v1/trends/dance-off/estimate": { statusCode: 200, body: QUOTE } })
    const res = await callTool(serverWith(fastify), "estimate_trend", { slug: "dance-off", slots: {}, preview_job_id: "job-1" })
    expect(res.isError).toBe(true)
    expect(calls).toHaveLength(0)
  })

  it("names no hold when it equals the expected credits", async () => {
    const { fastify } = stubFastify({
      "POST /v1/trends/dance-off/estimate": { statusCode: 200, body: { data: { ...QUOTE.data, holdCredits: 10 } } },
    })
    const res = await callTool(serverWith(fastify), "estimate_trend", { slug: "dance-off", slots: {} })
    expect(res.content[0]!.text).toContain("about 10 credits")
    expect(res.content[0]!.text).not.toContain("held")
  })
})

describe("run_trend", () => {
  it("quotes without confirm and does not run", async () => {
    const { fastify, calls } = stubFastify({ "POST /v1/trends/dance-off/estimate": { statusCode: 200, body: QUOTE } })
    const res = await callTool(serverWith(fastify), "run_trend", ARGS)

    expect(res.isError).toBeFalsy()
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(["POST /v1/trends/dance-off/estimate"])
    expect(calls[0]!.payload).toEqual(BODY)
    const text = res.content[0]!.text!
    expect(text).toContain("about 10 credits (up to 14 held while it runs)")
    expect(text).toContain("confirm: true")
    expect(res.structuredContent).toEqual({ ...QUOTE.data, confirmed: false })
  })

  it("runs with confirm, keyed by the retry token, and registers the job", async () => {
    const { fastify, calls } = stubFastify({ "POST /v1/trends/dance-off/runs": { statusCode: 202, body: { data: { jobId: "job-7" } } } })
    const res = await callTool(serverWith(fastify), "run_trend", { ...ARGS, confirm: true, client_request_id: "retry-token-1" })

    expect(res.isError).toBeFalsy()
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(["POST /v1/trends/dance-off/runs"])
    expect(calls[0]!.payload).toEqual(BODY)
    expect(calls[0]!.headers?.["idempotency-key"]).toBe("mcp:retry-token-1")
    expect(res.structuredContent).toEqual({ jobId: "job-7", confirmed: true })
    expect(res.content[0]!.text).toContain("job-7")
    expect(res.content[0]!.text).toContain("wait_for_job")
    expect(getTask("job-7")).toMatchObject({ taskId: "job-7", userId: "u1", kind: "video" })
    completeTask("job-7")
  })

  it("sends no idempotency key without a retry token", async () => {
    const { fastify, calls } = stubFastify({ "POST /v1/trends/dance-off/runs": { statusCode: 202, body: { data: { jobId: "job-8" } } } })
    await callTool(serverWith(fastify), "run_trend", { slug: "dance-off", slots: {}, confirm: true })
    expect(calls[0]!.headers?.["idempotency-key"]).toBeUndefined()
    completeTask("job-8")
  })

  it("passes a missing_slot refusal back naming the slot", async () => {
    const { fastify } = stubFastify({
      "POST /v1/trends/dance-off/estimate": {
        statusCode: 400,
        body: { error: { code: "missing_slot", message: '"Lead" needs a picture.', slot: "lead" } },
      },
    })
    const res = await callTool(serverWith(fastify), "run_trend", { slug: "dance-off", slots: {} })
    expect(res.isError).toBe(true)
    const text = res.content[0]!.text!
    expect(text).toContain("missing_slot")
    expect(text).toContain('"Lead" needs a picture.')
    expect(text).toContain('"lead"')
  })

  it("passes a chip_not_offered refusal back naming the slot and the chip", async () => {
    const { fastify } = stubFastify({
      "POST /v1/trends/dance-off/estimate": {
        statusCode: 400,
        body: { error: { code: "chip_not_offered", message: 'Slot "lead" does not offer the "hair" chip: this trend fixes it.', slot: "lead", chip: "hair" } },
      },
    })
    const res = await callTool(serverWith(fastify), "run_trend", { slug: "dance-off", slots: { lead: { images: ["https://cdn.example/me.png"], hair: "new" } } })
    expect(res.isError).toBe(true)
    const text = res.content[0]!.text!
    expect(text).toContain("chip_not_offered")
    expect(text).toContain('chip "hair"')
    expect(text).toContain('slot "lead"')
  })

  it("answers not_available where the trend routes are not served", async () => {
    const { fastify } = stubFastify({})
    for (const confirm of [false, true]) {
      const res = await callTool(serverWith(fastify), "run_trend", { slug: "dance-off", slots: {}, confirm })
      expect(res.isError).toBe(true)
      expect(res.content[0]!.text).toContain("not_available")
    }
  })
})

describe("trend verbs — scope gates", () => {
  async function names(scopes: Scope[]) {
    const { fastify } = stubFastify({})
    return (await listTools(serverWith(fastify, scopes))).map((t) => t.name).sort()
  }

  it("reads need jobs:read, quote and run need workflows:execute", async () => {
    expect(await names(["jobs:read"])).toEqual(["get_trend", "list_trends"])
    expect(await names(["workflows:execute"])).toEqual(["estimate_trend", "run_trend"])
    expect(await names([])).toEqual([])
  })

  it("marks the reads read-only and the run not", async () => {
    const { fastify } = stubFastify({})
    const tools = await listTools(serverWith(fastify))
    const hint = (n: string) =>
      (tools.find((t) => t.name === n) as { annotations?: { readOnlyHint?: boolean } } | undefined)?.annotations?.readOnlyHint
    expect(hint("list_trends")).toBe(true)
    expect(hint("get_trend")).toBe(true)
    expect(hint("run_trend")).toBe(false)
  })
})

describe("trend verbs — what the descriptions promise", () => {
  async function schemaText(tool: string) {
    const { fastify } = stubFastify({})
    const t = (await listTools(serverWith(fastify))).find((x) => x.name === tool)
    return JSON.stringify(t)
  }

  it("only an OPTIONAL slot left out takes the example's pictures", async () => {
    for (const tool of ["estimate_trend", "run_trend"]) {
      const text = await schemaText(tool)
      expect(text, tool).toContain("an optional slot left out takes the example's")
      expect(text, tool).not.toContain("one left out takes the example's")
    }
  })

  it("says session_id is accepted but not applied yet", async () => {
    expect(await schemaText("run_trend")).toContain("not yet applied")
  })
})

describe("trend verbs are gated on the edition", () => {
  const TREND_TOOLS = ["estimate_trend", "get_trend", "list_trends", "run_trend"]
  async function names(credits: boolean) {
    h.credits = credits
    const server = await buildMcpServer({ userId: "u1", scopes: ["jobs:read", "workflows:execute"], clientName: "Claude", fastify: Fastify() })
    return (await listTools(server)).map((t) => t.name)
  }

  it("are not registered without credits", async () => {
    const off = await names(false)
    for (const t of TREND_TOOLS) expect(off).not.toContain(t)
    expect(off).toContain("ping")
  })

  it("are registered on Nodaro Cloud", async () => {
    const on = await names(true)
    for (const t of TREND_TOOLS) expect(on).toContain(t)
  })
})
