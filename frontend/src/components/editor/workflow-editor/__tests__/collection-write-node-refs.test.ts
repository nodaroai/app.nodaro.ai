/**
 * Save to Collection on the canvas: a `{Node}` reference typed into one of its
 * four fields (title, text, link, duplicate key) resolves to that node's
 * output; a value a field mapping wrote is upstream data and is sent as is
 * (#1890). Mirror of the server's collection-nodes-dag cases.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "@testing-library/react"

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }) }))
vi.mock("@/lib/supabase", () => ({ createClient: () => ({}) }))

const saved = vi.hoisted(() => ({
  jobId: "c0ffee00-0000-4000-8000-0000000000c2",
  record: {
    id: "r1", collectionId: "c1", userId: "u1", dedupeKey: null, idempotencyKey: null, title: "t", text: "", url: null,
    media: [], fields: {}, source: { via: "node" as const }, createdAt: "2026-10-06T08:00:00.000Z",
  },
  outcome: "inserted" as const,
  evicted: 0,
  collection: { id: "c1", name: "articles" },
}))
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  collectionWriteApi: vi.fn(() => Promise.resolve(saved)),
}))
/** What the node's wires hand it (the resolver is not what is under test). */
vi.mock("../node-input-resolver", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../node-input-resolver")>()),
  resolveNodeInputs: vi.fn(() => ({ prompt: "the item" })),
}))

import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { collectionWriteApi } from "@/lib/api"
import { executeNode } from "../execute-node"

const SAVE = "save"
const feed = (text: string): WorkflowNode =>
  ({ id: "feed", type: "text-prompt", position: { x: 0, y: 0 }, data: { label: "Feed", text } }) as unknown as WorkflowNode
const save = (data: Record<string, unknown>): WorkflowNode =>
  ({ id: SAVE, type: "collection-write", position: { x: 0, y: 0 }, data: { label: "Save", collectionId: "c1", ...data } }) as unknown as WorkflowNode
const EDGES: WorkflowEdge[] = [{ id: "e-in", source: "feed", target: SAVE, sourceHandle: "text", targetHandle: "in" } as WorkflowEdge]

function makeCtx() {
  return {
    userId: "u1",
    projectId: "p1",
    trackInterval: (i: unknown) => i,
    untrackInterval: (i: unknown) => clearInterval(i as ReturnType<typeof setInterval>),
    save: vi.fn(),
    setIsRunning: vi.fn(),
    isWorkflowStale: () => false,
    isStorageError: () => false,
    setShowStorageExceeded: vi.fn(),
    setStorageExceededData: vi.fn(),
    setShowInsufficientCredits: vi.fn(),
  } as never
}

/** The body the canvas run sent to the route. */
async function sent(nodes: WorkflowNode[], edges: WorkflowEdge[] = EDGES): Promise<Record<string, unknown>> {
  act(() => useWorkflowStore.setState({ nodes, edges }))
  await executeNode(useWorkflowStore.getState().nodes.find((n) => n.id === SAVE)!, makeCtx())
  const calls = (collectionWriteApi as ReturnType<typeof vi.fn>).mock.calls
  return calls[calls.length - 1]![0] as Record<string, unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
  act(() => useWorkflowStore.setState({ nodes: [], edges: [], isDirty: false, isReadOnly: false }))
})
afterEach(() => {
  act(() => useWorkflowStore.setState({ nodes: [], edges: [] }))
})

describe("Save to Collection resolves {Node} references typed into its fields (#1890)", () => {
  it("title, text, link and duplicate key each resolve to the referenced node's output", async () => {
    const slug = { id: "slug", type: "text-prompt", position: { x: 0, y: 0 }, data: { label: "Slug", text: "telegram-turns-ten" } } as unknown as WorkflowNode
    const body = await sent(
      [feed("Telegram turns ten"), slug, save({ title: "Breaking: {Feed}", text: "{Feed}", link: "https://news.example.test/{Slug}", dedupeKey: "key-{Slug}" })],
      [...EDGES, { id: "e-slug", source: "slug", target: SAVE, sourceHandle: "text", targetHandle: "in" } as WorkflowEdge],
    )
    expect(body).toMatchObject({
      title: "Breaking: Telegram turns ten",
      text: "Telegram turns ten",
      link: "https://news.example.test/telegram-turns-ten",
      dedupeKey: "key-telegram-turns-ten",
    })
  })

  it("a resolved value is held to the route's limits: title / text / key cut to whole characters, an over-long link not sent", async () => {
    const body = await sent([
      feed("x".repeat(2_100)),
      save({ title: "{Feed}", text: "{Feed}", link: "https://news.example.test/{Feed}", dedupeKey: "{Feed}" }),
    ])
    expect((body.title as string).length).toBe(500)
    expect((body.text as string).length).toBe(2_100)
    expect((body.dedupeKey as string).length).toBe(300)
    expect(body.link).toBeUndefined()
  })

  it("{name || fallback} gives the fallback when the node produced nothing; an unknown name is sent as typed", async () => {
    const body = await sent([feed(""), save({ title: "{Feed || untitled}", text: "{Nobody} stays" })])
    expect(body.title).toBe("untitled")
    expect(body.text).toBe("{Nobody} stays")
  })

  it("a field a mapping wrote is upstream data: its braces are sent untouched", async () => {
    const body = await sent([
      feed('{"Feed":1} and {Feed}'),
      save({ title: "", fieldMappings: { title: { sourceNodeId: "feed" } } }),
    ])
    expect(body.title).toBe('{"Feed":1} and {Feed}')
  })
})
