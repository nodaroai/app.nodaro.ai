/**
 * Which Edit Plan modes this server plans (round 6, decided 2026-10-06).
 *
 * nodaro.ai reads its loaded plugin's declaration. A self-hosted install
 * CONNECTED to nodaro.ai runs Edit Plan there and bills the connected account,
 * so it asks nodaro.ai's `GET /v1/edit-plan/capabilities` over the connection
 * the relay already uses: a self-host gets Trailer as soon as nodaro.ai does.
 * The answer is cached briefly and fails CLOSED to the three original modes when
 * nodaro.ai can't be reached. An unconnected self-host keeps its behaviour.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  plannableEditPlanModes,
  _resetPlannableEditPlanModesForTests,
  PLANNABLE_MODES_TTL_MS,
  PLANNABLE_MODES_FAILURE_TTL_MS,
  type PlannableEditPlanModesDeps,
} from "../plannable-edit-plan-modes.js"

const PHASE1 = ["tighten", "clips", "chapters"]

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

type TestDeps = PlannableEditPlanModesDeps & { cloudFetch: ReturnType<typeof vi.fn>; advance: (ms: number) => void }

function deps(over: Partial<PlannableEditPlanModesDeps> = {}): TestDeps {
  let t = 1_000_000
  return {
    hasCredits: () => false,
    getPluginSupports: () => ({}),
    isNodaroConnected: async () => true,
    cloudFetch: vi.fn(async () => json({ modes: [...PHASE1, "trailer"] })),
    now: () => t,
    ...over,
    advance: (ms: number) => {
      t += ms
    },
  } as TestDeps
}
const advance = (d: TestDeps, ms: number) => d.advance(ms)

beforeEach(() => _resetPlannableEditPlanModesForTests())

describe("plannableEditPlanModes — nodaro.ai (credits edition)", () => {
  it("reads the loaded plugin's declaration and never calls out", async () => {
    const d = deps({ hasCredits: () => true, getPluginSupports: () => ({ editPlanModes: ["trailer"] }) })
    expect([...(await plannableEditPlanModes(d)).modes]).toEqual([...PHASE1, "trailer"])
    expect(d.cloudFetch).not.toHaveBeenCalled()
  })

  it("says this server answered (it plans for itself)", async () => {
    const d = deps({ hasCredits: () => true })
    expect((await plannableEditPlanModes(d)).source).toBe("server")
  })

  it("an older plugin that declares nothing plans the three original modes", async () => {
    const d = deps({ hasCredits: () => true })
    expect([...(await plannableEditPlanModes(d)).modes]).toEqual(PHASE1)
  })
})

describe("plannableEditPlanModes — self-hosted, connected to nodaro.ai", () => {
  it("allows trailer when nodaro.ai plans it", async () => {
    const d = deps()
    expect([...(await plannableEditPlanModes(d)).modes]).toEqual([...PHASE1, "trailer"])
    expect(d.cloudFetch).toHaveBeenCalledWith("/v1/edit-plan/capabilities", expect.objectContaining({ method: "GET" }))
  })

  it("does not allow trailer when nodaro.ai does not plan it yet", async () => {
    const d = deps({ cloudFetch: vi.fn(async () => json({ modes: PHASE1 })) })
    expect([...(await plannableEditPlanModes(d)).modes]).toEqual(PHASE1)
  })

  it("drops a mode nodaro.ai lists that this install does not know", async () => {
    const d = deps({ cloudFetch: vi.fn(async () => json({ modes: [...PHASE1, "trailer", "montage"] })) })
    expect([...(await plannableEditPlanModes(d)).modes]).toEqual([...PHASE1, "trailer"])
  })

  it.each([
    ["the request throws (unreachable)", vi.fn(async () => { throw new Error("ECONNREFUSED") })],
    ["nodaro.ai answers 500", vi.fn(async () => json({ error: "boom" }, 500))],
    ["the body is not JSON", vi.fn(async () => new Response("<html>", { status: 200 }))],
    ["`modes` is not a list", vi.fn(async () => json({ modes: "trailer" }))],
  ])("fails closed to the three original modes, marked unreachable, when %s", async (_why, cloudFetch) => {
    const d = deps({ cloudFetch })
    const answer = await plannableEditPlanModes(d)
    expect([...answer.modes]).toEqual(PHASE1)
    // Round 7 (decided 2026-10-06): an outage is a TEMPORARY state, told apart
    // from "nodaro.ai answered without trailer" — the worker retries it and the
    // editor says nodaro.ai couldn't be reached.
    expect(answer.source).toBe("nodaro.ai-unreachable")
  })

  it("a 404 is an answer, not an outage: an older nodaro.ai without the route plans the original three", async () => {
    const d = deps({ cloudFetch: vi.fn(async () => json({}, 404)) })
    const answer = await plannableEditPlanModes(d)
    expect([...answer.modes]).toEqual(PHASE1)
    expect(answer.source).toBe("nodaro.ai")
  })

  it("says nodaro.ai answered, whether or not it plans trailer", async () => {
    expect((await plannableEditPlanModes(deps())).source).toBe("nodaro.ai")
    _resetPlannableEditPlanModesForTests()
    expect((await plannableEditPlanModes(deps({ cloudFetch: vi.fn(async () => json({ modes: PHASE1 })) }))).source).toBe(
      "nodaro.ai",
    )
  })

  // A job that met an outage is retried by the queue (`attempts: 3`, exponential
  // backoff). The retry must ask nodaro.ai again, not read the cached outage.
  it("forgets an outage before the queue's first retry runs", () => {
    const queue = readFileSync(resolve(__dirname, "../../queue.ts"), "utf8")
    const delay = Number(/backoff:\s*\{\s*type:\s*"exponential",\s*delay:\s*(\d[\d_]*)/.exec(queue)?.[1]?.replace(/_/g, ""))
    expect(delay).toBeGreaterThan(0)
    expect(PLANNABLE_MODES_FAILURE_TTL_MS).toBeLessThan(delay)
  })

  it("bounds the request with a timeout signal", async () => {
    const d = deps()
    await plannableEditPlanModes(d)
    const init = d.cloudFetch.mock.calls[0]![1] as RequestInit
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it("caches the answer briefly, then asks again", async () => {
    const d = deps()
    await plannableEditPlanModes(d)
    await plannableEditPlanModes(d)
    expect(d.cloudFetch).toHaveBeenCalledTimes(1)
    advance(d, PLANNABLE_MODES_TTL_MS + 1)
    await plannableEditPlanModes(d)
    expect(d.cloudFetch).toHaveBeenCalledTimes(2)
  })

  it("caches a failure for a shorter time, so a recovered nodaro.ai is seen soon", async () => {
    const cloudFetch = vi.fn(async (): Promise<Response> => { throw new Error("down") })
    const d = deps({ cloudFetch })
    expect([...(await plannableEditPlanModes(d)).modes]).toEqual(PHASE1)
    await plannableEditPlanModes(d)
    expect(cloudFetch).toHaveBeenCalledTimes(1)
    expect(PLANNABLE_MODES_FAILURE_TTL_MS).toBeLessThan(PLANNABLE_MODES_TTL_MS)
    cloudFetch.mockImplementation(async () => json({ modes: [...PHASE1, "trailer"] }))
    advance(d, PLANNABLE_MODES_FAILURE_TTL_MS + 1)
    expect([...(await plannableEditPlanModes(d)).modes]).toContain("trailer")
  })

  it("shares one request between concurrent callers", async () => {
    const d = deps()
    await Promise.all([plannableEditPlanModes(d), plannableEditPlanModes(d), plannableEditPlanModes(d)])
    expect(d.cloudFetch).toHaveBeenCalledTimes(1)
  })
})

describe("plannableEditPlanModes — self-hosted, not connected", () => {
  it("is unchanged: the three original modes, and nodaro.ai is never asked", async () => {
    const d = deps({ isNodaroConnected: async () => false })
    expect([...(await plannableEditPlanModes(d)).modes]).toEqual(PHASE1)
    expect(d.cloudFetch).not.toHaveBeenCalled()
    expect((await plannableEditPlanModes(d)).source).toBe("server")
  })

  it("treats a connection read that throws as not connected", async () => {
    const d = deps({ isNodaroConnected: async () => { throw new Error("db down") } })
    expect([...(await plannableEditPlanModes(d)).modes]).toEqual(PHASE1)
    expect(d.cloudFetch).not.toHaveBeenCalled()
  })

  it("does not reuse a connected answer after the install disconnects", async () => {
    let connected = true
    const d = deps({ isNodaroConnected: async () => connected })
    expect([...(await plannableEditPlanModes(d)).modes]).toContain("trailer")
    connected = false
    expect([...(await plannableEditPlanModes(d)).modes]).toEqual(PHASE1)
  })
})
