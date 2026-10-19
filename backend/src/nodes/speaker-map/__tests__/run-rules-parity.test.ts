// @test-watches tools/units/__fixtures__/speaker-map-run-rules.json
/**
 * The REST route restates three of the run rules for its own body shape (a
 * sound-only wide shot, the wide shot on the master, the offsets' shape).
 * One fixture, tools/units/__fixtures__/speaker-map-run-rules.json, holds the
 * route's body check and the run rules (speakerMapRunInputs, which the
 * server's payload and the editor's run both call) to the same verdict, so the
 * restatement cannot drift. The editor's parity test reads the same file.
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, it, expect, vi } from "vitest"
import Fastify from "fastify"
import { speakerMapRunInputs } from "@nodaro/render-rules"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/insert-job.js", () => ({ insertJob: vi.fn(async () => ({ data: { id: "job-1" }, error: null })) }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn() }, redis: {} }))
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: vi.fn(async () => ({ usageLogId: "ul-1" })),
}))

import { route } from "../route.js"

interface Case {
  readonly name: string
  readonly sources: ReadonlyArray<{ id: string; url: string; kind: "video" | "audio" }>
  readonly masterSourceId?: string
  readonly wideSourceId?: string
  readonly offsets?: unknown
  readonly problem: string | null
  readonly routeField?: string
}
const FIXTURE = JSON.parse(readFileSync(path.resolve(__dirname, "../../../../../tools/units/__fixtures__/speaker-map-run-rules.json"), "utf8")) as { transcript: unknown; cases: Case[] }

async function routeAnswer(c: Case) {
  const app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => { req.userId = "00000000-0000-4000-8000-000000000001" })
  await app.register(route)
  const named = { ...(c.masterSourceId ? { masterSourceId: c.masterSourceId } : {}), ...(c.wideSourceId ? { wideSourceId: c.wideSourceId } : {}) }
  const res = await app.inject({ method: "POST", url: "/v1/speaker-map", payload: { sources: c.sources, transcript: FIXTURE.transcript, ...(c.offsets !== undefined ? { offsets: c.offsets } : {}), ...named } })
  return { status: res.statusCode, error: (res.json() as { error?: { code: string; issues: Array<{ path: string }> } }).error }
}

describe("the route's body check and the run rules agree, case by case", () => {
  it("the fixture covers every shared rule, both ways", () => {
    const problems = new Set(FIXTURE.cases.map((c) => c.problem))
    for (const p of [null, "wide-sound-only", "wide-is-master", "not-audio-sync"]) expect(problems.has(p), String(p)).toBe(true)
  })

  it.each(FIXTURE.cases.map((c) => [c.name, c] as const))("%s", async (_name, c) => {
    const run = speakerMapRunInputs(
      { sources: c.sources, transcript: JSON.stringify(FIXTURE.transcript), ...(c.offsets !== undefined ? { offsets: JSON.stringify(c.offsets) } : {}) },
      { masterSourceId: c.masterSourceId, wideSourceId: c.wideSourceId },
    )
    expect("problem" in run ? run.problem.code : null).toBe(c.problem)

    const answer = await routeAnswer(c)
    if (c.problem === null) {
      expect(answer.status).toBe(200)
    } else {
      expect(answer.status).toBe(400)
      expect(answer.error?.code).toBe("validation_error")
      expect(answer.error?.issues.map((i) => i.path)).toEqual([c.routeField])
    }
  })
})
