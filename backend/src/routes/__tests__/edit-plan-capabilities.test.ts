import { describe, it, expect, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * GET /v1/edit-plan/capabilities — which Edit Plan modes this server can plan.
 *
 * The editor greys out a mode the server cannot plan (Trailer, until the loaded
 * plugin declares it). The answer is read from the SAME declaration the video
 * worker's refusal reads (`editPlanModesOf(supports)`), so the two can never
 * disagree: a mode the browser offers is one the worker runs, and a mode the
 * worker refuses is one the browser greys out.
 */

import { editPlanCapabilitiesRoutes as routes } from "../edit-plan-capabilities.js"
import { getPluginSupports, setPluginSupports } from "../../lib/private-plugins/supports-registry.js"
import {
  plannableEditPlanModes,
  _resetPlannableEditPlanModesForTests,
  type PlannableEditPlanModesDeps,
} from "../../lib/private-plugins/plannable-edit-plan-modes.js"
import type { PlannableEditPlanModes } from "../../lib/private-plugins/edit-plan-mode-gate.js"

const PHASE1 = ["tighten", "clips", "chapters"]
const deps = (over: Partial<PlannableEditPlanModesDeps> = {}): PlannableEditPlanModesDeps => ({
  hasCredits: () => true,
  getPluginSupports,
  isNodaroConnected: async () => true,
  cloudFetch: async () => new Response(JSON.stringify({ modes: [...PHASE1, "trailer"] }), { status: 200 }),
  now: () => 0,
  ...over,
})

let app: FastifyInstance

async function build(plannable: PlannableEditPlanModes): Promise<void> {
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string") (req as { userId?: string }).userId = header
  })
  await app.register(routes, { plannable })
  await app.ready()
}

beforeEach(async () => {
  setPluginSupports({})
  _resetPlannableEditPlanModesForTests()
  // nodaro.ai: the one helper reading the loaded plugin's declaration.
  await build(() => plannableEditPlanModes(deps()))
})

afterEach(async () => {
  setPluginSupports({})
  await app.close()
})

const get = (userId: string | null = "user-1") =>
  app.inject({ method: "GET", url: "/v1/edit-plan/capabilities", headers: userId ? { "x-user-id": userId } : {} })

describe("GET /v1/edit-plan/capabilities", () => {
  it("answers the three Phase-1 modes when no plugin declares anything (community, an older plugin)", async () => {
    const res = await get()
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ modes: ["tighten", "clips", "chapters"], source: "server" })
  })

  it("adds trailer once the loaded plugin declares it", async () => {
    setPluginSupports({ editPlanModes: ["tighten", "clips", "chapters", "trailer"] })
    expect((await get()).json()).toEqual({ modes: ["tighten", "clips", "chapters", "trailer"], source: "server" })
  })

  it("reads the declaration at request time, not at registration (plugins load after routes register)", async () => {
    expect((await get()).json().modes).not.toContain("trailer")
    setPluginSupports({ editPlanModes: ["trailer"] })
    expect((await get()).json().modes).toContain("trailer")
  })

  it("is never shared-cacheable: a plugin update changes the answer", async () => {
    expect((await get()).headers["cache-control"]).toBe("private, no-store")
  })

  it("refuses an unauthenticated caller", async () => {
    expect((await get(null)).statusCode).toBe(401)
  })
})

// Round 6 (decided 2026-10-06): a self-hosted install connected to nodaro.ai
// answers what nodaro.ai plans, so a self-host gets Trailer as soon as
// nodaro.ai does; unreachable → the original three; unconnected → unchanged.
describe("GET /v1/edit-plan/capabilities on a self-hosted install", () => {
  const selfHost = async (over: Partial<PlannableEditPlanModesDeps>) => {
    await app.close()
    await build(() => plannableEditPlanModes(deps({ hasCredits: () => false, ...over })))
  }

  it("lists trailer when connected and nodaro.ai plans it", async () => {
    await selfHost({})
    expect((await get()).json()).toEqual({ modes: [...PHASE1, "trailer"], source: "nodaro.ai" })
  })

  // Round 7 (decided 2026-10-06): the editor words each case differently, so
  // the answer says who answered — the list itself is unchanged (fails closed).
  it("lists the original three when nodaro.ai can't be reached, and says so", async () => {
    await selfHost({ cloudFetch: async () => { throw new Error("ECONNREFUSED") } })
    expect((await get()).json()).toEqual({ modes: PHASE1, source: "nodaro.ai-unreachable" })
  })

  it("says nodaro.ai answered when it plans no trailer yet", async () => {
    await selfHost({ cloudFetch: async () => new Response(JSON.stringify({ modes: PHASE1 }), { status: 200 }) })
    expect((await get()).json()).toEqual({ modes: PHASE1, source: "nodaro.ai" })
  })

  it("lists the original three when not connected, as before", async () => {
    await selfHost({ isNodaroConnected: async () => false })
    expect((await get()).json()).toEqual({ modes: PHASE1, source: "server" })
  })
})
