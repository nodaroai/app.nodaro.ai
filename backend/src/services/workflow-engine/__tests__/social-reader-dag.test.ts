/**
 * Read Inspiration and Read Competitor through the orchestrator.
 *
 * What a graph run must share with a direct call, or it is a second
 * implementation pretending to be one:
 *  - it posts to the SAME routes with a body the route's own schema accepts —
 *    the route is where every refusal lives — including the blank fields a
 *    node keeps ("" for an unused tag, "all" for every platform) and a day
 *    only in day mode, with or without its timezone;
 *  - it names the workflow (the route refuses a run of someone else's) and the
 *    runner;
 *  - the settled job row is read the same way on both engines: `json` yields
 *    the posts, `text` the digest, and a skipped / "Run from here" node hands
 *    on the posts it holds, with their role and saved date.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { OrchestratorContext, SimpleNode } from "../types.js"

const mocks = vi.hoisted(() => ({ update: vi.fn(), queue: vi.fn(), fetch: vi.fn(), row: {} as Record<string, unknown> }))

vi.mock("../../../lib/supabase.js", () => {
  const chain = {
    select: () => chain, eq: () => chain,
    update: (value: unknown) => { mocks.update(value); return chain },
    single: async () => ({ data: mocks.row, error: null }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve),
  }
  return { supabase: { from: () => chain } }
})
vi.mock("../../../lib/config.js", () => ({ config: { INTERNAL_ORCHESTRATOR_SECRET: "x".repeat(40) }, hasCredits: () => true, isCloud: () => true, isBusiness: () => false, isCommunity: () => false }))
vi.mock("../../../lib/queue.js", () => ({ videoQueue: { add: mocks.queue } }))
vi.mock("../../../lib/render-queue.js", () => ({ renderQueue: { add: mocks.queue } }))
vi.mock("../../../ee/billing/credits.js", () => ({ CreditsService: {} }))
vi.mock("../../../workers/shared.js", () => ({ refundJobCredits: vi.fn() }))

import { executeNode } from "../node-executor.js"
import { extractSavedNodeOutput, getPrimaryOutput } from "../output-extractor.js"
import { competitorReadBody, inspirationReadBody } from "../../../routes/social-post-reads.js"

const BRAND = "0f2c3a10-5d0e-4b6a-9c1d-2e3f4a5b6c7d"

const post = (id: string, extra: Record<string, unknown> = {}) => ({
  id, platform: "instagram", url: `https://www.instagram.com/p/${id}/`, text: `post ${id}`,
  author: { handle: "acme", name: "Acme" }, metrics: { views: 10 }, media: { kind: "image" }, hashtags: [], extra: {}, ...extra,
})

const context = (): OrchestratorContext => ({
  executionId: "execution-1", workflowId: "workflow-1", userId: "user-1",
  triggerType: "manual", cancelled: false, billingContext: { payer: "user", userId: "user-1" },
})

function posted() {
  return mocks.fetch.mock.calls.map(([url, req]) => ({
    url: url as string,
    body: JSON.parse((req as { body: string }).body) as Record<string, unknown>,
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.fetch.mockImplementation(async () => ({ ok: true, json: async () => ({ jobId: "reader-job" }), text: async () => "" }))
  vi.stubGlobal("fetch", mocks.fetch)
})

describe("Read Inspiration through the orchestrator", () => {
  const posts = [post("s1", { savedAt: "2026-10-06T09:00:00.000Z", note: "hook" })]
  beforeEach(() => {
    mocks.row = { status: "completed", credits: 0, input_data: {}, output_data: { json: posts, text: "post s1", generatedText: "post s1", count: 1 } }
  })

  it("window mode: a route-valid body with the node's blank fields, the workflow and the runner — no day", async () => {
    const node: SimpleNode = {
      id: "insp", type: "inspiration-read",
      data: { platform: "all", tag: "", period: "window", windowAmount: 7, windowUnit: "days", day: "", timezone: "", limit: 20, order: "newest" },
    }
    const result = await executeNode(node, {}, [], [node], {}, context())
    const [run] = posted()
    expect(run.url).toMatch(/\/v1\/inspiration-read$/)
    expect(inspirationReadBody.safeParse(run.body).success).toBe(true)
    expect(run.body).toMatchObject({ platform: "all", tag: "", period: "window", windowAmount: 7, windowUnit: "days", workflowId: "workflow-1", nodeId: "insp", userId: "user-1" })
    expect(run.body).not.toHaveProperty("day")
    expect(run.body).not.toHaveProperty("timezone")
    expect(mocks.queue).not.toHaveBeenCalled()
    // The settled row is read like a direct call's result.
    expect(getPrimaryOutput(result.output, "inspiration-read", "json")).toBe(JSON.stringify(posts))
    expect(getPrimaryOutput(result.output, "inspiration-read", "text")).toBe("post s1")
    expect(getPrimaryOutput(result.output, "inspiration-read", undefined)).toBe("post s1")
  })

  it("day mode: the day and its timezone are sent, and the route takes them", async () => {
    const node: SimpleNode = {
      id: "insp", type: "inspiration-read",
      data: { platform: "x", tag: "hooks", period: "day", windowAmount: 7, windowUnit: "days", day: "2026-10-06", timezone: "Asia/Jerusalem", limit: 5, order: "oldest" },
    }
    await executeNode(node, {}, [], [node], {}, context())
    const [run] = posted()
    expect(inspirationReadBody.safeParse(run.body).success).toBe(true)
    expect(run.body).toMatchObject({ period: "day", day: "2026-10-06", timezone: "Asia/Jerusalem", platform: "x", tag: "hooks" })
  })
})

describe("Read Competitor through the orchestrator", () => {
  beforeEach(() => {
    mocks.row = { status: "completed", credits: 0, input_data: {}, output_data: { json: [post("b1", { role: "own" })], text: "post b1", generatedText: "post b1", count: 1 } }
  })

  it("a route-valid body; a day written without a timezone (an agent, a template) is still accepted", async () => {
    const node: SimpleNode = {
      id: "comp", type: "competitor-read",
      data: { competitorId: BRAND, platform: "all", role: "own", period: "day", windowAmount: 7, windowUnit: "days", day: "2026-10-06", limit: 20, order: "newest" },
    }
    await executeNode(node, {}, [], [node], {}, context())
    const [run] = posted()
    expect(run.url).toMatch(/\/v1\/competitor-read$/)
    expect(competitorReadBody.safeParse(run.body).success).toBe(true)
    expect(run.body).toMatchObject({ competitorId: BRAND, role: "own", period: "day", day: "2026-10-06", workflowId: "workflow-1", userId: "user-1" })
    expect(run.body).not.toHaveProperty("tag")
  })
})

describe("a skipped / Run-from-here reader hands on the posts it holds", () => {
  it("with their role and saved date; nothing when it holds none", () => {
    const held = [post("b1", { role: "about" }), post("s1", { savedAt: "2026-10-06T09:00:00.000Z" })]
    const out = extractSavedNodeOutput({ id: "r", type: "competitor-read", data: { generatedJson: held, generatedText: "x" } } as SimpleNode)
    expect(out?.json).toEqual(held)
    expect((out?.json as Array<Record<string, unknown>>)[0]?.role).toBe("about")
    expect((out?.json as Array<Record<string, unknown>>)[1]?.savedAt).toBe("2026-10-06T09:00:00.000Z")
    expect(out?.listResults).toHaveLength(2)
    expect(extractSavedNodeOutput({ id: "r", type: "inspiration-read", data: { generatedJson: [] } } as SimpleNode)).toBeUndefined()
  })
})
