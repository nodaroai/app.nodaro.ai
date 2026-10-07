/**
 * Round 4 (decided 2026-10-06): `POST /v1/edit-plan` refuses an unknown or
 * undeclared Edit Plan mode before anything is charged, with the one message
 * every lane uses (`editPlanModeRefusal`). The guard is attached to the ROUTE,
 * whoever registers it — the cloud plugin on nodaro.ai, the relay shim on a
 * self-host — and runs before the route's own preHandler (the credit guard).
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { registerEditPlanModeGuard } from "../edit-plan-mode-guard.js"
import { editPlanModeRefusalMessage } from "../../lib/private-plugins/edit-plan-mode-gate.js"
import { getPluginSupports, setPluginSupports } from "../../lib/private-plugins/supports-registry.js"
import {
  plannableEditPlanModes,
  _resetPlannableEditPlanModesForTests,
  type PlannableEditPlanModesDeps,
} from "../../lib/private-plugins/plannable-edit-plan-modes.js"
import type { PlannableEditPlanModes } from "../../lib/private-plugins/edit-plan-mode-gate.js"

const PHASE1 = ["tighten", "clips", "chapters"]
const selfHostDeps = (over: Partial<PlannableEditPlanModesDeps> = {}): PlannableEditPlanModesDeps => ({
  hasCredits: () => false,
  getPluginSupports,
  isNodaroConnected: async () => true,
  cloudFetch: async () => new Response(JSON.stringify({ modes: [...PHASE1, "trailer"] }), { status: 200 }),
  now: () => 0,
  ...over,
})
/** nodaro.ai: the one helper, reading the loaded plugin's declaration. */
const onNodaroAi: PlannableEditPlanModes = () => plannableEditPlanModes(selfHostDeps({ hasCredits: () => true }))

const body = (mode?: unknown) => ({
  ...(mode === undefined ? {} : { mode }),
  transcript: { version: 1, words: [] },
  sources: [{ url: "https://a/ep.mp4" }],
})

/** The guard on the root, then the route in an encapsulated child — as the
 *  plugin loader and `app.register(nodaroExclusiveRoutes)` do. */
async function appWithRoute(plannable: PlannableEditPlanModes = onNodaroAi): Promise<{ app: FastifyInstance; charged: ReturnType<typeof vi.fn>; handled: ReturnType<typeof vi.fn> }> {
  const app = Fastify()
  const charged = vi.fn(async () => undefined)
  const handled = vi.fn(async () => ({ jobId: "j-1" }))
  registerEditPlanModeGuard(app, plannable)
  await app.register(async (child) => {
    child.post("/v1/edit-plan", { preHandler: charged }, handled)
    child.post("/v1/video-analysis", { preHandler: charged }, handled)
  })
  await app.ready()
  return { app, charged, handled }
}

afterEach(() => {
  setPluginSupports({})
  _resetPlannableEditPlanModesForTests()
})

describe("POST /v1/edit-plan mode guard", () => {
  it("refuses trailer while the server does not plan it, before the credit guard runs", async () => {
    setPluginSupports({})
    const { app, charged, handled } = await appWithRoute()
    const res = await app.inject({ method: "POST", url: "/v1/edit-plan", payload: body("trailer") })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: { code: "mode_not_available", message: editPlanModeRefusalMessage("trailer") } })
    expect(charged).not.toHaveBeenCalled()
    expect(handled).not.toHaveBeenCalled()
  })

  it("refuses an unknown mode with the same message, even one the plugin declares", async () => {
    setPluginSupports({ editPlanModes: ["montage"] })
    const { app, charged } = await appWithRoute()
    for (const [mode, shown] of [["montage", "montage"], ["Clips", "Clips"], [5, "5"], [null, "null"]] as const) {
      const res = await app.inject({ method: "POST", url: "/v1/edit-plan", payload: body(mode) })
      expect(res.statusCode, String(mode)).toBe(400)
      expect(res.json().error.message).toBe(editPlanModeRefusalMessage(shown))
    }
    expect(charged).not.toHaveBeenCalled()
  })

  it("passes every Phase-1 mode and an absent mode (the planner's default) to the route", async () => {
    setPluginSupports({})
    const { app, charged, handled } = await appWithRoute()
    for (const mode of ["tighten", "clips", "chapters", undefined]) {
      const res = await app.inject({ method: "POST", url: "/v1/edit-plan", payload: body(mode) })
      expect(res.statusCode, String(mode)).toBe(200)
    }
    expect(charged).toHaveBeenCalledTimes(4)
    expect(handled).toHaveBeenCalledTimes(4)
  })

  it("passes trailer once the loaded plugin declares it — read at request time", async () => {
    setPluginSupports({})
    const { app } = await appWithRoute()
    setPluginSupports({ editPlanModes: ["trailer"] })
    const res = await app.inject({ method: "POST", url: "/v1/edit-plan", payload: body("trailer") })
    expect(res.statusCode).toBe(200)
  })

  it("leaves every other route alone", async () => {
    const { app, handled } = await appWithRoute()
    const res = await app.inject({ method: "POST", url: "/v1/video-analysis", payload: { mode: "trailer", videoUrl: "https://a/v.mp4" } })
    expect(res.statusCode).toBe(200)
    expect(handled).toHaveBeenCalledTimes(1)
  })

  it("keeps a route's own preValidation, after the guard", async () => {
    const app = Fastify()
    const own = vi.fn(async () => undefined)
    registerEditPlanModeGuard(app, onNodaroAi)
    app.post("/v1/edit-plan", { preValidation: own }, async () => ({ ok: true }))
    await app.ready()
    expect((await app.inject({ method: "POST", url: "/v1/edit-plan", payload: body("trailer") })).statusCode).toBe(400)
    expect(own).not.toHaveBeenCalled()
    expect((await app.inject({ method: "POST", url: "/v1/edit-plan", payload: body("clips") })).statusCode).toBe(200)
    expect(own).toHaveBeenCalledTimes(1)
  })
})

// Round 6 (decided 2026-10-06): a self-host connected to nodaro.ai plans what
// nodaro.ai plans — the guard reads the same helper as every other lane.
describe("POST /v1/edit-plan mode guard on a self-hosted install", () => {
  it("passes trailer when connected and nodaro.ai plans it", async () => {
    const { app, handled } = await appWithRoute(() => plannableEditPlanModes(selfHostDeps()))
    const res = await app.inject({ method: "POST", url: "/v1/edit-plan", payload: body("trailer") })
    expect(res.statusCode).toBe(200)
    expect(handled).toHaveBeenCalledTimes(1)
  })

  // Round 7 (decided 2026-10-06): an outage is temporary, and refusing an
  // unsupported mode stays with nodaro.ai's own answer — so the guard does not
  // refuse a known mode it could not ask about. The job it creates meets the
  // worker gate, which retries "could not reach nodaro.ai" under the job policy.
  it("does not refuse trailer when nodaro.ai can't be reached; an unknown mode is still refused", async () => {
    const { app, handled } = await appWithRoute(() =>
      plannableEditPlanModes(selfHostDeps({ cloudFetch: async () => { throw new Error("ECONNREFUSED") } })),
    )
    const res = await app.inject({ method: "POST", url: "/v1/edit-plan", payload: body("trailer") })
    expect(res.statusCode).toBe(200)
    expect((await app.inject({ method: "POST", url: "/v1/edit-plan", payload: body("clips") })).statusCode).toBe(200)
    expect(handled).toHaveBeenCalledTimes(2)
    const unknown = await app.inject({ method: "POST", url: "/v1/edit-plan", payload: body("montage") })
    expect(unknown.statusCode).toBe(400)
    expect(unknown.json().error.message).toBe(editPlanModeRefusalMessage("montage"))
  })

  it("refuses trailer when nodaro.ai answers that it does not plan it", async () => {
    const { app, handled } = await appWithRoute(() =>
      plannableEditPlanModes(selfHostDeps({
        cloudFetch: async () => new Response(JSON.stringify({ modes: PHASE1 }), { status: 200 }),
      })),
    )
    const res = await app.inject({ method: "POST", url: "/v1/edit-plan", payload: body("trailer") })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toBe(editPlanModeRefusalMessage("trailer"))
    expect(handled).not.toHaveBeenCalled()
  })

  it("is unchanged when not connected: trailer refused", async () => {
    const { app, handled } = await appWithRoute(() =>
      plannableEditPlanModes(selfHostDeps({ isNodaroConnected: async () => false })),
    )
    const res = await app.inject({ method: "POST", url: "/v1/edit-plan", payload: body("trailer") })
    expect(res.statusCode).toBe(400)
    expect(handled).not.toHaveBeenCalled()
  })

  it("refuses an unknown mode even when nodaro.ai lists it", async () => {
    const { app } = await appWithRoute(() =>
      plannableEditPlanModes(selfHostDeps({
        cloudFetch: async () => new Response(JSON.stringify({ modes: [...PHASE1, "montage"] }), { status: 200 }),
      })),
    )
    const res = await app.inject({ method: "POST", url: "/v1/edit-plan", payload: body("montage") })
    expect(res.statusCode).toBe(400)
  })
})

describe("app.ts wiring", () => {
  const src = readFileSync(resolve(__dirname, "../../app.ts"), "utf8")
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

  it("registers the guard before the plugin routes and the self-host shim", () => {
    const guard = code.indexOf("registerEditPlanModeGuard(app)")
    expect(guard).toBeGreaterThanOrEqual(0)
    expect(code.indexOf("await loadPrivatePlugins({ app })")).toBeGreaterThan(guard)
    expect(code.indexOf("await app.register(nodaroExclusiveRoutes)")).toBeGreaterThan(guard)
  })
})
