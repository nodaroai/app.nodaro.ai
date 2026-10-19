// @test-units-by-name holds the server's preparation of the three use-case types its fixture's graph rows name to those rows
// @test-watches backend/src/lib/__tests__/fixtures/use-case-single-recording-identity.json
/**
 * The graph rows of `use-case-single-recording-identity.json`, reached the way
 * production reaches them: a request body parsed by the type's route body,
 * the recording (and intro card) probed, `prepareUseCase` resolving the
 * settings and building the graph — and, through the route itself, the graph
 * its keyless preflight asks before anything is probed. Compare only: the
 * rows are the truth, recorded with the identity test; nothing here records.
 *
 * A row whose intro card has no length is never prepared (the route refuses
 * an unreadable card), so only its preflight graph is held to it. The
 * preflight never probes: it builds a video recording of unknown length with
 * a card of unknown length, so it is held to the video rows with neither.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { toStoredInlineGraph, usecaseDescriptor, type UseCaseGraph, type UseCaseMediaKind, type UseCaseNodeType } from "@nodaro/render-rules"

const USER = "00000000-0000-4000-8000-000000000001"
const m = vi.hoisted(() => ({
  streams: vi.fn(),
  duration: vi.fn(),
  preflight: [] as unknown[],
  estimated: [] as unknown[],
}))
vi.mock("@/providers/video/ffmpeg-utils.js", () => ({ probeMediaStreams: m.streams, probeMediaDuration: m.duration }))
vi.mock("@/lib/config.js", async (orig) => ({ ...(await orig<typeof import("@/lib/config.js")>()), hasCredits: () => true }))
vi.mock("@/lib/availability-viewer.js", () => ({ isNodeDeniedForUser: async () => false }))
vi.mock("@/lib/execution-inline-graph.js", () => ({ ensureInlineGraphColumns: async () => true }))
vi.mock("@/lib/use-case/preflight.js", () => ({
  usecasePreflight: async (graph: unknown) => {
    m.preflight.push(graph)
    return null
  },
}))
vi.mock("@/ee/billing/use-case-estimate.js", () => ({
  estimateUseCaseCredits: async (graph: unknown) => {
    m.estimated.push(graph)
    return { stepsCredits: 0, feeCredits: 0, totalCredits: 0 }
  },
}))
vi.mock("@/lib/supabase.js", () => ({ supabase: {} }))
vi.mock("@/lib/insert-job.js", () => ({ insertJob: vi.fn(), insertJobIdempotent: vi.fn(), billingPairColumns: () => ({}) }))
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => undefined,
  reserveCreditsForJob: vi.fn(),
  resolveWebSurfaceFlag: async () => false,
}))

import { USE_CASE_BODIES, type UseCaseBody } from "../use-case/bodies.js"
import { prepareUseCase } from "../use-case/request.js"
import { usecaseRunRoutes } from "../../routes/use-case-run.js"

interface GraphRow {
  readonly type: UseCaseNodeType
  readonly kind: UseCaseMediaKind
  readonly raw: Record<string, unknown>
  readonly durationSec: number | null
  readonly optional: readonly string[]
  readonly introCardSec: number | null
  readonly hash: string
  readonly settings: unknown
}

const FIXTURE = join(__dirname, "fixtures", "use-case-single-recording-identity.json")
const rows = (JSON.parse(readFileSync(FIXTURE, "utf8")) as { graphs: GraphRow[] }).graphs
/** The URLs the identity test built its rows from. */
const mediaUrlOf = (r: GraphRow) => `https://r2/ep.${r.kind === "audio" ? "m4a" : "mp4"}`
const CARD_URL = "https://r2/card.mp4"
const MUSIC_URL = "https://r2/bed.mp3"

const plain = (v: unknown): unknown => JSON.parse(JSON.stringify(v))
const hashOf = (g: unknown) => toStoredInlineGraph(g as UseCaseGraph, {}).hash
const label = (r: GraphRow, i: number) =>
  `row ${i} (${r.type}, ${r.kind}, ${r.durationSec ?? "no"} s${r.optional.length ? `, ${r.optional.join("+")} ${r.introCardSec ?? "no"} s` : ""})`

/** What the route is sent for a row: its recording, its optional inputs, its raw settings. */
function payloadOf(r: GraphRow): Record<string, unknown> {
  return {
    mediaUrls: [mediaUrlOf(r)],
    ...(r.optional.includes("music") ? { musicUrl: MUSIC_URL } : {}),
    ...(r.optional.includes("introCard") ? { introCardUrl: CARD_URL } : {}),
    ...r.raw,
  }
}

/** The probes answer as the row's recording and card are: its kind, its length (none: unreadable). */
function probeAs(r: GraphRow) {
  m.streams.mockImplementation(async (url: string) =>
    url === mediaUrlOf(r) ? { hasVideo: r.kind === "video", hasAudio: true } : { hasVideo: url === CARD_URL, hasAudio: true },
  )
  m.duration.mockImplementation(async (url: string) => {
    const sec = url === mediaUrlOf(r) ? r.durationSec : url === CARD_URL ? r.introCardSec : null
    if (sec === null) throw new Error("no length")
    return sec
  })
}

const prepares = (r: GraphRow) => !(r.optional.includes("introCard") && r.introCardSec === null)
const preflightHolds = (r: GraphRow) => r.kind === "video" && r.durationSec === null && r.introCardSec === null

async function makeApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = USER
    req.authKind = "jwt"
  })
  await app.register(usecaseRunRoutes)
  await app.ready()
  return app
}

beforeEach(() => {
  m.streams.mockReset()
  m.duration.mockReset()
  m.preflight.length = 0
  m.estimated.length = 0
})

describe("the server's preparation builds the recorded one-recording rows", () => {
  it("every graph type has rows each check reaches (never a vacuous pass)", () => {
    for (const t of new Set(rows.map((r) => r.type))) {
      expect(rows.filter((r) => r.type === t && prepares(r)).length, t).toBeGreaterThan(0)
      expect(rows.filter((r) => r.type === t && preflightHolds(r)).length, t).toBeGreaterThan(0)
    }
  })

  for (const [i, r] of rows.entries()) {
    if (!prepares(r)) continue
    it(`${label(r, i)}: prepareUseCase resolves the same settings and builds the same graph`, async () => {
      probeAs(r)
      const body = USE_CASE_BODIES[r.type].parse(payloadOf(r)) as UseCaseBody
      const prep = await prepareUseCase(r.type, body)
      expect(prep.ok, JSON.stringify(prep)).toBe(true)
      if (!prep.ok) return
      expect(plain(prep.settings)).toEqual(r.settings)
      expect(toStoredInlineGraph(prep.graph, prep.settings).hash).toBe(r.hash)
    })
  }

  for (const [i, r] of rows.entries()) {
    if (!prepares(r) && !preflightHolds(r)) continue
    it(`${label(r, i)}: through ${usecaseDescriptor(r.type).route}/estimate, the prepared graph${preflightHolds(r) ? " and the keyless preflight's" : ""} are the row's`, async () => {
      probeAs(r)
      const res = await (await makeApp()).inject({ method: "POST", url: `${usecaseDescriptor(r.type).route}/estimate`, payload: payloadOf(r) })
      expect(m.preflight).toHaveLength(1)
      if (preflightHolds(r)) expect(hashOf(m.preflight[0])).toBe(r.hash)
      if (prepares(r)) {
        expect(res.statusCode, res.body).toBe(200)
        expect(m.estimated).toHaveLength(1)
        expect(hashOf(m.estimated[0])).toBe(r.hash)
      } else {
        // An intro card that has no length is refused once the preflight has passed.
        expect(res.json()).toMatchObject({ error: { code: "intro_card_unreadable" } })
      }
    })
  }
})
