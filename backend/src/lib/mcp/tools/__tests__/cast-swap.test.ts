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
 *  - a router 404 (the plugin is not served here) reads `not_available`.
 *
 * The numbers are neutral on purpose: this repo is publicly mirrored.
 */
const h = vi.hoisted(() => ({ credits: true }))

vi.mock("../../../supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("../../../config.js", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return { ...orig, hasCredits: () => h.credits }
})

const { registerCastSwapTools } = await import("../cast-swap.js")
const { buildMcpServer } = await import("../../server.js")

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

const QUOTE = { totalCredits: 12, breakdown: { castSwap: 5, seedance: 7 }, settlesLower: false }

const ARGS = {
  video_url: "https://cdn.example/clip.mp4",
  roles: [
    { kind: "person", name: "the singer", images: ["https://cdn.example/me.png"], outfit: "original" },
    { kind: "person", name: "the drummer" },
    { kind: "location", images: ["https://cdn.example/beach.png"] },
  ],
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
    { kind: "person", name: "the drummer", images: null },
    { kind: "location", images: ["https://cdn.example/beach.png"] },
  ],
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
