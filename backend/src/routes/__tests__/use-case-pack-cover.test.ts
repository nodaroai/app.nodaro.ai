// @test-units-by-name reads the run route of the use-case type it names (tighten-episode)
/**
 * A tool run a podcast pack paid for (lib/use-case/pack-cover.ts): the pack
 * route starts it on the internal lane naming the pack (`__coveredBy`, a
 * server-only key) under the pack's own idempotency key for it. The run
 * owes no fee and no balance check, holds its fee at 0 and names the pack on
 * its wrapper (`input_data._coveredBy`), where its run reads the cover so
 * every step holds 0. A pack that does not cover it refuses the run — never
 * charged again in its place — and only the internal lane may name one, only
 * once per tool, while the pack is starting its tools.
 */
import { m, makeApp, post, USER } from "./helpers/tighten-episode-route-harness.js"
import { describe, it, expect, beforeAll } from "vitest"

const PACK = "55555555-5555-4555-8555-555555555555"
// A keyed start inserts through the idempotent insert; an unkeyed one through the plain one.
const inputOf = () => ((m.insertIdem.mock.calls[0] ?? m.insertJob.mock.calls[0])![1] as { input_data: Record<string, unknown> }).input_data
const KEY = { "idempotency-key": `uc-pack-${PACK}-tighten-episode` }
const covered = { mediaUrls: ["https://r2/ep.mp4"], userId: USER, __coveredBy: PACK }
// The harness's recording is an hour: 240 started 15-second units.
const pack = (over: Record<string, unknown> = {}) => ({ provider: "podcast-pack", status: "processing", input_data: { tools: ["tighten-episode", "clip-pack"], units: 240 }, ...over })

describe("POST /v1/tighten-episode started by a podcast pack", () => {
  beforeAll(async () => {
    await makeApp()
  }, 60_000)

  it("owes no fee and no balance check; its wrapper names the pack", async () => {
    m.authKind = "internal"
    m.packRow = pack()
    const res = await post(await makeApp(), covered, KEY)
    expect(res.statusCode, res.body).toBe(202)
    expect(m.estimateCalls).toBe(0)
    expect(m.coverArgs).toEqual([])
    expect(m.reserveSeen.map((r) => r.creditOverride)).toEqual([0])
    expect(inputOf()).toMatchObject({ _coveredBy: PACK, _feeCredits: 0 })
    // The pack is read owner-scoped.
    expect(m.packReads).toEqual(expect.arrayContaining([["id", PACK], ["user_id", USER]]))
  })

  it("a pack that does not cover it refuses the run before anything is written", async () => {
    m.authKind = "internal"
    for (const row of [
      pack({ input_data: { tools: ["clip-pack"] } }),
      pack({ provider: "use-case" }),
      pack({ status: "failed" }),
      pack({ status: "cancelled" }),
      null,
    ]) {
      m.packRow = row
      const res = await post(await makeApp(), covered, KEY)
      expect(res.statusCode, JSON.stringify(row)).toBe(409)
      expect(res.json().error.code).toBe("pack_not_covering")
    }
    expect(m.insertJob).not.toHaveBeenCalled()
    expect(m.reserveSeen).toEqual([])
  })

  it("a pack done starting its tools still starts a tool that has no run in it yet (a tool that did not start)", async () => {
    m.authKind = "internal"
    m.packRow = pack({ status: "completed" })
    expect((await post(await makeApp(), covered, KEY)).statusCode).toBe(202)
  })

  it("once per tool: a tool that already has a run in its pack is refused (continue that run instead)", async () => {
    m.authKind = "internal"
    m.packRow = pack({ status: "completed" })
    m.packRuns = [{ id: "wrap-earlier" }]
    const res = await post(await makeApp(), covered, KEY)
    expect(res.statusCode).toBe(409)
    expect(res.json().error.message).toMatch(/already ran/)
    expect(m.insertIdem).not.toHaveBeenCalled()
  })

  it("a pack held for review: refused, nothing written", async () => {
    m.authKind = "internal"
    m.packRow = pack({ status: "pending_review" })
    const res = await post(await makeApp(), covered, KEY)
    expect(res.statusCode).toBe(409)
    expect(res.json().error.message).toMatch(/under review/)
    expect(m.insertIdem).not.toHaveBeenCalled()
  })

  it("a recording one unit over what the pack measured still runs (the two measurements may differ by a frame)", async () => {
    m.authKind = "internal"
    m.packRow = pack({ input_data: { tools: ["tighten-episode"], units: 239 } })
    expect((await post(await makeApp(), covered, KEY)).statusCode).toBe(202)
  })

  it("a recording longer than the pack paid for is refused", async () => {
    m.authKind = "internal"
    m.packRow = pack({ input_data: { tools: ["tighten-episode"], units: 238 } })
    const res = await post(await makeApp(), covered, KEY)
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatchObject({ code: "pack_not_covering", message: expect.stringMatching(/longer/) })
    expect(m.insertIdem).not.toHaveBeenCalled()
  })

  it("not under the pack's own key for the tool: refused (one fresh run per tool per pack)", async () => {
    m.authKind = "internal"
    m.packRow = pack()
    for (const headers of [{}, { "idempotency-key": `uc-pack-${PACK}-clip-pack` }, { "idempotency-key": "mine" }] as Array<Record<string, string>>) {
      const res = await post(await makeApp(), covered, headers)
      expect(res.statusCode, JSON.stringify(headers)).toBe(409)
    }
    expect(m.insertJob).not.toHaveBeenCalled()
    expect(m.insertIdem).not.toHaveBeenCalled()
  })

  it("from any other caller the word is ignored: the run is charged as always", async () => {
    m.authKind = "jwt"
    m.packRow = pack()
    const res = await post(await makeApp(), { mediaUrls: ["https://r2/ep.mp4"], __coveredBy: PACK })
    expect(res.statusCode).toBe(202)
    expect(m.estimateCalls).toBe(1)
    expect(inputOf()).not.toHaveProperty("_coveredBy")
    expect(inputOf()._feeCredits).toBe(10)
    expect(m.packReads).toEqual([])
  })
})
