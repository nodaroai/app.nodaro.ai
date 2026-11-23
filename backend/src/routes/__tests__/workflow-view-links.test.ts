/**
 * A workflow's view link (routes/workflow-view-links.ts + routes/workflow-views.ts):
 * creator-only on the owner's side; public, token-gated and read-only on the
 * other; 503 while the table is not in the database; turning the link off
 * takes the page, the embed's data, the download and the card down at once;
 * the frozen copy is what viewers download until it is saved again; the
 * card's robots rule follows the owner's switch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import type { QueryResult, RecordedQuery } from "../../lib/__tests__/fake-supabase-query.js"

const OWNER = "00000000-0000-4000-8000-000000000001"
const OTHER = "00000000-0000-4000-8000-000000000002"
const WF = "00000000-0000-4000-8000-0000000000f1"

type Row = Record<string, unknown>

const db = vi.hoisted(() => ({
  log: [] as RecordedQuery[],
  workflows: [] as Row[],
  links: [] as Row[],
}))

function matches(q: RecordedQuery, row: Row): boolean {
  return q.ops.every((o) => o.m !== "eq" || (row[String(o.a[0])] ?? null) === o.a[1])
}

function respond(q: RecordedQuery): QueryResult {
  const table = q.table === "workflows" ? db.workflows : q.table === "workflow_view_links" ? db.links : null
  if (!table) return { data: null, error: null }
  const insert = q.ops.find((o) => o.m === "upsert" || o.m === "insert")
  if (insert) {
    const row = insert.a[0] as Row
    if (!table.some((r) => r.workflow_id === row.workflow_id)) {
      table.push({ indexable: true, export_snapshot: null, export_includes_assets: null, exported_at: null, created_at: "2026-11-23T10:00:00Z", ...row })
    }
    return { data: null, error: null }
  }
  const update = q.ops.find((o) => o.m === "update")
  if (update) {
    const found = table.filter((r) => matches(q, r))
    for (const r of found) Object.assign(r, update.a[0] as Row)
    return { data: found[0] ?? null, error: null }
  }
  if (q.ops.some((o) => o.m === "delete")) {
    const keep = table.filter((r) => !matches(q, r))
    table.length = 0
    table.push(...keep)
    return { data: null, error: null }
  }
  return { data: table.find((r) => matches(q, r)) ?? null, error: null }
}

vi.mock("../../lib/supabase.js", async () => {
  const { makeFakeFrom } = await import("../../lib/__tests__/fake-supabase-query.js")
  return { supabase: { from: makeFakeFrom(db.log, (q) => respond(q)) } }
})
vi.mock("../../lib/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/config.js")>()
  return { ...actual, config: { ...actual.config, PUBLIC_URL: "https://app.example", R2_PUBLIC_URL: "https://cdn.example" } }
})
const gates = vi.hoisted(() => ({ publicOutputs: true, blocked: new Set<string>() }))
vi.mock("../../lib/surface-profile.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/surface-profile.js")>()),
  surfaceAllowsPublicOutputs: () => gates.publicOutputs,
}))
vi.mock("../../lib/access-blocks.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/access-blocks.js")>()),
  isUserBlocked: async (id: string) => gates.blocked.has(id),
}))
vi.mock("../../lib/content-restriction-set.js", () => ({ restrictedKeysNow: () => new Set<string>() }))
vi.mock("../../lib/canvas-result-ids.js", () => ({ resolveCanvasResultIds: async (nodes: unknown) => nodes }))
vi.mock("../../lib/ugc-composed-graph.js", () => ({ ugcPublishedGraph: async (nodes: unknown) => ({ nodes }) }))
const pictures = vi.hoisted(() => ({ started: [] as string[] }))
vi.mock("../../lib/share-links/card-image/service.js", () => ({
  renderedCardImage: async () => null,
  startCardRender: async (token: string) => {
    pictures.started.push(token)
    return true
  },
}))

import { workflowViewLinkRoutes } from "../workflow-view-links.js"
import { workflowViewRoutes } from "../workflow-views.js"
import { setViewLinksTablePresentForTests } from "../../lib/workflow-view/table.js"
import { __isPublicRouteForTest, isAnonymousRoute } from "../../middleware/auth.js"

function workflow(over: Row = {}): Row {
  return {
    id: WF,
    name: "Astronaut mockup",
    user_id: OWNER,
    workspace_id: null,
    settings: {},
    nodes: [
      { id: "img", type: "generate-image", position: { x: 0, y: 0 }, data: { label: "Hero", prompt: "an astronaut", generatedImageUrl: "https://cdn.example/images/hero.png" } },
      { id: "trig", type: "webhook-trigger", position: { x: 0, y: 0 }, data: { label: "Hook", webhookToken: "whk_SECRET_TOKEN_0123456789" } },
    ],
    edges: [],
    ...over,
  }
}

let app: FastifyInstance
let caller: string | null = OWNER

beforeEach(async () => {
  db.log.length = 0
  db.workflows.length = 0
  db.links.length = 0
  db.workflows.push(workflow())
  gates.publicOutputs = true
  gates.blocked.clear()
  pictures.started.length = 0
  caller = OWNER
  setViewLinksTablePresentForTests(true)
  app = Fastify({ logger: false })
  app.addHook("onRequest", async (req) => {
    if (caller && !req.url.startsWith("/v1/workflow-views") && !req.url.startsWith("/og/")) req.userId = caller
  })
  await app.register(workflowViewLinkRoutes)
  await app.register(workflowViewRoutes)
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

const enable = (body: Row = { locale: "he" }) => app.inject({ method: "POST", url: `/v1/workflows/${WF}/view-link`, payload: body })
const view = (token: string) => app.inject({ method: "GET", url: `/v1/workflow-views/${token}` })

async function enabledToken(): Promise<string> {
  const res = await enable()
  expect(res.statusCode).toBe(200)
  return res.json().token as string
}

describe("the routes' doors", () => {
  it("the public reads take no credential; the owner's routes do", () => {
    const token = "T".repeat(43)
    expect(__isPublicRouteForTest("GET", `/v1/workflow-views/${token}`)).toBe(true)
    expect(__isPublicRouteForTest("GET", `/v1/workflow-views/${token}/export`)).toBe(true)
    expect(__isPublicRouteForTest("GET", `/og/view/${token}`)).toBe(true)
    expect(__isPublicRouteForTest("HEAD", `/og/view/${token}`)).toBe(true)
    expect(isAnonymousRoute("GET", `/v1/workflow-views/${token}`)).toBe(true)
    expect(__isPublicRouteForTest("POST", `/v1/workflow-views/${token}`)).toBe(false)
    expect(__isPublicRouteForTest("POST", `/v1/workflows/${WF}/view-link`)).toBe(false)
    expect(__isPublicRouteForTest("GET", `/v1/workflows/${WF}/view-link`)).toBe(false)
  })
})

describe("the owner's side", () => {
  it("turns the link on once, with a 43-character token, and returns the same link again", async () => {
    const first = await enable()
    expect(first.json()).toMatchObject({ enabled: true, indexable: true, export: null })
    expect(first.json().token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const second = await enable()
    expect(second.json().token).toBe(first.json().token)
    expect(db.links).toHaveLength(1)
    expect(db.links[0]!.locale).toBe("he")
    // The card's picture starts rendering at once, under its own key namespace.
    await new Promise((r) => setTimeout(r, 0))
    expect(pictures.started).toEqual([`workflow-view:${first.json().token}`, `workflow-view:${first.json().token}`])
  })

  it("is creator-only: another user's workflow answers 404 and nothing is written", async () => {
    caller = OTHER
    for (const res of [
      await enable(),
      await app.inject({ method: "GET", url: `/v1/workflows/${WF}/view-link` }),
      await app.inject({ method: "PATCH", url: `/v1/workflows/${WF}/view-link`, payload: { indexable: false } }),
      await app.inject({ method: "POST", url: `/v1/workflows/${WF}/view-link/export`, payload: { includeAssets: false } }),
      await app.inject({ method: "DELETE", url: `/v1/workflows/${WF}/view-link` }),
    ]) {
      expect(res.statusCode).toBe(404)
    }
    expect(db.links).toHaveLength(0)
  })

  it("asks for a credential", async () => {
    caller = null
    expect((await enable()).statusCode).toBe(401)
  })

  it("refuses work in a workspace and a deployment without public work", async () => {
    db.workflows[0]!.workspace_id = "00000000-0000-4000-8000-0000000000e1"
    expect((await enable()).json().error).toMatchObject({ code: "share_not_allowed", reason: "workspace" })
    db.workflows[0]!.workspace_id = null
    gates.publicOutputs = false
    expect((await enable()).json().error).toMatchObject({ code: "share_not_allowed", reason: "sharing_disabled" })
    expect(db.links).toHaveLength(0)
  })

  it("answers 503 not_available on every route while the table is not in the database", async () => {
    setViewLinksTablePresentForTests(false)
    expect((await enable()).statusCode).toBe(503)
    expect((await app.inject({ method: "GET", url: `/v1/workflows/${WF}/view-link` })).json().error.code).toBe("not_available")
    expect((await view("T".repeat(43))).statusCode).toBe(503)
  })

  it("the search-engine switch is the owner's", async () => {
    await enabledToken()
    const res = await app.inject({ method: "PATCH", url: `/v1/workflows/${WF}/view-link`, payload: { indexable: false } })
    expect(res.json()).toMatchObject({ enabled: true, indexable: false })
    expect((await app.inject({ method: "PATCH", url: `/v1/workflows/${WF}/view-link`, payload: { indexable: "no" } })).statusCode).toBe(400)
  })
})

describe("the public side", () => {
  it("shows the canvas without its secrets, to anyone, never cached", async () => {
    const token = await enabledToken()
    caller = null
    const res = await view(token)
    expect(res.statusCode).toBe(200)
    expect(res.headers["cache-control"]).toBe("no-store")
    const body = res.json()
    expect(body).toMatchObject({ name: "Astronaut mockup", indexable: true, export: null })
    expect(body.nodes.map((n: Row) => n.id)).toEqual(["img", "trig"])
    expect(res.body).not.toContain("whk_SECRET_TOKEN")
    expect(res.body).toContain("an astronaut")
  })

  it("an unknown token, a malformed one, a blocked owner, a workflow that changed hands or moved into a workspace: 404, the same answer", async () => {
    const token = await enabledToken()
    expect((await view("T".repeat(43))).statusCode).toBe(404)
    expect((await view("short")).statusCode).toBe(404)
    gates.blocked.add(OWNER)
    expect((await view(token)).statusCode).toBe(404)
    gates.blocked.clear()
    db.workflows[0]!.user_id = OTHER
    expect((await view(token)).statusCode).toBe(404)
    db.workflows[0]!.user_id = OWNER
    // Its project moved into a workspace: no longer shown by link.
    db.workflows[0]!.workspace_id = "00000000-0000-4000-8000-0000000000e1"
    expect((await view(token)).statusCode).toBe(404)
    db.workflows[0]!.workspace_id = null
    expect((await view(token)).statusCode).toBe(200)
    gates.publicOutputs = false
    expect((await view(token)).statusCode).toBe(404)
  })

  it("turning the link off takes the canvas, the download and the card down; turning it on again makes a new link", async () => {
    const token = await enabledToken()
    await app.inject({ method: "POST", url: `/v1/workflows/${WF}/view-link/export`, payload: { includeAssets: false } })
    const off = await app.inject({ method: "DELETE", url: `/v1/workflows/${WF}/view-link` })
    expect(off.json()).toEqual({ enabled: false })
    expect((await view(token)).statusCode).toBe(404)
    expect((await app.inject({ method: "GET", url: `/v1/workflow-views/${token}/export` })).statusCode).toBe(404)
    const card = await app.inject({ method: "GET", url: `/og/view/${token}` })
    expect(card.statusCode).toBe(404)
    expect(card.body).not.toContain("Astronaut")
    expect((await enabledToken())).not.toBe(token)
  })
})

describe("the downloadable copy", () => {
  it("is frozen: viewers get the saved copy, not later edits, until it is saved again", async () => {
    const token = await enabledToken()
    expect((await app.inject({ method: "GET", url: `/v1/workflow-views/${token}/export` })).statusCode).toBe(404)
    const saved = await app.inject({ method: "POST", url: `/v1/workflows/${WF}/view-link/export`, payload: { includeAssets: false } })
    expect(saved.json().export).toMatchObject({ includesAssets: false })
    db.workflows[0]!.name = "Renamed later"
    const file = await app.inject({ method: "GET", url: `/v1/workflow-views/${token}/export` })
    expect(file.statusCode).toBe(200)
    expect(file.headers["content-disposition"]).toBe('attachment; filename="Astronaut-mockup.nodaro.json"')
    expect(file.json()).toMatchObject({ version: 1, name: "Astronaut mockup" })
    expect(file.body).not.toContain("whk_SECRET_TOKEN")
    await app.inject({ method: "POST", url: `/v1/workflows/${WF}/view-link/export`, payload: { includeAssets: false } })
    expect((await app.inject({ method: "GET", url: `/v1/workflow-views/${token}/export` })).json().name).toBe("Renamed later")
    // The page says a copy is offered.
    expect((await view(token)).json().export).toMatchObject({ includesAssets: false })
  })

  it("needs a link, and can be withdrawn", async () => {
    expect((await app.inject({ method: "POST", url: `/v1/workflows/${WF}/view-link/export`, payload: { includeAssets: true } })).statusCode).toBe(404)
    const token = await enabledToken()
    await app.inject({ method: "POST", url: `/v1/workflows/${WF}/view-link/export`, payload: { includeAssets: false } })
    const removed = await app.inject({ method: "DELETE", url: `/v1/workflows/${WF}/view-link/export` })
    expect(removed.json().export).toBeNull()
    expect((await app.inject({ method: "GET", url: `/v1/workflow-views/${token}/export` })).statusCode).toBe(404)
  })

  it("the page's own read never names the saved copy", async () => {
    const token = await enabledToken()
    db.log.length = 0
    await view(token)
    const selects = db.log.filter((q) => q.table === "workflow_view_links").flatMap((q) => q.ops.filter((o) => o.m === "select").map((o) => String(o.a[0])))
    expect(selects.length).toBeGreaterThan(0)
    expect(selects.some((s) => s.includes("export_snapshot"))).toBe(false)
  })
})

describe("the preview card", () => {
  it("names the workflow and its tool in the link's language, with the owner's robots rule", async () => {
    const token = await enabledToken()
    const on = await app.inject({ method: "GET", url: `/og/view/${token}` })
    expect(on.statusCode).toBe(200)
    expect(on.headers["x-robots-tag"]).toBe("all")
    expect(on.body).toContain('<meta property="og:title" content="Astronaut mockup · זרימת עבודה">')
    expect(on.body).toContain('<meta name="robots" content="index, follow">')
    expect(on.body).toContain(`<link rel="canonical" href="https://app.example/view/${token}">`)
    expect(on.body).not.toContain("location.replace")
    expect(on.body).not.toContain("whk_SECRET_TOKEN")
    await app.inject({ method: "PATCH", url: `/v1/workflows/${WF}/view-link`, payload: { indexable: false } })
    const off = await app.inject({ method: "GET", url: `/og/view/${token}` })
    expect(off.headers["x-robots-tag"]).toBe("noindex")
    expect(off.body).toContain('<meta name="robots" content="noindex">')
  })

  it("keeps user text inert", async () => {
    db.workflows[0]!.name = '<script>alert(1)</script>"'
    const token = await enabledToken()
    const res = await app.inject({ method: "GET", url: `/og/view/${token}` })
    expect(res.body).not.toContain("<script>alert")
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'")
  })
})
