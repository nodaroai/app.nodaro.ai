/**
 * A trend's engine prompt (ee/routes/admin-trends-prompt-parts.ts).
 *
 * What must hold:
 *  - GET asks this environment's engine (`POST /v1/cast-swap/prompt-parts`,
 *    internal only) with the draft's shape and its stored overrides, and
 *    answers the engine's answer as it is, with the stored overrides and the
 *    revision;
 *  - an engine without the route is 503 `engine_unsupported` (never asked);
 *    an answer outside the contract is 502;
 *  - PUT has the engine check the overrides first: any problem is 422 with
 *    the problems, and nothing is stored; a clean answer stores each text with
 *    the default's hash the engine answered, and audits it; empty texts are
 *    the defaults; none at all clears without asking the engine;
 *  - PUT is guarded on the draft's revision;
 *  - a client's draft save never changes the stored overrides;
 *  - publish re-asks the engine with the draft as it is NOW (each prompt mode,
 *    as a trend: `source`, no `style`, so the engine keeps room for the
 *    user's details), and any problem — `part_not_used` for an override the
 *    mode no longer uses among them — holds it as `prompt_parts_invalid`
 *    with every problem; no overrides, or an engine without the route, asks
 *    nothing; an engine that cannot answer is relayed, never published past;
 *  - every route is admin-only.
 *
 * The store is an in-memory stand-in (as in admin-trends-crop.test.ts); audit
 * rows go through the recording fake Supabase; the engine route is a stub
 * answering the contract's exact shapes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { type QueryResult, type RecordedQuery } from "../../../lib/__tests__/fake-supabase-query.js"
import type { TrendRow, TrendVersionData } from "../../lib/trends/types.js"

const db = vi.hoisted(() => ({ log: [] as Array<{ table: string; ops: Array<{ m: string; a: unknown[] }> }> }))

// A publish's background web copies (web-copy.ts, pinned in its own tests): never made here.
vi.mock("../../lib/trends/web-copy.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/trends/web-copy.js")>()),
  startWebCopies: () => Promise.resolve(),
}))

vi.mock("../../../lib/supabase.js", async () => {
  const { makeFakeFrom } = await import("../../../lib/__tests__/fake-supabase-query.js")
  return { supabase: { from: makeFakeFrom(db.log as RecordedQuery[], (q: RecordedQuery): QueryResult => (q.table === "engine_environments" ? { data: [], error: null } : { data: null, error: null })) } }
})

type MemVersion = { data: TrendVersionData; published: boolean; revision?: string }
type MemTrend = TrendRow & { versions: Record<number, MemVersion> }

const mem = vi.hoisted(() => ({ revs: 0, trends: [] as MemTrend[], admins: new Set<string>() }))

vi.mock("../../lib/trends/store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/trends/store.js")>()
  const strip = (t: MemTrend): TrendRow => {
    const { versions: _v, ...row } = t
    return { ...row, tags: [...row.tags], badges: [...row.badges] }
  }
  const rev = (v: MemVersion) => (v.revision ??= `rev-${++mem.revs}`)
  return {
    ...actual,
    getTrendById: async (id: string) => {
      const t = mem.trends.find((x) => x.id === id)
      return t ? strip(t) : null
    },
    getVersion: async (id: string, version: number) => {
      const v = mem.trends.find((x) => x.id === id)?.versions[version]
      return v ? structuredClone(v.data) : null
    },
    getDraftState: async (id: string) => {
      const t = mem.trends.find((x) => x.id === id)
      if (!t) return null
      const v = t.versions[t.draftVersion]!
      return { trend: strip(t), data: structuredClone(v.data), revision: rev(v) }
    },
    saveDraft: async (id: string, data: TrendVersionData, opts: { expectedRevision?: string } = {}) => {
      const t = mem.trends.find((x) => x.id === id)
      if (!t) throw new actual.TrendNotFoundError(id)
      const cur = t.versions[t.draftVersion]!
      if (opts.expectedRevision !== undefined && rev(cur) !== opts.expectedRevision) throw new actual.DraftConflictError(id)
      const revision = `rev-${++mem.revs}`
      cur.data = structuredClone(data)
      cur.revision = revision
      return { version: t.draftVersion, revision }
    },
  }
})

vi.mock("../../../lib/admin-check.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/admin-check.js")>()
  return { ...actual, checkIsAdmin: async (userId: string) => mem.admins.has(userId) }
})

// A draft save (and publish) cuts the 4 s preview's input clip when it is missing; here the cut is a stand-in
// (preview-clip-media.test.ts pins the real one): this file is about the prompt parts.
vi.mock("../../lib/trends/preview-clip-media.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/trends/preview-clip-media.js")>()
  const { previewClipState, withoutPreviewClip, PREVIEW_CLIP_RECIPE } = await import("../../lib/trends/preview-clip.js")
  const ensurePreviewClip: typeof actual.ensurePreviewClip = async (trendId, data) => {
    const state = previewClipState(data)
    if (state.kind === "not_offered") return withoutPreviewClip(data)
    if (state.kind === "current") return data
    return {
      ...data,
      previewClip: {
        videoUrl: `https://cdn.test/trends/${trendId}/preview.mp4`, durationSec: 5, width: 1920, height: 1080, frames: 150, sha256: "a".repeat(64),
        sourceVideoUrl: data.source!.videoUrl, startSec: data.previewStart!, recipe: PREVIEW_CLIP_RECIPE, madeAt: "2026-10-27T12:00:00.000Z",
      },
    }
  }
  return { ...actual, ensurePreviewClip }
})

import { adminTrendsRoutes } from "../admin-trends.js"
import { _resetPluginSupportsForTests, setPluginSupports } from "../../../lib/private-plugins/supports-registry.js"
import { placeholderImageUrl } from "../../lib/trends/prompt-parts-store.js"

const ADMIN = "00000000-0000-4000-8000-0000000000ad"
const USER = "00000000-0000-4000-8000-000000000001"
const SECRET = "0".repeat(64) // src/test/setup.ts
const T1 = "00000000-0000-4000-8000-0000000000a1"
const SRC = `https://cdn.test/trends/${T1}/src.mp4`
const HASH = "0123456789abcdef"
const FACE_HASH = "fedcba9876543210"

const CAST_SWAP = {
  roleKinds: ["person", "location", "product", "pet"] as Array<"person" | "location" | "product" | "pet">,
  fixedReferences: true,
  fullQuality: true,
  resolutions: ["480p", "720p", "1080p"] as Array<"480p" | "720p" | "1080p">,
  trendRun: true,
  promptParts: true,
}

function draftData(over: Partial<TrendVersionData> = {}): TrendVersionData {
  return {
    name: { en: "Office Attack" },
    source: { videoUrl: SRC, durationSec: 12, width: 1920, height: 1080 },
    previewStart: 0,
    slots: [{ key: "lead", label: { en: "Lead" }, kind: "person", required: true, roleName: "the man with the keyboard" }],
    references: [],
    trendPrompt: "He smashes the desk.",
    examples: [],
    ...over,
  }
}

function seed(data = draftData()) {
  mem.trends.push({
    id: T1, slug: "office-attack", status: "draft", tags: [], badges: [], sortOrder: 0,
    draftVersion: 1, publishedVersion: null, createdAt: "2026-10-20T00:00:00Z", updatedAt: "2026-10-20T00:00:00Z",
    versions: { 1: { data, published: false } },
  })
}

/** The engine's answer, as the contract fixes it. */
function answer(problems: Array<{ part?: string; code: string; message: string }> = []) {
  return {
    set: "faces",
    parts: [
      { id: "opener", default: "edit {video:1} as follows:\n", defaultHash: HASH, placeholders: ["{video}"], required: [], applies: true },
      { id: "face", default: "Keep the faces.", defaultHash: FACE_HASH, placeholders: [], required: [], applies: true },
      { id: "person", default: "{name}: {image}", defaultHash: HASH, placeholders: ["{name}", "{image}"], required: ["{image}"], applies: true },
      { id: "depthGuard", default: "", defaultHash: HASH, placeholders: ["{video}"], required: [], applies: false },
    ],
    assembled: "edit {video:1} as follows:\nKeep the faces.",
    length: 44,
    max: 4000,
    problems,
  }
}

const engine = {
  calls: [] as Array<{ headers: Record<string, unknown>; body: Record<string, unknown> }>,
  status: 200,
  reply: answer() as unknown,
}

let app: FastifyInstance

beforeEach(async () => {
  db.log.length = 0
  mem.revs = 0
  mem.trends = []
  mem.admins = new Set([ADMIN])
  engine.calls = []
  engine.status = 200
  engine.reply = answer()
  _resetPluginSupportsForTests()
  setPluginSupports({ castSwap: { ...CAST_SWAP } })
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    if (req.headers["x-internal-orchestrator-secret"] === SECRET) {
      req.authKind = "internal"
      req.userId = req.headers["x-internal-user-id"] as string
      return
    }
    const user = req.headers["x-user-id"]
    if (typeof user === "string") req.userId = user
  })
  // The plugin's prompt parts route: internal only, as the plugin answers it.
  app.post("/v1/cast-swap/prompt-parts", async (req, reply) => {
    if (req.authKind !== "internal") return reply.status(403).send({ error: { code: "forbidden", message: "Internal only" } })
    engine.calls.push({ headers: { ...req.headers }, body: req.body as Record<string, unknown> })
    return reply.status(engine.status).send(engine.reply)
  })
  await app.register(adminTrendsRoutes)
  await app.ready()
})

afterEach(async () => {
  await app.close()
  _resetPluginSupportsForTests()
})

function call(method: "GET" | "PUT" | "POST", url: string, payload?: unknown, userId = ADMIN) {
  return app.inject({ method, url, headers: { "x-user-id": userId }, ...(payload !== undefined ? { payload: payload as object } : {}) })
}
const URL = `/v1/admin/trends/${T1}/prompt-parts`
const revisionOf = async () => (await call("GET", `/v1/admin/trends/${T1}`)).json().data.revision as string
const draftNow = () => mem.trends[0]!.versions[1]!.data
const audits = () =>
  db.log.filter((q) => q.table === "admin_actions" && q.ops.some((op) => op.m === "insert")).map((q) => q.ops.find((op) => op.m === "insert")!.a[0] as Record<string, unknown>)

describe("GET /v1/admin/trends/:id/prompt-parts", () => {
  it("asks the engine with the draft's shape and stored overrides, and answers its answer as it is", async () => {
    seed(draftData({ engine: "kling-4", promptParts: { face: { text: "Faces stay.", defaultHash: FACE_HASH } } }))
    const res = await call("GET", URL)
    expect(res.statusCode).toBe(200)
    expect(engine.calls).toHaveLength(1)
    expect(engine.calls[0]!.headers["x-internal-user-id"]).toBe(ADMIN)
    expect(engine.calls[0]!.body).toEqual({
      engine: "kling-4",
      source: "faces",
      hasAudio: true,
      roles: [{ kind: "person", name: "the man with the keyboard", images: [1, 2, 3].map((j) => placeholderImageUrl(1, j)), body: "new", outfit: "new", hair: "new" }],
      references: [],
      postPrompt: "He smashes the desk.",
      overrides: { face: "Faces stay." },
    })
    const data = res.json().data
    const { overrides, revision, ...asked } = data
    expect(asked).toEqual(answer())
    expect(overrides).toEqual({ face: { text: "Faces stay.", defaultHash: FACE_HASH } })
    expect(revision).toBe(await revisionOf())
  })

  it("takes the answer under `data` too", async () => {
    seed()
    engine.reply = { data: answer() }
    const res = await call("GET", URL)
    expect(res.statusCode).toBe(200)
    expect(res.json().data.set).toBe("faces")
  })

  it("is 503 engine_unsupported for an engine without the route, which is never asked", async () => {
    seed()
    setPluginSupports({ castSwap: { ...CAST_SWAP, promptParts: undefined } })
    const res = await call("GET", URL)
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("engine_unsupported")
    expect(engine.calls).toHaveLength(0)
  })

  it("is 502 for an answer outside the contract, and relays the engine's own refusal", async () => {
    seed()
    engine.reply = { set: "faces", parts: "nope" }
    expect((await call("GET", URL)).statusCode).toBe(502)
    engine.status = 400
    engine.reply = { error: { code: "validation_error", message: "bad roles" } }
    const res = await call("GET", URL)
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("is admin-only, and 404 for an unknown trend", async () => {
    seed()
    expect((await call("GET", URL, undefined, USER)).statusCode).toBe(403)
    expect((await call("GET", `/v1/admin/trends/00000000-0000-4000-8000-0000000000ff/prompt-parts`)).statusCode).toBe(404)
    expect(engine.calls).toHaveLength(0)
  })
})

describe("PUT /v1/admin/trends/:id/prompt-parts", () => {
  it("stores each text with the default's hash the engine answered, and audits it", async () => {
    seed()
    const res = await call("PUT", URL, { parts: { face: "Faces stay.", person: "", avoid: undefined }, revision: await revisionOf() })
    expect(res.statusCode).toBe(200)
    // Empty = the default: never sent, never stored.
    expect(engine.calls[0]!.body.overrides).toEqual({ face: "Faces stay." })
    expect(draftNow().promptParts).toEqual({ face: { text: "Faces stay.", defaultHash: FACE_HASH } })
    expect(res.json().data).toMatchObject({ version: 1, overrides: { face: { text: "Faces stay.", defaultHash: FACE_HASH } }, set: "faces" })
    expect(audits()).toEqual([
      expect.objectContaining({
        action: "update_trend_prompt_parts",
        target_type: "trend",
        target_id: T1,
        payload: { slug: "office-attack", before: null, after: { face: { text: "Faces stay.", defaultHash: FACE_HASH } } },
      }),
    ])
  })

  it("is 422 with the engine's problems, and stores nothing", async () => {
    seed(draftData({ promptParts: { face: { text: "Faces stay.", defaultHash: FACE_HASH } } }))
    engine.reply = answer([{ part: "person", code: "missing_placeholder", message: "The person line needs {image}." }])
    const res = await call("PUT", URL, { parts: { person: "{name} dances" }, revision: await revisionOf() })
    expect(res.statusCode).toBe(422)
    expect(res.json().error).toMatchObject({
      code: "prompt_parts_invalid",
      message: "The person line needs {image}.",
      problems: [{ part: "person", code: "missing_placeholder", message: "The person line needs {image}." }],
    })
    expect(draftNow().promptParts).toEqual({ face: { text: "Faces stay.", defaultHash: FACE_HASH } })
    expect(audits()).toEqual([])
  })

  it("relays a required part removed (part_required) as 422, never as an answer off the contract", async () => {
    seed()
    engine.reply = answer([{ part: "opener", code: "part_required", message: "The opener is required in this mode." }])
    const res = await call("PUT", URL, { parts: { opener: "-" }, revision: await revisionOf() })
    expect(res.statusCode).toBe(422)
    expect(res.json().error).toMatchObject({ code: "prompt_parts_invalid", problems: [{ part: "opener", code: "part_required" }] })
    expect(draftNow()).not.toHaveProperty("promptParts")
  })

  it("clears every override without asking the engine (an engine without the route too)", async () => {
    seed(draftData({ promptParts: { face: { text: "Faces stay.", defaultHash: FACE_HASH } } }))
    setPluginSupports({ castSwap: { ...CAST_SWAP, promptParts: undefined } })
    const res = await call("PUT", URL, { parts: { face: "" }, revision: await revisionOf() })
    expect(res.statusCode).toBe(200)
    expect(engine.calls).toHaveLength(0)
    expect(draftNow()).not.toHaveProperty("promptParts")
    expect(audits()[0]).toMatchObject({ payload: { before: { face: { text: "Faces stay.", defaultHash: FACE_HASH } }, after: null } })
  })

  it("is 503 engine_unsupported for overrides an engine without the route cannot check", async () => {
    seed()
    setPluginSupports({ castSwap: { ...CAST_SWAP, promptParts: undefined } })
    const res = await call("PUT", URL, { parts: { face: "Faces stay." }, revision: await revisionOf() })
    expect(res.statusCode).toBe(503)
    expect(draftNow()).not.toHaveProperty("promptParts")
  })

  it("refuses a stale revision, an unknown part, an over-long text and a hash sent by the client", async () => {
    seed()
    const revision = await revisionOf()
    expect((await call("PUT", URL, { parts: { face: "x" }, revision: "rev-old" })).statusCode).toBe(409)
    expect((await call("PUT", URL, { parts: { faces: "x" }, revision })).statusCode).toBe(400)
    expect((await call("PUT", URL, { parts: { face: "x".repeat(2001) }, revision })).statusCode).toBe(400)
    expect((await call("PUT", URL, { parts: { face: { text: "x", defaultHash: HASH } }, revision })).statusCode).toBe(400)
    expect((await call("PUT", URL, { parts: { face: "x" } })).statusCode).toBe(400)
    expect(engine.calls).toHaveLength(0)
  })

  it("is admin-only", async () => {
    seed()
    expect((await call("PUT", URL, { parts: { face: "x" }, revision: await revisionOf() }, USER)).statusCode).toBe(403)
    expect(engine.calls).toHaveLength(0)
  })
})

describe("a client's draft save", () => {
  it("never changes the stored overrides", async () => {
    seed(draftData({ promptParts: { face: { text: "Faces stay.", defaultHash: FACE_HASH } } }))
    const body = { ...draftData({ name: { en: "Renamed" } }), promptParts: { avoid: { text: "-", defaultHash: HASH } } }
    const res = await call("PUT", `/v1/admin/trends/${T1}/draft`, { data: body, revision: await revisionOf() })
    expect(res.statusCode).toBe(200)
    expect(draftNow().name).toEqual({ en: "Renamed" })
    expect(draftNow().promptParts).toEqual({ face: { text: "Faces stay.", defaultHash: FACE_HASH } })

    // A body without the key keeps them too.
    const { promptParts: _p, ...without } = body
    expect((await call("PUT", `/v1/admin/trends/${T1}/draft`, { data: without, revision: await revisionOf() })).statusCode).toBe(200)
    expect(draftNow().promptParts).toEqual({ face: { text: "Faces stay.", defaultHash: FACE_HASH } })
  })
})

describe("POST /v1/admin/trends/:id/publish — the engine prompt changes", () => {
  const PUBLISH = `/v1/admin/trends/${T1}/publish`
  const reasons = (res: { json: () => { error: { reasons: Array<{ code: string }> } } }) => res.json().error.reasons
  const partsBlocker = (res: { json: () => { error: { reasons: Array<{ code: string }> } } }) => reasons(res).find((r) => r.code === "prompt_parts_invalid")

  it("asks the engine with the draft as it is now, as a trend (source, no style), and blocks on every problem", async () => {
    // Saved for a face mask; the draft prepares its clip as Full depth since.
    seed(draftData({ promptParts: { keep: { text: "{video} stays.", defaultHash: HASH } }, faceMasking: { mode: "always", source: "full-depth" } as TrendVersionData["faceMasking"] }))
    engine.reply = answer([{ part: "keep", code: "part_not_used", message: "The keep part is not used in this mode." }])
    const res = await call("POST", PUBLISH, {})
    expect(res.statusCode).toBe(409)
    expect(partsBlocker(res)).toEqual({
      code: "prompt_parts_invalid",
      problems: [{ part: "keep", code: "part_not_used", message: "The keep part is not used in this mode." }],
      message: "The engine prompt changes no longer fit this trend: The keep part is not used in this mode.",
    })
    expect(engine.calls).toHaveLength(1)
    const body = engine.calls[0]!.body
    expect(body).toMatchObject({ engine: "seedance-2-5", source: "full-depth", postPrompt: "He smashes the desk.", overrides: { keep: "{video} stays." } })
    // The engine keeps the details' room for a trend's request itself: never padded here as well.
    expect(body).not.toHaveProperty("style")
    expect(mem.trends[0]!.status).toBe("draft")
  })

  it("asks once per prompt mode, a problem only the 4 s preview has named so", async () => {
    seed(draftData({ previewTrendPrompt: "He smashes it, fast.", promptParts: { face: { text: "Faces stay.", defaultHash: FACE_HASH } } }))
    engine.reply = answer([{ code: "prompt_too_long", message: "The prompt is too long." }])
    const res = await call("POST", PUBLISH, {})
    expect(engine.calls.map((c) => c.body.postPrompt)).toEqual(["He smashes the desk.", "He smashes it, fast."])
    // The same problem in both modes is listed once, as the full run's.
    expect(partsBlocker(res)).toMatchObject({ problems: [{ code: "prompt_too_long", message: "The prompt is too long." }] })
  })

  it("is not held for the engine prompt when the engine finds nothing", async () => {
    seed(draftData({ promptParts: { face: { text: "Faces stay.", defaultHash: FACE_HASH } } }))
    const res = await call("POST", PUBLISH, {})
    expect(engine.calls).toHaveLength(1)
    expect(partsBlocker(res)).toBeUndefined()
  })

  it("asks nothing without overrides, or of an engine without the route", async () => {
    seed()
    expect(partsBlocker(await call("POST", PUBLISH, {}))).toBeUndefined()
    mem.trends = []
    seed(draftData({ promptParts: { face: { text: "Faces stay.", defaultHash: FACE_HASH } } }))
    setPluginSupports({ castSwap: { ...CAST_SWAP, promptParts: undefined } })
    expect(partsBlocker(await call("POST", PUBLISH, {}))).toBeUndefined()
    expect(engine.calls).toHaveLength(0)
  })

  it("relays an engine that cannot answer, and never publishes past it", async () => {
    seed(draftData({ promptParts: { face: { text: "Faces stay.", defaultHash: FACE_HASH } } }))
    engine.status = 400
    engine.reply = { error: { code: "validation_error", message: "bad roles" } }
    const refused = await call("POST", PUBLISH, {})
    expect(refused.statusCode).toBe(400)
    expect(refused.json().error.code).toBe("validation_error")
    engine.status = 200
    engine.reply = { set: "faces", parts: "nope" }
    expect((await call("POST", PUBLISH, {})).statusCode).toBe(502)
    expect(mem.trends[0]!.status).toBe("draft")
  })
})
