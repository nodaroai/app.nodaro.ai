/**
 * The two collection nodes through the orchestrator.
 *
 * What a graph run must share with a direct call, or it is a second
 * implementation pretending to be one:
 *
 *  - it posts to the SAME routes with a body the route's own schema accepts —
 *    the route is where every refusal lives;
 *  - Save to Collection sends the item it was wired (JSON text or plain text),
 *    the picture / video as media links, and an Idempotency-Key that names the
 *    execution, the node and the fan-out iteration, so a re-picked node (or a
 *    re-run iteration) resolves to the SAME write instead of a second record;
 *  - Read Collection sends no such key (a read is not a write);
 *  - the settled job row is read the same way on both engines: `json` yields
 *    the record(s), `text` yields the headline / digest.
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
import { buildNodeOutputFromJobData, getPrimaryOutput } from "../output-extractor.js"
import { collectionReadBody, collectionWriteBody } from "../../../routes/collection-nodes.js"

const COLLECTION_ID = "0f2c3a10-5d0e-4b6a-9c1d-2e3f4a5b6c7d"
const record = (id: string) => ({
  id, collectionId: COLLECTION_ID, userId: "user-1", dedupeKey: `https://news.example.test/${id}`, idempotencyKey: null,
  title: `Story ${id}`, text: `Body ${id}`, url: `https://news.example.test/${id}`, media: [], fields: {},
  source: { via: "node", nodeType: "collection-write" }, createdAt: "2026-10-06T08:00:00.000Z",
})

const context = (): OrchestratorContext => ({
  executionId: "execution-1", workflowId: "workflow-1", userId: "user-1",
  triggerType: "manual", cancelled: false, billingContext: { payer: "user", userId: "user-1" },
})

/** The request the node posted. */
function posted() {
  return mocks.fetch.mock.calls.map(([url, req]) => ({
    url: url as string,
    headers: (req as { headers: Record<string, string> }).headers,
    body: JSON.parse((req as { body: string }).body) as Record<string, unknown>,
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.fetch.mockImplementation(async () => ({
    ok: true,
    json: async () => ({ jobId: "coll-job" }),
    text: async () => "",
  }))
  vi.stubGlobal("fetch", mocks.fetch)
})

describe("Save to Collection through the orchestrator", () => {
  const written = record("r1")
  beforeEach(() => {
    mocks.row = {
      status: "completed", credits: 0, input_data: {},
      output_data: { json: written, text: "Story r1", generatedText: "Story r1", recordId: "r1", outcome: "inserted", evicted: 0, collectionName: "articles" },
    }
  })

  it("posts a route-valid body: the wired item, the media links, the node's own fields, and a per-iteration Idempotency-Key", async () => {
    const node: SimpleNode = {
      id: "save-node", type: "collection-write",
      data: { collectionId: COLLECTION_ID, title: "", text: "  ", link: "", dedupeKey: "story-r1" },
    }
    const item = JSON.stringify({ title: "Story r1", body: "Body r1", url: "https://news.example.test/r1" })
    const result = await executeNode(
      node,
      { prompt: item, imageUrl: "https://media.example.test/cover.png", videoUrl: "https://media.example.test/clip.mp4" },
      [], [node], {}, context(), 2,
    )

    const [run] = posted()
    expect(run.url).toMatch(/\/v1\/collection-write$/)
    expect(collectionWriteBody.safeParse(run.body).success).toBe(true)
    expect(run.body).toMatchObject({
      collectionId: COLLECTION_ID,
      item,
      dedupeKey: "story-r1",
      media: [
        { type: "image", url: "https://media.example.test/cover.png" },
        { type: "video", url: "https://media.example.test/clip.mp4" },
      ],
      executionId: "execution-1", workflowId: "workflow-1", nodeId: node.id, userId: "user-1",
    })
    // An empty or blank node field is NOT sent — the item's own value must win there.
    for (const key of ["title", "text", "link"]) expect(run.body).not.toHaveProperty(key)
    // Fan-out iteration 2 of this node in this execution: one write, however often it is re-picked.
    expect(run.headers["Idempotency-Key"]).toBe(`wf-execution-1-${node.id}-2`)
    // Nothing queued: the route owns the job row.
    expect(mocks.queue).not.toHaveBeenCalled()

    // The settled row is read like a direct call's result.
    expect(result.output.json).toEqual(written)
    expect(getPrimaryOutput(result.output, "collection-write", "json")).toBe(JSON.stringify(written))
    expect(getPrimaryOutput(result.output, "collection-write", undefined)).toBe(JSON.stringify(written))
  })

  it("a single (non-fan-out) run keys on the execution and the node alone, and an override item wins over the wire", async () => {
    const node: SimpleNode = { id: "save-node", type: "collection-write", data: { collectionId: COLLECTION_ID, title: "Typed title" } }
    await executeNode(node, { prompt: "from the wire", overridePrompt: "the fan-out row" }, [], [node], {}, context())
    const [run] = posted()
    expect(run.headers["Idempotency-Key"]).toBe(`wf-execution-1-${node.id}`)
    expect(run.body.item).toBe("the fan-out row")
    expect(run.body.title).toBe("Typed title")
    expect(run.body).not.toHaveProperty("media")
  })

  it("inside a sub-workflow the key carries the sub-workflow node and the iteration that entered it — one write per iteration", async () => {
    const node: SimpleNode = { id: "inner-save", type: "collection-write", data: { collectionId: COLLECTION_ID } }
    await executeNode(node, { prompt: "row 2" }, [], [node], {}, context(), undefined, undefined, ["sub-node-2"])
    expect(posted()[0]!.headers["Idempotency-Key"]).toBe(`wf-execution-1-sub-node-2-${node.id}`)
  })

  it("only a real address rides along as a medium — a fan-out guess that put text into imageUrl is not a 400 for the item", async () => {
    const node: SimpleNode = { id: "save-node", type: "collection-write", data: { collectionId: COLLECTION_ID } }
    await executeNode(node, { prompt: "the item", imageUrl: '{"title":"a post","imageUrl":"https://cdn.example.test/a.jpg?t=1"}' }, [], [node], {}, context())
    const [run] = posted()
    expect(run.body).not.toHaveProperty("media")
    expect(collectionWriteBody.safeParse(run.body).success).toBe(true)
  })
})

describe("Read Collection through the orchestrator", () => {
  const records = [record("r1"), record("r2")]
  const digest = "- Story r1 · 2026-10-06 · https://news.example.test/r1\n- Story r2 · 2026-10-06 · https://news.example.test/r2"
  beforeEach(() => {
    mocks.row = {
      status: "completed", credits: 0, input_data: {},
      output_data: { json: records, listResults: records.map((r) => JSON.stringify(r)), text: digest, generatedText: digest, count: 2, since: "2026-10-05T08:00:00.000Z", collectionName: "articles" },
    }
  })

  it("posts the node's own settings as a route-valid body, with no Idempotency-Key", async () => {
    const node: SimpleNode = {
      id: "read-node", type: "collection-read",
      data: { collectionId: COLLECTION_ID, windowAmount: 2, windowUnit: "days", limit: 25, order: "oldest", textFormat: "full" },
    }
    const result = await executeNode(node, {}, [], [node], {}, context())

    const [run] = posted()
    expect(run.url).toMatch(/\/v1\/collection-read$/)
    expect(collectionReadBody.safeParse(run.body).success).toBe(true)
    expect(run.body).toMatchObject({
      collectionId: COLLECTION_ID, windowAmount: 2, windowUnit: "days", limit: 25, order: "oldest", textFormat: "full",
      workflowId: "workflow-1", nodeId: node.id, userId: "user-1",
    })
    expect(run.headers).not.toHaveProperty("Idempotency-Key")

    // `json` → the records (a text consumer gets them stringified); `text` / no handle → the digest.
    expect(result.output.json).toEqual(records)
    expect(getPrimaryOutput(result.output, "collection-read", "json")).toBe(JSON.stringify(records))
    expect(getPrimaryOutput(result.output, "collection-read", "text")).toBe(digest)
    expect(getPrimaryOutput(result.output, "collection-read", undefined)).toBe(digest)
  })

  it("an empty window settles as completed with an empty text, so the text consumers behind it are skipped", async () => {
    mocks.row = {
      status: "completed", credits: 0, input_data: {},
      output_data: { json: [], listResults: [], text: "", generatedText: "", count: 0, since: "2026-10-05T08:00:00.000Z", collectionName: "articles" },
    }
    const node: SimpleNode = { id: "read-node", type: "collection-read", data: { collectionId: COLLECTION_ID } }
    const result = await executeNode(node, {}, [], [node], {}, context())
    expect(result.output.text).toBe("")
    expect(getPrimaryOutput(result.output, "collection-read", "text")).toBe("")
    // The json pip is nothing too — never the string "[]" for a model to run on or a record to be made of.
    expect(getPrimaryOutput(result.output, "collection-read", "json")).toBeUndefined()
  })

  it("the job-row reader and the executor agree on the output shape", () => {
    const output = buildNodeOutputFromJobData(mocks.row.output_data as Record<string, unknown>, "collection-read")
    expect(output.json).toEqual(records)
    expect(output.text).toBe(digest)
    expect(getPrimaryOutput(output, "collection-read", "json")).toBe(JSON.stringify(records))
  })
})
