import { describe, it, expect, vi, beforeEach } from "vitest"
import type { FastifyInstance } from "fastify"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool, listTools } from "./_helpers.js"

/**
 * Recast authored-script verbs (spec 2026-08-06 §5 — P2).
 *
 * The contracts under test:
 *  - scope gating: import needs workflows:write, start needs workflows:execute,
 *    status needs workflows:read; skill + validate are ungated.
 *  - import is create-nothing-on-failure (C3) and seeds the SERVER's document.
 *  - start without confirm quotes and never buys; with confirm it buys the
 *    plan (faithful + attested + keyframes) and persists the run marker.
 *  - a planned run advances to /start on the next start_recast call.
 *  - status reconciles a completed snapshot into settings (take appended).
 */

const h = vi.hoisted(() => ({
  workflowsRow: null as Record<string, unknown> | null,
  projectRow: { id: "proj-1" } as Record<string, unknown> | null,
}))

vi.mock("../../../supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "projects") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: h.projectRow }) }) }),
                }),
              }),
            }),
          }),
          insert: () => ({ select: () => ({ single: async () => ({ data: { id: "proj-new" }, error: null }) }) }),
        }
      }
      // workflows
      return {
        select: () => ({
          eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: h.workflowsRow }) }) }),
        }),
      }
    },
  },
}))

import { registerRecastTools } from "../recast.js"

interface InjectCall {
  method?: string
  url?: string
  payload?: unknown
  headers?: Record<string, string>
}

/** Stub fastify.inject dispatching on url prefix; records every call. */
function stubFastify(routes: Record<string, (call: InjectCall) => { statusCode: number; body: unknown }>) {
  const calls: InjectCall[] = []
  const fastify = {
    inject: async (opts: InjectCall) => {
      calls.push(opts)
      const key = Object.keys(routes).find((k) => (opts.url ?? "").startsWith(k) && (routes[`${k}::method`] === undefined))
      const exact = Object.keys(routes)
        .filter((k) => !k.includes("::"))
        .sort((a, b) => b.length - a.length)
        .find((k) => (opts.url ?? "").startsWith(k))
      const handler = exact ? routes[exact] : key ? routes[key] : undefined
      if (!handler) return { statusCode: 404, body: JSON.stringify({ error: "no stub for " + opts.url }) }
      const res = handler(opts)
      return { statusCode: res.statusCode, body: typeof res.body === "string" ? res.body : JSON.stringify(res.body) }
    },
  } as unknown as FastifyInstance
  return { fastify, calls }
}

function sessionWith(scopes: Scope[]) {
  return newSession({ userId: "u1", scopes, clientName: "test" })
}

const ALL: Scope[] = ["workflows:read", "workflows:write", "workflows:execute"]

const VALID_SCRIPT = { meta: { title: "Frosted Soda" }, slots: [], scenes: [] }
const DERIVED_DOC = { meta: { title: "Frosted Soda" }, slots: [], scenes: [{ sceneNumber: 1 }] }
const WF_ID = "11111111-2222-4333-8444-555555555555"

beforeEach(() => {
  h.workflowsRow = null
  h.projectRow = { id: "proj-1" }
})

describe("scope gating", () => {
  it("all five tools with full scopes; write/execute/read gate their verbs", async () => {
    const full = buildServer()
    registerRecastTools({ server: full, session: sessionWith(ALL), fastify: stubFastify({}).fastify })
    const names = (await listTools(full)).map((t) => t.name)
    expect(names).toEqual(
      expect.arrayContaining([
        "get_recast_authoring_skill",
        "validate_recast_script",
        "import_recast_script",
        "start_recast",
        "get_recast_status",
      ]),
    )

    const readOnly = buildServer()
    registerRecastTools({ server: readOnly, session: sessionWith(["workflows:read"]), fastify: stubFastify({}).fastify })
    const roNames = (await listTools(readOnly)).map((t) => t.name)
    expect(roNames).toContain("validate_recast_script")
    expect(roNames).toContain("get_recast_status")
    expect(roNames).not.toContain("import_recast_script")
    expect(roNames).not.toContain("start_recast")
  })
})

describe("validate_recast_script", () => {
  it("injects the validate route with the session user and returns the verdict", async () => {
    const { fastify, calls } = stubFastify({
      "/v1/video-analysis/import/validate": () => ({ statusCode: 200, body: { valid: true, errors: [], warnings: [] } }),
    })
    const server = buildServer()
    registerRecastTools({ server, session: sessionWith(ALL), fastify })
    const res = await callTool(server, "validate_recast_script", { script: VALID_SCRIPT })
    expect(res.isError).toBeFalsy()
    expect(res.structuredContent).toMatchObject({ valid: true })
    const call = calls[0]!
    expect((call.payload as Record<string, unknown>).userId).toBe("u1")
  })
})

describe("import_recast_script", () => {
  it("imports → creates workflow in the Recast project → seeds faithful settings", async () => {
    const { fastify, calls } = stubFastify({
      "/v1/video-analysis/import": () => ({
        statusCode: 200,
        body: { jobId: "job-1", created: true, warnings: [], json: DERIVED_DOC },
      }),
      "/v1/workflows/": () => ({ statusCode: 200, body: { data: { id: WF_ID } } }),
      "/v1/workflows": () => ({ statusCode: 200, body: { data: { id: WF_ID } } }),
    })
    const server = buildServer()
    registerRecastTools({ server, session: sessionWith(ALL), fastify })
    const res = await callTool(server, "import_recast_script", { script: VALID_SCRIPT, rights_attested: true })
    expect(res.isError).toBeFalsy()
    expect(res.structuredContent).toMatchObject({ recastId: WF_ID, jobId: "job-1" })
    expect(String((res.structuredContent as { appUrl: string }).appUrl)).toContain(`/recast/${WF_ID}`)

    const importCall = calls.find((c) => c.url === "/v1/video-analysis/import")!
    expect((importCall.payload as Record<string, unknown>).rightsAttested).toBe(true)
    const createCall = calls.find((c) => c.url === "/v1/workflows")!
    expect((createCall.payload as Record<string, unknown>).projectId).toBe("proj-1")
    expect((createCall.payload as Record<string, unknown>).name).toBe("Frosted Soda")
    const patchCall = calls.find((c) => c.method === "PATCH")!
    const settings = (patchCall.payload as { settings: { recast: Record<string, unknown> } }).settings.recast
    expect(settings.fidelity).toBe("faithful")
    expect(typeof settings.rightsAttestedAt).toBe("string")
    // The SERVER's derived document is what seeds (C2), not the input.
    expect((settings.analysis as { blueprint: unknown }).blueprint).toEqual(DERIVED_DOC)
  })

  it("a failed import creates nothing (C3)", async () => {
    const { fastify, calls } = stubFastify({
      "/v1/video-analysis/import": () => ({
        statusCode: 400,
        body: { error: { code: "validation_error", issues: [{ path: "meta.title", message: "required" }] } },
      }),
    })
    const server = buildServer()
    registerRecastTools({ server, session: sessionWith(ALL), fastify })
    const res = await callTool(server, "import_recast_script", { script: {}, rights_attested: true })
    expect(res.isError).toBe(true)
    expect(calls.filter((c) => c.url === "/v1/workflows").length).toBe(0)
  })
})

describe("start_recast", () => {
  const seeded = () => ({
    id: WF_ID,
    user_id: "u1",
    settings: {
      recast: {
        version: 1,
        fidelity: "faithful",
        resolution: "720p",
        results: [],
        analysis: { jobId: "job-1", status: "completed", blueprint: DERIVED_DOC },
      },
    },
  })

  it("without confirm: quotes via /estimate and never buys", async () => {
    h.workflowsRow = seeded()
    const { fastify, calls } = stubFastify({
      "/v1/recast/estimate": () => ({ statusCode: 200, body: { totalCredits: 420, breakdown: { plan: 20, render: 400 } } }),
    })
    const server = buildServer()
    registerRecastTools({ server, session: sessionWith(ALL), fastify })
    const res = await callTool(server, "start_recast", { recast_id: WF_ID })
    expect(res.isError).toBeFalsy()
    expect((res.structuredContent as { quote: { totalCredits: number } }).quote.totalCredits).toBe(420)
    expect(calls.some((c) => c.url === "/v1/recast" && c.method === "POST")).toBe(false)
    const est = calls.find((c) => c.url === "/v1/recast/estimate")!
    expect(est.payload as Record<string, unknown>).toMatchObject({
      fidelity: "faithful",
      renderMethod: "keyframes",
      segmentSec: "scenes-max",
    })
  })

  it("with confirm: buys the plan (faithful + attested + keyframes) and persists the run", async () => {
    h.workflowsRow = seeded()
    const { fastify, calls } = stubFastify({
      "/v1/recast/estimate": () => ({ statusCode: 200, body: { totalCredits: 420, breakdown: {} } }),
      "/v1/recast": (c) => {
        if (c.method === "POST") return { statusCode: 200, body: { recastId: "run-1", analysisJobId: "job-1" } }
        return { statusCode: 404, body: {} }
      },
      "/v1/workflows/": () => ({ statusCode: 200, body: { data: { id: WF_ID } } }),
    })
    const server = buildServer()
    registerRecastTools({ server, session: sessionWith(ALL), fastify })
    const res = await callTool(server, "start_recast", { recast_id: WF_ID, confirm: true })
    expect(res.isError).toBeFalsy()
    expect(res.structuredContent).toMatchObject({ recastRunId: "run-1", status: "planning" })
    const create = calls.find((c) => c.url === "/v1/recast" && c.method === "POST")!
    expect(create.payload as Record<string, unknown>).toMatchObject({
      analysisJobId: "job-1",
      workflowId: WF_ID,
      fidelity: "faithful",
      rightsAttested: true,
      renderMethod: "keyframes",
      // C7 capability opt-in: declared on EVERY create (interactive or not) —
      // the plugin only opens the sheet gate for runs that can answer it.
      clientCapabilities: ["sheet-gate"],
    })
    const patch = calls.find((c) => c.method === "PATCH")!
    const run = (patch.payload as { settings: { recast: { run: Record<string, unknown> } } }).settings.recast.run
    expect(run).toMatchObject({ recastId: "run-1", status: "planning" })
  })

  it("a planned run advances to /start without re-charging", async () => {
    const s = seeded()
    ;(s.settings.recast as Record<string, unknown>).run = {
      recastId: "run-1",
      analysisJobId: "job-1",
      status: "planning",
      startedAt: "2026-08-07T00:00:00Z",
    }
    h.workflowsRow = s
    const { fastify, calls } = stubFastify({
      "/v1/recast/run-1/start": () => ({ statusCode: 200, body: { gvpJobId: "gvp-1" } }),
      "/v1/recast/run-1": () => ({ statusCode: 200, body: { status: "planned" } }),
      "/v1/workflows/": () => ({ statusCode: 200, body: { data: { id: WF_ID } } }),
    })
    const server = buildServer()
    registerRecastTools({ server, session: sessionWith(ALL), fastify })
    const res = await callTool(server, "start_recast", { recast_id: WF_ID })
    expect(res.isError).toBeFalsy()
    expect(res.structuredContent).toMatchObject({ status: "generating" })
    expect(calls.some((c) => c.url === "/v1/recast/run-1/start")).toBe(true)
    expect(calls.some((c) => c.url === "/v1/recast/estimate")).toBe(false)
  })

  it("anchor_mode rides estimate AND create; absent sends nothing", async () => {
    h.workflowsRow = seeded()
    const { fastify, calls } = stubFastify({
      "/v1/recast/estimate": () => ({ statusCode: 200, body: { totalCredits: 380, breakdown: {} } }),
      "/v1/recast": (c) => (c.method === "POST" ? { statusCode: 200, body: { recastId: "run-1" } } : { statusCode: 404, body: {} }),
      "/v1/workflows/": () => ({ statusCode: 200, body: { data: { id: WF_ID } } }),
    })
    const server = buildServer()
    registerRecastTools({ server, session: sessionWith(ALL), fastify })
    await callTool(server, "start_recast", { recast_id: WF_ID, confirm: true, anchor_mode: "none" })
    // The estimate must price the run that renders: "none" drops the anchor
    // surcharge, so the flag reaches BOTH hops, same discipline as interactive.
    const est = calls.find((c) => c.url === "/v1/recast/estimate")!
    expect((est.payload as Record<string, unknown>).anchorMode).toBe("none")
    const create = calls.find((c) => c.url === "/v1/recast" && c.method === "POST")!
    expect((create.payload as Record<string, unknown>).anchorMode).toBe("none")
  })

  it("without anchor_mode the payloads omit anchorMode (server default rules)", async () => {
    h.workflowsRow = seeded()
    const { fastify, calls } = stubFastify({
      "/v1/recast/estimate": () => ({ statusCode: 200, body: { totalCredits: 420, breakdown: {} } }),
    })
    const server = buildServer()
    registerRecastTools({ server, session: sessionWith(ALL), fastify })
    await callTool(server, "start_recast", { recast_id: WF_ID })
    const est = calls.find((c) => c.url === "/v1/recast/estimate")!
    expect("anchorMode" in (est.payload as Record<string, unknown>)).toBe(false)
  })
})

describe("interactive (P3)", () => {
  const seededInteractive = (run?: Record<string, unknown>) => ({
    id: WF_ID,
    user_id: "u1",
    settings: {
      recast: {
        version: 1,
        fidelity: "faithful",
        resolution: "720p",
        results: [],
        analysis: { jobId: "job-1", status: "completed", blueprint: DERIVED_DOC },
        ...(run ? { run } : {}),
      },
    },
  })

  it("start_recast with interactive rides the flag on estimate AND create", async () => {
    h.workflowsRow = seededInteractive()
    const { fastify, calls } = stubFastify({
      "/v1/recast/estimate": () => ({ statusCode: 200, body: { totalCredits: 900, candidateCredits: 480, breakdown: {} } }),
      "/v1/recast": (c) => (c.method === "POST" ? { statusCode: 200, body: { recastId: "run-1" } } : { statusCode: 404, body: {} }),
      "/v1/workflows/": () => ({ statusCode: 200, body: { data: { id: WF_ID } } }),
    })
    const server = buildServer()
    registerRecastTools({ server, session: sessionWith(ALL), fastify })
    await callTool(server, "start_recast", { recast_id: WF_ID, confirm: true, interactive: true })
    const est = calls.find((c) => c.url === "/v1/recast/estimate")!
    expect((est.payload as Record<string, unknown>).interactive).toBe(true)
    const create = calls.find((c) => c.url === "/v1/recast" && c.method === "POST")!
    expect((create.payload as Record<string, unknown>).interactive).toBe(true)
    // The sheet-gate capability rides the interactive create too — same
    // always-sent field the non-interactive test pins.
    expect((create.payload as Record<string, unknown>).clientCapabilities).toEqual(["sheet-gate"])
  })

  it("start_recast on an interactive run advances the server-owned next hop (candidates)", async () => {
    h.workflowsRow = seededInteractive({ recastId: "run-1", status: "planned", startedAt: "t" })
    const { fastify, calls } = stubFastify({
      "/v1/recast/run-1/candidates": () => ({ statusCode: 200, body: { recastId: "run-1", jobId: "cyc-1", cycle: 1 } }),
      "/v1/recast/run-1": () => ({
        statusCode: 200,
        body: { status: "planned", interactive: { phase: "candidates", next: { kind: "candidates", cycle: 1, expect: { images: 6 } } } },
      }),
    })
    const server = buildServer()
    registerRecastTools({ server, session: sessionWith(ALL), fastify })
    const res = await callTool(server, "start_recast", { recast_id: WF_ID })
    expect(res.isError).toBeFalsy()
    expect((res.structuredContent as { advanced?: string }).advanced).toContain("candidates")
    const buy = calls.find((c) => c.url === "/v1/recast/run-1/candidates")!
    expect(buy.payload as Record<string, unknown>).toMatchObject({ cycle: 1, expect: { images: 6 } })
  })

  it("resolve_recast_gate maps a cast pick onto /select and advances", async () => {
    h.workflowsRow = seededInteractive({ recastId: "run-1", status: "planned", startedAt: "t" })
    const { fastify, calls } = stubFastify({
      "/v1/recast/run-1/select": () => ({ statusCode: 200, body: { ok: true } }),
      "/v1/recast/run-1/dispatch": () => ({ statusCode: 200, body: { ok: true } }),
      "/v1/recast/run-1": () => ({
        statusCode: 200,
        body: { status: "planned", interactive: { phase: "candidates", next: { kind: "dispatch" } } },
      }),
    })
    const server = buildServer()
    registerRecastTools({ server, session: sessionWith(ALL), fastify })
    const res = await callTool(server, "resolve_recast_gate", { recast_id: WF_ID, picks: { hero: 1 } })
    expect(res.isError).toBeFalsy()
    const sel = calls.find((c) => c.url === "/v1/recast/run-1/select")!
    expect(sel.payload as Record<string, unknown>).toMatchObject({ gate: "cast", picks: { hero: 1 } })
    // The walk continued: next said dispatch, and dispatch was fired.
    expect(calls.some((c) => c.url === "/v1/recast/run-1/dispatch")).toBe(true)
    expect((res.structuredContent as { advanced?: string }).advanced).toBe("dispatch")
  })

  it("resolve_recast_gate maps a sheet pick onto /select and stops at the open gate", async () => {
    h.workflowsRow = seededInteractive({ recastId: "run-1", status: "planned", startedAt: "t" })
    const sheetGate = {
      kind: "sheet",
      slots: { villain: { label: "Villain", candidates: ["s1.png", "s2.png", "s3.png"] } },
    }
    const { fastify, calls } = stubFastify({
      "/v1/recast/run-1/select": () => ({ statusCode: 200, body: { ok: true } }),
      "/v1/recast/run-1": () => ({
        statusCode: 200,
        body: {
          status: "planned",
          interactive: { phase: "candidates", pendingSheetGate: sheetGate, next: { kind: "gate", gate: "sheet" } },
        },
      }),
    })
    const server = buildServer()
    registerRecastTools({ server, session: sessionWith(ALL), fastify })
    const res = await callTool(server, "resolve_recast_gate", { recast_id: WF_ID, gate: "sheet", picks: { hero: 2 } })
    expect(res.isError).toBeFalsy()
    const sel = calls.find((c) => c.url === "/v1/recast/run-1/select")!
    expect(sel.payload as Record<string, unknown>).toMatchObject({ gate: "sheet", picks: { hero: 2 } })
    // A gate stops the walk: nothing was fired, and the note points back at
    // resolve_recast_gate for the still-open sheet slot.
    expect(calls.some((c) => c.url === "/v1/recast/run-1/dispatch")).toBe(false)
    const sc = res.structuredContent as { advanced?: string; note?: string; interactive?: { pendingSheetGate?: unknown } }
    expect(sc.advanced).toBeUndefined()
    expect(sc.note).toContain("resolve_recast_gate")
    expect(sc.interactive?.pendingSheetGate).toEqual(sheetGate)
  })

  it("resolve_recast_gate rejects an out-of-range sheet pick before touching /select", async () => {
    h.workflowsRow = seededInteractive({ recastId: "run-1", status: "planned", startedAt: "t" })
    const { fastify, calls } = stubFastify({
      "/v1/recast/run-1/select": () => ({ statusCode: 200, body: { ok: true } }),
      "/v1/recast/run-1": () => ({ statusCode: 200, body: { status: "planned", interactive: { phase: "candidates" } } }),
    })
    const server = buildServer()
    registerRecastTools({ server, session: sessionWith(ALL), fastify })
    const res = await callTool(server, "resolve_recast_gate", { recast_id: WF_ID, gate: "sheet", picks: { hero: 12 } })
    expect(res.isError).toBe(true)
    expect(calls.some((c) => c.url === "/v1/recast/run-1/select")).toBe(false)
  })

  it("finish_auto is untouched: alone it sends finishAuto with no gate; with sheet picks it rides them", async () => {
    h.workflowsRow = seededInteractive({ recastId: "run-1", status: "planned", startedAt: "t" })
    const { fastify, calls } = stubFastify({
      "/v1/recast/run-1/select": () => ({ statusCode: 200, body: { ok: true } }),
      "/v1/recast/run-1/dispatch": () => ({ statusCode: 200, body: { ok: true } }),
      "/v1/recast/run-1": () => ({
        statusCode: 200,
        body: { status: "planned", interactive: { phase: "candidates", next: { kind: "dispatch" } } },
      }),
    })
    const server = buildServer()
    registerRecastTools({ server, session: sessionWith(ALL), fastify })

    const alone = await callTool(server, "resolve_recast_gate", { recast_id: WF_ID, finish_auto: true })
    expect(alone.isError).toBeFalsy()
    const first = calls.find((c) => c.url === "/v1/recast/run-1/select")!
    expect(first.payload as Record<string, unknown>).toMatchObject({ finishAuto: true })
    expect(first.payload as Record<string, unknown>).not.toHaveProperty("gate")
    expect(first.payload as Record<string, unknown>).not.toHaveProperty("picks")

    calls.length = 0
    const withPicks = await callTool(server, "resolve_recast_gate", {
      recast_id: WF_ID,
      gate: "sheet",
      picks: { hero: 0 },
      finish_auto: true,
    })
    expect(withPicks.isError).toBeFalsy()
    const second = calls.find((c) => c.url === "/v1/recast/run-1/select")!
    expect(second.payload as Record<string, unknown>).toMatchObject({ gate: "sheet", picks: { hero: 0 }, finishAuto: true })
  })

  it("get_recast_status surfaces a pending sheet gate as a waiting choice", async () => {
    h.workflowsRow = seededInteractive({ recastId: "run-1", status: "planned", startedAt: "t" })
    const sheetGate = { kind: "sheet", slots: { hero: { label: "Hero", candidates: ["s1.png", "s2.png", "s3.png"] } } }
    const { fastify } = stubFastify({
      "/v1/recast/run-1": () => ({
        statusCode: 200,
        body: {
          status: "planned",
          interactive: { phase: "candidates", pendingSheetGate: sheetGate, next: { kind: "gate", gate: "sheet" } },
        },
      }),
    })
    const server = buildServer()
    registerRecastTools({ server, session: sessionWith(ALL), fastify })
    const res = await callTool(server, "get_recast_status", { recast_id: WF_ID })
    const sc = res.structuredContent as { interactive?: { pendingSheetGate?: unknown }; next?: string }
    expect(sc.interactive?.pendingSheetGate).toEqual(sheetGate)
    expect(sc.next).toContain("resolve_recast_gate")
  })

  it("get_recast_status passes the interactive gate through for the widget", async () => {
    h.workflowsRow = seededInteractive({ recastId: "run-1", status: "planned", startedAt: "t" })
    const gate = { kind: "cast", slots: { hero: { label: "Hero", candidates: ["u1.png", "u2.png", "u3.png"] } } }
    const { fastify } = stubFastify({
      "/v1/recast/run-1": () => ({
        statusCode: 200,
        body: { status: "planned", interactive: { phase: "candidates", pendingGate: gate, next: { kind: "gate", gate: "cast" } } },
      }),
    })
    const server = buildServer()
    registerRecastTools({ server, session: sessionWith(ALL), fastify })
    const res = await callTool(server, "get_recast_status", { recast_id: WF_ID })
    const sc = res.structuredContent as { interactive?: { pendingGate?: unknown }; next?: string; recastId?: string }
    expect(sc.recastId).toBe(WF_ID)
    expect(sc.interactive?.pendingGate).toEqual(gate)
    expect(sc.next).toContain("resolve_recast_gate")
  })
})

describe("get_recast_status", () => {
  it("blueprint stage when no run exists", async () => {
    h.workflowsRow = {
      id: WF_ID,
      user_id: "u1",
      settings: { recast: { analysis: { jobId: "job-1", status: "completed" }, results: [] } },
    }
    const server = buildServer()
    registerRecastTools({ server, session: sessionWith(ALL), fastify: stubFastify({}).fastify })
    const res = await callTool(server, "get_recast_status", { recast_id: WF_ID })
    expect(res.structuredContent).toMatchObject({ stage: "blueprint" })
  })

  it("reconciles a completed snapshot into settings (take appended, run cleared)", async () => {
    h.workflowsRow = {
      id: WF_ID,
      user_id: "u1",
      settings: {
        recast: {
          analysis: { jobId: "job-1", status: "completed" },
          results: [],
          run: { recastId: "run-1", status: "generating", startedAt: "t" },
        },
      },
    }
    const { fastify, calls } = stubFastify({
      "/v1/recast/run-1": () => ({
        statusCode: 200,
        body: { status: "completed", resultUrl: "https://r2/final.mp4", gvpJobId: "gvp-1", segmentsDone: 3, segmentsTotal: 3 },
      }),
      "/v1/workflows/": () => ({ statusCode: 200, body: { data: { id: WF_ID } } }),
    })
    const server = buildServer()
    registerRecastTools({ server, session: sessionWith(ALL), fastify })
    const res = await callTool(server, "get_recast_status", { recast_id: WF_ID })
    expect(res.structuredContent).toMatchObject({ status: "completed", resultUrl: "https://r2/final.mp4" })
    const patch = calls.find((c) => c.method === "PATCH")!
    const recast = (patch.payload as { settings: { recast: { results: Array<Record<string, unknown>>; run?: unknown } } }).settings.recast
    expect(recast.results[0]).toMatchObject({ version: 1, videoUrl: "https://r2/final.mp4", recastId: "run-1", fidelity: "faithful" })
    expect(recast.run).toBeUndefined()
  })
})
