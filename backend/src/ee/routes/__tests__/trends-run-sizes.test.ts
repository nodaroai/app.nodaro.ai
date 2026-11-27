/**
 * A trend run's sizes (ee/routes/trends.ts, ee/lib/trends/sizes.ts): what the trend page lists as
 * `resolutions`, what a run may ask for, and what the engine is sent.
 *
 * What must hold:
 *  - with an engine that does not declare BOTH `castSwap.deliveredResolution` and
 *    `castSwap.trendDeliveredResolution`, every trend answer and every body the engine is sent is
 *    exactly what it was before trend runs could be read by the size delivered (the snapshot was
 *    recorded against the code of before, and each engine without both flags must match it);
 *  - with both, the page lists the sizes delivered for the trend's engine choice and says
 *    `deliveredResolution: true`, and a run is sent the size delivered with `trendRun.delivered`
 *    (a draft excepted: it is sent as before, without the marker).
 *
 * The store is an in-memory stand-in, the database reads go through the recording fake Supabase,
 * and Video Remake is a stub route on the same app that records what it receives.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import type { QueryResult, RecordedQuery } from "../../../lib/__tests__/fake-supabase-query.js"
import type { TrendRow, TrendVersionData } from "../../lib/trends/types.js"

const db = vi.hoisted(() => ({
  log: [] as RecordedQuery[],
  respond: null as null | ((q: RecordedQuery) => QueryResult),
}))

vi.mock("../../../lib/supabase.js", async () => {
  const { makeFakeFrom } = await import("../../../lib/__tests__/fake-supabase-query.js")
  return { supabase: { from: makeFakeFrom(db.log, (q) => db.respond!(q)) } }
})

const mem = vi.hoisted(() => ({
  trends: [] as Array<TrendRow & { versions: Record<number, TrendVersionData> }>,
}))

/** The app settings the routes read (only the Precise upscale matters here); `fails` = a read that fails. */
const settings = vi.hoisted(() => ({ precise: null as unknown, fails: false, reads: 0 }))

vi.mock("../../../lib/app-settings.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/app-settings.js")>()
  const { markSettingsReadFailed } = await import("../../../lib/app-settings-read-status.js")
  return {
    ...actual,
    getAppSettings: async () => {
      settings.reads += 1
      const read = { nodaro_motion_precise_upscale: settings.precise } as never
      if (settings.fails) markSettingsReadFailed(read)
      return read
    },
  }
})

vi.mock("../../lib/trends/store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/trends/store.js")>()
  const strip = (t: (typeof mem.trends)[number]): TrendRow => {
    const { versions: _v, ...row } = t
    return row
  }
  return {
    ...actual,
    getTrendBySlug: async (slug: string) => {
      const t = mem.trends.find((x) => x.slug === slug)
      return t ? strip(t) : null
    },
    getVersion: async (id: string, version: number) => mem.trends.find((x) => x.id === id)?.versions[version] ?? null,
    favoriteIds: async () => new Set<string>(),
    versionsHidingOriginal: async () => new Set<string>(),
  }
})

import { trendRoutes } from "../trends.js"
import { _resetPluginSupportsForTests, setPluginSupports } from "../../../lib/private-plugins/supports-registry.js"
import { _resetTrendCatalogCacheForTests } from "../../lib/trends/catalog-stamp.js"

// ── fixtures ───────────────────────────────────────────────────────────────

const USER = "00000000-0000-4000-8000-000000000001"
const SECRET = "0".repeat(64) // src/test/setup.ts

const DISPLAY = {
  videoUrl: "https://cdn.example/trends/display-copy.mp4",
  posterUrl: "https://cdn.example/trends/display-poster.png",
  width: 720,
  height: 1280,
  durationSec: 12,
}

function versionData(over: Partial<TrendVersionData> = {}): TrendVersionData {
  return {
    name: { en: "Neon Dance" },
    source: { videoUrl: "https://cdn.example/trends/src.mp4", durationSec: 12, width: 720, height: 1280, display: DISPLAY },
    previewStart: 2,
    slots: [{ key: "lead", label: { en: "Lead dancer" }, kind: "person", required: true, roleName: "the woman" }],
    references: [],
    trendPrompt: "dance under the neon",
    examples: [
      {
        videoUrl: "https://cdn.example/ex1.mp4",
        width: 720,
        height: 1280,
        durationSec: 12,
        slots: { lead: ["https://cdn.example/ex1-lead.png"] },
        sourceJobId: "00000000-0000-4000-8000-0000000000e1",
      },
    ],
    ...over,
  }
}

/** The four engine choices a trend can be made on. */
const TRENDS = {
  prism: versionData(),
  pulse: versionData({ engine: "kling-4" }),
  "prism-flash": versionData({ flash: true }),
  "pulse-flash": versionData({ engine: "kling-4", flash: true }),
} as const satisfies Record<string, TrendVersionData>
type TrendKind = keyof typeof TRENDS
const KINDS = Object.keys(TRENDS) as TrendKind[]

function seed() {
  mem.trends = KINDS.map((kind, i) => ({
    id: `00000000-0000-4000-8000-0000000000a${i + 1}`,
    slug: kind,
    status: "published" as const,
    tags: [],
    badges: [],
    sortOrder: i,
    draftVersion: 1,
    publishedVersion: 1,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    versions: { 1: TRENDS[kind] },
  }))
}

/** An engine that runs every trend here: both engines and both Flash choices. */
const CAST_SWAP = {
  roleKinds: ["person", "location", "product", "pet"],
  fixedReferences: true,
  fullQuality: true,
  resolutions: ["480p", "720p", "1080p"],
  trendRun: true,
  engines: ["nodaro-prism", "nodaro-pulse", "nodaro-prism-flash", "nodaro-pulse-flash"],
  flashChoices: true,
}

/** What the engine declares it can deliver per engine choice while its delivered sizes are on. */
const DELIVERED_RESOLUTIONS = {
  "nodaro-prism": [{ size: "720p", from: "480p", native: true }, { size: "1080p", from: "720p", native: true }, { size: "4k", from: "1080p" }],
  "nodaro-pulse": [{ size: "720p", native: true }, { size: "1080p", from: "720p", native: true }, { size: "4k", from: "1080p" }],
  "nodaro-prism-flash": [{ size: "720p", from: "480p", native: true }, { size: "1080p", from: "720p" }],
  "nodaro-pulse-flash": [{ size: "720p", native: true }, { size: "1080p", from: "720p" }],
}

/** Engines that do not read a trend run by the size delivered: each must answer exactly as before. */
const OLD_ENGINES: Record<string, Record<string, unknown>> = {
  "no flag": CAST_SWAP,
  "delivered sizes on direct runs only": { ...CAST_SWAP, deliveredResolution: true, deliveredResolutions: DELIVERED_RESOLUTIONS, upscaleChoice: true, preciseUpscale: true },
  "the trend flag without delivered sizes": { ...CAST_SWAP, trendDeliveredResolution: true, preciseUpscale: true },
}

const engine = {
  calls: [] as Array<{ url: string; body: Record<string, unknown> }>,
  /** What the stub answers instead of its success (a refusal), for both routes. */
  refusal: null as null | { status: number; body: unknown },
}

let app: FastifyInstance

async function boot(castSwap: Record<string, unknown>) {
  if (app) await app.close()
  _resetPluginSupportsForTests()
  setPluginSupports({ castSwap: structuredClone(castSwap) as never })
  _resetTrendCatalogCacheForTests()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    if (req.headers["x-internal-orchestrator-secret"] === SECRET) {
      req.authKind = "internal"
      req.userId = req.headers["x-internal-user-id"] as string
      return
    }
    const user = req.headers["x-user-id"]
    if (typeof user === "string") {
      req.userId = user
      req.authKind = "jwt"
    }
  })
  app.post("/v1/cast-swap", async (req, reply) => {
    engine.calls.push({ url: "/v1/cast-swap", body: req.body as Record<string, unknown> })
    if (engine.refusal) return reply.status(engine.refusal.status).send(engine.refusal.body)
    return reply.status(202).send({ jobId: "00000000-0000-4000-8000-0000000000j1" })
  })
  app.post("/v1/cast-swap/estimate", async (req, reply) => {
    engine.calls.push({ url: "/v1/cast-swap/estimate", body: req.body as Record<string, unknown> })
    if (engine.refusal) return reply.status(engine.refusal.status).send(engine.refusal.body)
    return reply.status(200).send({ totalCredits: 120, breakdown: { castSwap: 40, seedance: 80 } })
  })
  await app.register(trendRoutes)
  await app.ready()
}

beforeEach(() => {
  db.log.length = 0
  db.respond = () => ({ data: null, error: null })
  engine.calls = []
  engine.refusal = null
  settings.precise = null
  settings.fails = false
  settings.reads = 0
  seed()
})

afterEach(async () => {
  if (app) await app.close()
  _resetPluginSupportsForTests()
})

const as = { "x-user-id": USER }
const SLOTS = { lead: { images: ["https://u.example/me.png"] } }

/** Every request shape a client may send about the size. */
const REQUESTS: Record<string, Record<string, unknown>> = {
  "no size": {},
  "480p": { resolution: "480p" },
  "720p": { resolution: "720p" },
  "1080p": { resolution: "1080p" },
  "4k": { resolution: "4k" },
  draft: { draft: true },
  "draft at 480p": { draft: true, resolution: "480p" },
  "draft at 720p": { draft: true, resolution: "720p" },
  preview: { preview: true },
  "preview at 720p": { preview: true, resolution: "720p" },
}

/** Everything a caller and the engine see of one trend, for the engine booted. */
async function observe(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {}
  for (const kind of KINDS) {
    const signedIn = await app.inject({ method: "GET", url: `/v1/trends/${kind}`, headers: as })
    const guest = await app.inject({ method: "GET", url: `/v1/trends/${kind}?locale=en` })
    const detail = { status: signedIn.statusCode, resolutions: signedIn.json().data?.resolutions, keys: Object.keys(signedIn.json().data ?? {}).sort(), guest: guest.json() }
    const runs: Record<string, unknown> = {}
    for (const [name, extra] of Object.entries(REQUESTS)) {
      const payload = { slots: SLOTS, ...extra }
      engine.calls = []
      const estimate = await app.inject({ method: "POST", url: `/v1/trends/${kind}/estimate`, headers: as, payload })
      const run = await app.inject({ method: "POST", url: `/v1/trends/${kind}/runs`, headers: as, payload })
      runs[name] = {
        estimate: { status: estimate.statusCode, body: estimate.json() },
        run: { status: run.statusCode, body: run.json() },
        sent: engine.calls.map((c) => ({ url: c.url, body: c.body })),
      }
    }
    out[kind] = { detail, runs }
  }
  return out
}

// ── an engine that does not read trend runs by the size delivered ────────────

describe("trend sizes without an engine that reads trend runs by the size delivered", () => {
  it("answers and sends exactly what it did before (recorded)", async () => {
    await boot(OLD_ENGINES["no flag"]!)
    expect(await observe()).toMatchSnapshot()
  })

  for (const [name, castSwap] of Object.entries(OLD_ENGINES)) {
    if (name === "no flag") continue
    it(`${name}: the same answers and bodies as an engine with no flag`, async () => {
      await boot(OLD_ENGINES["no flag"]!)
      const before = await observe()
      await boot(castSwap)
      expect(await observe()).toEqual(before)
    })
  }
})

// ── an engine that reads trend runs by the size delivered ─────────────────────

/** Both flags, the sizes it can deliver, and the Precise upscale (a Prism-family step reads the admin's rows). */
const DELIVERS = { ...CAST_SWAP, deliveredResolution: true, deliveredResolutions: DELIVERED_RESOLUTIONS, upscaleChoice: true, preciseUpscale: true, trendDeliveredResolution: true }

const detailOf = async (kind: TrendKind, headers: Record<string, string> = as, query = "") => app.inject({ method: "GET", url: `/v1/trends/${kind}${query}`, headers })
const runOf = (kind: TrendKind, extra: Record<string, unknown>) =>
  app.inject({ method: "POST", url: `/v1/trends/${kind}/runs`, headers: as, payload: { slots: SLOTS, ...extra } })
const estimateOf = (kind: TrendKind, extra: Record<string, unknown>) =>
  app.inject({ method: "POST", url: `/v1/trends/${kind}/estimate`, headers: as, payload: { slots: SLOTS, ...extra } })

describe("trend sizes with an engine that reads trend runs by the size delivered", () => {
  beforeEach(async () => {
    await boot(DELIVERS)
  })

  it("the page lists each engine choice's sizes delivered here, and says so", async () => {
    const want: Record<TrendKind, string[]> = {
      prism: ["720p", "1080p", "4k"],
      pulse: ["720p", "1080p", "4k"],
      "prism-flash": ["720p", "1080p"],
      "pulse-flash": ["720p", "1080p"],
    }
    for (const kind of KINDS) {
      const res = await detailOf(kind)
      expect(res.statusCode).toBe(200)
      expect(res.json().data.resolutions, kind).toEqual(want[kind])
      expect(res.json().data.deliveredResolution, kind).toBe(true)
    }
  })

  it("follows the admin's Precise upscale: a row switched off drops the size it delivers, all off gives Prism's own sizes", async () => {
    settings.precise = { "1080p": "off" }
    expect((await detailOf("prism")).json().data.resolutions).toEqual(["720p", "1080p"])
    settings.precise = { "480p": "off", "720p": "off", "1080p": "off", flash: { "480p": "off", "720p": "off" } }
    expect((await detailOf("prism")).json().data.resolutions).toEqual(["480p", "720p", "1080p"])
    expect((await detailOf("prism-flash")).json().data.resolutions).toEqual(["480p", "720p"])
    // Nodaro Pulse has no row of its own.
    expect((await detailOf("pulse")).json().data.resolutions).toEqual(["720p", "1080p", "4k"])
  })

  it("a run with no size is sent the first size delivered, draft false, with the marker; the quote is asked for the same", async () => {
    for (const send of [runOf, estimateOf]) {
      engine.calls = []
      const res = await send("prism", {})
      expect(res.statusCode).toBeLessThan(300)
      expect(engine.calls).toHaveLength(1)
      const body = engine.calls[0]!.body
      expect(body).toMatchObject({ resolution: "720p", draft: false })
      expect(body.trendRun).toMatchObject({ delivered: true })
    }
  })

  it("4K is taken where it is listed, by the size delivered", async () => {
    for (const kind of ["prism", "pulse"] as const) {
      engine.calls = []
      const res = await runOf(kind, { resolution: "4k" })
      expect(res.statusCode, kind).toBe(202)
      expect(engine.calls[0]!.body).toMatchObject({ resolution: "4k", draft: false, trendRun: { delivered: true } })
    }
  })

  it("a size not listed is refused before anything is sent, naming the sizes listed", async () => {
    for (const [kind, size] of [["prism", "480p"], ["pulse", "480p"], ["prism-flash", "4k"], ["pulse-flash", "4k"]] as const) {
      engine.calls = []
      const res = await runOf(kind, { resolution: size })
      expect(res.statusCode, `${kind} ${size}`).toBe(400)
      expect(res.json().error.code).toBe("resolution_unsupported")
      expect(engine.calls).toHaveLength(0)
    }
    const prism = await estimateOf("prism", { resolution: "480p" })
    expect(prism.json().error.message).toBe("This trend runs at 720p or 1080p or 4K, not 480p.")
  })

  it("a draft is the engine's own 480p take, sent as before (no marker), whatever the list says", async () => {
    for (const extra of [{ draft: true }, { draft: true, resolution: "480p" }]) {
      engine.calls = []
      const res = await runOf("prism", extra)
      expect(res.statusCode).toBe(202)
      const body = engine.calls[0]!.body
      expect(body).toMatchObject({ resolution: "480p", draft: true })
      expect(body.trendRun).not.toHaveProperty("delivered")
    }
    const above = await runOf("prism", { draft: true, resolution: "720p" })
    expect(above.statusCode).toBe(400)
    expect(above.json().error.code).toBe("validation_error")
    for (const kind of ["pulse", "prism-flash", "pulse-flash"] as const) {
      const none = await runOf(kind, { draft: true })
      expect(none.json().error.code, kind).toBe("draft_unsupported")
    }
  })

  it("a preview run is read by the size delivered too", async () => {
    engine.calls = []
    expect((await runOf("prism", { preview: true })).statusCode).toBe(202)
    expect(engine.calls[0]!.body).toMatchObject({ preview: true, resolution: "720p", draft: false, trendRun: { delivered: true } })
  })

  it("the engine's own size refusals answer with the trend's codes and fixed text", async () => {
    engine.refusal = { status: 400, body: { error: { code: "resolution_not_offered", message: "1080p is not available for this engine here. Choose 720p.", offered: ["720p"] } } }
    for (const send of [runOf, estimateOf]) {
      const res = await send("prism", { resolution: "1080p" })
      expect(res.statusCode).toBe(400)
      expect(res.json()).toEqual({ error: { code: "resolution_unsupported", message: "This trend does not run at that resolution." } })
    }
    engine.refusal = { status: 409, body: { error: { code: "resolution_unavailable", message: "4K cannot be made for this video right now." } } }
    for (const send of [runOf, estimateOf]) {
      const res = await send("prism", { resolution: "4k" })
      expect(res.statusCode).toBe(409)
      expect(res.json()).toEqual({
        error: { code: "resolution_unavailable", message: "This size can't be made for this trend right now. Choose a smaller size, or try again later." },
      })
    }
  })

  it("settings that cannot be read: the page and the run the engine way (its own sizes, no marker), never kept", async () => {
    settings.fails = true
    const first = await detailOf("prism", {}, "?locale=en")
    expect(first.statusCode).toBe(200)
    expect(first.json().data.resolutions).toEqual(["480p", "720p", "1080p"])
    expect(first.json().data).not.toHaveProperty("deliveredResolution")
    expect(first.headers["cache-control"]).toBe("no-store")
    // Pulse too (its sizes need no setting, but the request is answered one way).
    expect((await detailOf("pulse")).json().data).toMatchObject({ resolutions: ["720p", "1080p"] })
    // What the page offered is what runs: an engine size, no marker, exactly the body of before.
    for (const send of [runOf, estimateOf]) {
      engine.calls = []
      expect((await send("prism", {})).statusCode).toBeLessThan(300)
      expect(engine.calls[0]!.body).toMatchObject({ resolution: "480p", draft: false })
      expect(engine.calls[0]!.body.trendRun).not.toHaveProperty("delivered")
    }
    engine.calls = []
    expect((await runOf("prism", { resolution: "1080p" })).statusCode).toBe(202)
    expect(engine.calls[0]!.body).toMatchObject({ resolution: "1080p", draft: false })
    expect(engine.calls[0]!.body.trendRun).not.toHaveProperty("delivered")
    // 4K is no size the page offered then: refused as one, nothing sent.
    engine.calls = []
    const big = await runOf("prism", { resolution: "4k" })
    expect(big.statusCode).toBe(400)
    expect(big.json().error.code).toBe("resolution_unsupported")
    expect(engine.calls).toHaveLength(0)
    // Read again once the settings can be.
    const reads = settings.reads
    settings.fails = false
    const next = await detailOf("prism", {}, "?locale=en")
    expect(settings.reads).toBeGreaterThan(reads)
    expect(next.json().data).toMatchObject({ resolutions: ["720p", "1080p", "4k"], deliveredResolution: true })
  })

  it("a guest's kept page follows the sizes: a change of the sizes is never answered from the copy kept before it", async () => {
    const before = await detailOf("prism", {}, "?locale=en")
    expect(before.json().data.resolutions).toEqual(["720p", "1080p", "4k"])
    // The same sizes: the kept answer (a change the stamp was not told of is not seen).
    mem.trends[0]!.versions[1] = versionData({ name: { en: "Renamed" } })
    const kept = await detailOf("prism", {}, "?locale=en")
    expect(kept.json()).toEqual(before.json())
    // Sizes that moved without the catalog's stamp (a deployment switch): a new answer.
    settings.precise = { "1080p": "off" }
    const after = await detailOf("prism", {}, "?locale=en")
    expect(after.json().data.resolutions).toEqual(["720p", "1080p"])
    expect(after.json().data.name).toBe("Renamed")
  })
})

describe("an engine that reads trend runs by the size delivered: \"4k\" before it", () => {
  it("is a validation error on an engine that does not, as before", async () => {
    await boot(OLD_ENGINES["no flag"]!)
    const res = await runOf("prism", { resolution: "4k" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("an engine that still answers the earlier quote fields: the trend's quote names none of them, the step in the engine's line", async () => {
    await boot(DELIVERS)
    engine.refusal = {
      status: 200,
      body: { totalCredits: 300, breakdown: { base: 20, motion: 200, references: 0, upscale: 80 }, resolution: "1080p", outputResolution: "4k", upscale: "next", upscaleOffered: true },
    }
    const res = await estimateOf("prism", { resolution: "4k" })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({ expectedCredits: 300, holdCredits: 300, engine: "nodaro-prism", engineName: "Nodaro Prism", breakdown: { base: 20, motion: 280, references: 0 } })
    expect(res.body.toLowerCase()).not.toContain("upscale")
    expect(res.body).not.toContain("outputResolution")
  })

  it("the size refusals of an engine that does not: trend_run_rejected, as before", async () => {
    for (const castSwap of Object.values(OLD_ENGINES)) {
      await boot(castSwap)
      engine.refusal = { status: 400, body: { error: { code: "resolution_not_offered", message: "engine words", offered: ["720p"] } } }
      for (const send of [runOf, estimateOf]) {
        const res = await send("prism", { resolution: "1080p" })
        expect(res.statusCode).toBe(400)
        expect(res.json()).toEqual({ error: { code: "trend_run_rejected", message: "This trend couldn't run with these inputs." } })
      }
      engine.refusal = { status: 409, body: { error: { code: "resolution_unavailable", message: "engine words" } } }
      for (const send of [runOf, estimateOf]) {
        const res = await send("prism", { resolution: "1080p" })
        expect(res.statusCode).toBe(409)
        expect(res.json()).toEqual({ error: { code: "trend_run_rejected", message: "This trend couldn't run with these inputs." } })
      }
    }
  })
})
