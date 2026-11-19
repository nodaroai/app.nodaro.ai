import type { FastifyInstance } from "fastify"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { newSession } from "../../session.js"
import { _resetPluginSupportsForTests, setPluginSupports } from "../../../private-plugins/supports-registry.js"
import { buildServer, callTool, listTools } from "./_helpers.js"

/**
 * `video_remake` with a 3D previz clip (`clip_kind: "previz"`).
 *
 * The contracts under test:
 *  - the tool lists `clip_kind`, `previz_lighting`, `previz_sound` and a role's
 *    `subject`, and says what a previz clip is in `clip_kind`'s description;
 *  - the quote and the run send `clipKind: "previz"`, `previz: { lighting,
 *    sound }` and each role's `subject` to the route, the same body both
 *    times; an ordinary clip (no `clip_kind`, or "footage") sends none of
 *    them: the body of before;
 *  - an engine that does not declare the mode (every engine before it) is
 *    NEVER asked: any of the four arguments answers `previz_unavailable`
 *    before a quote or a run is sent, since such an engine would drop the
 *    keys and run an ordinary edit;
 *  - a deployment that does not accept such a clip (the route's 403
 *    `previz_not_available`) answers the same `previz_unavailable`, on the
 *    quote and on the run, and nothing is started;
 *  - any other refusal of the mode is the route's own, relayed.
 *
 * The numbers and words are neutral on purpose: this repo is publicly mirrored.
 */
vi.mock("../../../supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("../../../config.js", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return { ...orig, hasCredits: () => true }
})

const { registerCastSwapTools } = await import("../cast-swap.js")

interface InjectCall {
  method?: string
  url?: string
  payload?: unknown
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

function serverWith(fastify: FastifyInstance) {
  const server = buildServer()
  registerCastSwapTools({ server, session: newSession({ userId: "u1", scopes: ["workflows:execute"], clientName: "test" }), fastify })
  return server
}

const CLIP = "https://cdn.example/previz.mp4"
const DETECTIVE = "https://cdn.example/detective.png"
const PARCEL = "https://cdn.example/parcel.png"
const QUOTE = { totalCredits: 12, breakdown: { castSwap: 5, seedance: 7, references: 0 }, settlesLower: false }
const JOB = "00000000-0000-4000-8000-000000000001"
const CS = { roleKinds: [], fixedReferences: true, fullQuality: true, resolutions: ["720p"], trendRun: true }

const ARGS = {
  video_url: CLIP,
  clip_kind: "previz",
  previz_lighting: true,
  previz_sound: "generated",
  roles: [
    { kind: "person", name: "the pink model", subject: "the detective", images: [DETECTIVE] },
    { kind: "product", name: "the blue box on the table", subject: "a delivery parcel", images: [PARCEL] },
  ],
  post_prompt: "At night, in the rain.",
}
/** The body the route is sent for `ARGS`, on the quote and on the run. */
const BODY = {
  videoUrl: CLIP,
  roles: [
    { kind: "person", name: "the pink model", subject: "the detective", images: [DETECTIVE] },
    { kind: "product", name: "the blue box on the table", subject: "a delivery parcel", images: [PARCEL] },
  ],
  postPrompt: "At night, in the rain.",
  clipKind: "previz",
  previz: { lighting: true, sound: "generated" },
}

const routes = () => ({
  "/v1/video-remake/estimate": { statusCode: 200, body: QUOTE },
  "/v1/video-remake": { statusCode: 202, body: { jobId: JOB } },
})
const urls = (calls: InjectCall[]) => calls.map((c) => c.url)
const NOT_ACCEPTED = { statusCode: 403, body: { error: { code: "previz_not_available", message: "A 3D previz clip is not available here. Send an ordinary clip instead." } } }

beforeEach(() => {
  setPluginSupports({ castSwap: { ...CS, previz: true } as never })
})
afterEach(() => _resetPluginSupportsForTests())

describe("video_remake's previz arguments", () => {
  it("lists clip_kind, previz_lighting, previz_sound and a subject on every role kind", async () => {
    const { fastify } = stubFastify({})
    const tool = (await listTools(serverWith(fastify))).find((t) => t.name === "video_remake")!
    const props = (tool.inputSchema as { properties: Record<string, { type?: string; enum?: string[]; description?: string; items?: { anyOf?: Array<{ properties: Record<string, { description?: string }> }>; oneOf?: Array<{ properties: Record<string, { description?: string }> }> } }> }).properties
    expect(props.clip_kind!.enum).toEqual(["footage", "previz"])
    expect(props.clip_kind!.description).toContain("a 3D previz / clay-model clip is rendered into your look, not edited; name each role by its model's colour or position; with no art_style or custom_style the result is real-world, live-action footage")
    expect(props.previz_lighting!.type).toBe("boolean")
    expect(props.previz_lighting!.description).toContain("also take the lighting direction and lighting changes from the clip")
    expect(props.previz_sound!.enum).toEqual(["clip", "generated"])
    const kinds = props.roles!.items!.anyOf ?? props.roles!.items!.oneOf ?? []
    expect(kinds).toHaveLength(4)
    for (const kind of kinds) expect(kind.properties.subject, JSON.stringify(Object.keys(kind.properties))).toBeDefined()
    expect(kinds[0]!.properties.subject!.description).toContain("what the role is, used in the script; name is then the locator of its model")
  })
})

describe("video_remake with clip_kind previz", () => {
  it("quotes with clipKind, previz and each role's subject, and answers the price", async () => {
    const { fastify, calls } = stubFastify(routes())
    const res = await callTool(serverWith(fastify), "video_remake", ARGS)
    expect(res.isError).toBeFalsy()
    expect(urls(calls)).toEqual(["/v1/video-remake/estimate"])
    expect(calls[0]!.payload).toEqual(BODY)
    expect(res.structuredContent).toMatchObject({ totalCredits: 12, confirmed: false })
    expect(res.content[0]!.text).toContain("call video_remake again with the same arguments and confirm: true")
  })

  it("the confirmed run sends the very body that was quoted, and starts the job", async () => {
    const { fastify, calls } = stubFastify(routes())
    const res = await callTool(serverWith(fastify), "video_remake", { ...ARGS, confirm: true })
    expect(res.isError).toBeFalsy()
    expect(urls(calls)).toEqual(["/v1/video-remake"])
    expect(calls[0]!.payload).toEqual(BODY)
    expect(res.structuredContent).toMatchObject({ jobId: JOB, confirmed: true })
  })

  it("sends only the option that was given, and no previz object when neither was", async () => {
    const { fastify, calls } = stubFastify(routes())
    const server = serverWith(fastify)
    await callTool(server, "video_remake", { video_url: CLIP, clip_kind: "previz", roles: ARGS.roles })
    await callTool(server, "video_remake", { video_url: CLIP, clip_kind: "previz", previz_lighting: false, roles: ARGS.roles })
    await callTool(server, "video_remake", { video_url: CLIP, clip_kind: "previz", previz_sound: "clip", roles: ARGS.roles })
    expect(calls[0]!.payload).toEqual({ videoUrl: CLIP, roles: BODY.roles, clipKind: "previz" })
    expect(calls[1]!.payload).toEqual({ videoUrl: CLIP, roles: BODY.roles, clipKind: "previz", previz: { lighting: false } })
    expect(calls[2]!.payload).toEqual({ videoUrl: CLIP, roles: BODY.roles, clipKind: "previz", previz: { sound: "clip" } })
  })

  it("an ordinary clip sends none of it: no clip_kind, or footage, is the body of before", async () => {
    const { fastify, calls } = stubFastify(routes())
    const server = serverWith(fastify)
    const ordinary = { video_url: CLIP, roles: [{ kind: "person", name: "the woman", images: [DETECTIVE] }], post_prompt: "x" }
    await callTool(server, "video_remake", ordinary)
    await callTool(server, "video_remake", { ...ordinary, clip_kind: "footage" })
    const before = { videoUrl: CLIP, roles: [{ kind: "person", name: "the woman", images: [DETECTIVE] }], postPrompt: "x" }
    expect(calls.map((c) => c.payload)).toEqual([before, before])
  })

  it("refuses a clip kind or a sound it does not know, before anything is sent", async () => {
    const { fastify, calls } = stubFastify(routes())
    const server = serverWith(fastify)
    expect((await callTool(server, "video_remake", { ...ARGS, clip_kind: "animation" })).isError).toBe(true)
    expect((await callTool(server, "video_remake", { ...ARGS, previz_sound: "silent" })).isError).toBe(true)
    expect(calls).toEqual([])
  })

  it("relays the route's own refusals of the mode as they are", async () => {
    for (const [statusCode, code] of [
      [400, "previz_needs_prism"],
      [400, "previz_no_draft"],
      [400, "previz_role_needs_locator"],
      [400, "previz_needs_clip_kind"],
    ] as const) {
      const { fastify } = stubFastify({ "/v1/video-remake/estimate": { statusCode, body: { error: { code, message: `Refused: ${code}.` } } } })
      const res = await callTool(serverWith(fastify), "video_remake", ARGS)
      expect(res.isError, code).toBe(true)
      expect(res.content[0]!.text, code).toContain(`Refused: ${code}.`)
      expect(res.content[0]!.text).not.toContain("previz_unavailable")
    }
  })
})

describe("where a 3D previz clip is not offered", () => {
  it("an engine that does not declare the mode is never asked: previz_unavailable for any of its arguments, quote or run", async () => {
    for (const castSwap of [undefined, CS, { ...CS, previz: false }, { ...CS, planRoles: true, customStyle: true, shotLock: true }]) {
      if (castSwap) setPluginSupports({ castSwap: castSwap as never })
      else _resetPluginSupportsForTests()
      const { fastify, calls } = stubFastify(routes())
      const server = serverWith(fastify)
      const plain = { video_url: CLIP, roles: [{ kind: "person", name: "the woman", images: [DETECTIVE] }] }
      for (const args of [
        ARGS,
        { ...ARGS, confirm: true },
        { ...plain, clip_kind: "previz" },
        { ...plain, previz_lighting: false },
        { ...plain, previz_sound: "clip" },
        { video_url: CLIP, roles: [{ kind: "person", name: "the woman", subject: "the detective", images: [DETECTIVE] }] },
      ]) {
        const res = await callTool(server, "video_remake", args)
        expect(res.isError, JSON.stringify([castSwap, args])).toBe(true)
        expect(res.content[0]!.text).toContain("[previz_unavailable]")
        expect(res.content[0]!.text).toContain("Send an ordinary clip instead")
      }
      expect(calls, JSON.stringify(castSwap)).toEqual([])
    }
  })

  it("such an engine still quotes and runs an ordinary clip, footage named or not", async () => {
    setPluginSupports({ castSwap: CS as never })
    const { fastify, calls } = stubFastify(routes())
    const server = serverWith(fastify)
    const plain = { video_url: CLIP, roles: [{ kind: "person", name: "the woman", images: [DETECTIVE] }] }
    expect((await callTool(server, "video_remake", plain)).isError).toBeFalsy()
    expect((await callTool(server, "video_remake", { ...plain, clip_kind: "footage", confirm: true })).isError).toBeFalsy()
    expect(urls(calls)).toEqual(["/v1/video-remake/estimate", "/v1/video-remake"])
    for (const call of calls) {
      expect(call.payload).not.toHaveProperty("clipKind")
      expect(call.payload).not.toHaveProperty("previz")
    }
  })

  it("a deployment that does not accept one answers the same previz_unavailable, on the quote and on the run, and starts nothing", async () => {
    const quote = stubFastify({ "/v1/video-remake/estimate": NOT_ACCEPTED })
    const quoted = await callTool(serverWith(quote.fastify), "video_remake", ARGS)
    expect(quoted.isError).toBe(true)
    expect(quoted.content[0]!.text).toContain("[previz_unavailable]")
    expect(urls(quote.calls)).toEqual(["/v1/video-remake/estimate"])

    const run = stubFastify({ "/v1/video-remake": NOT_ACCEPTED })
    const ran = await callTool(serverWith(run.fastify), "video_remake", { ...ARGS, confirm: true })
    expect(ran.isError).toBe(true)
    expect(ran.content[0]!.text).toContain("[previz_unavailable]")
    expect(ran.structuredContent).toBeUndefined()
  })
})
