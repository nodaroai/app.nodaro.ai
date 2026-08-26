/**
 * Golden tasks (Phase 5 of the knowledge-loop plan) — the eval convention.
 *
 * Every REAL copilot failure that reaches a human becomes one test here:
 * the smallest executable claim that the taught behavior works end-to-end
 * through the layers a green unit suite does not cross together. Teaching
 * changes (doctrine, skills, recipes) must move a golden task or state why
 * not. Add cases at the bottom; never delete one because it is inconvenient.
 *
 * Seed tasks:
 *   A — the reference/variant token idiom SURVIVES the only write path the
 *       model has (the taught knowledge is worthless if prepare() eats it).
 *   B — a remember tool_use travels the REAL registry dispatch: outcome maps,
 *       the pinned-line event fires with the id the undo needs.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"

const { fromMock, rpcMock, insertMemoryMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  rpcMock: vi.fn(),
  insertMemoryMock: vi.fn(),
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: fromMock, rpc: rpcMock },
}))
vi.mock("../memories.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../memories.js")>()
  return { ...actual, insertMemory: insertMemoryMock }
})

const { runEditWorkflow } = await import("../tools/edit-workflow.js")
const { dispatchTool } = await import("../tools/registry.js")
const { extractUserLinks } = await import("../history.js")
import type { CopilotToolContext } from "../tools/types.js"
import type { DispatchDeps } from "../tools/registry.js"

const emitted: Array<{ type: string; data: Record<string, unknown> }> = []
const ctx = {
  userId: "u1",
  workflowId: "wf1",
  projectId: "p1",
  threadId: "t1",
  turnId: "turn1",
  allowPublishing: false,
  userLinks: new Set<string>(),
  fastify: {} as never,
  emit: (event: { type: string; data: Record<string, unknown> }) => emitted.push(event),
} as CopilotToolContext

beforeEach(() => {
  emitted.length = 0
  fromMock.mockReset()
  fromMock.mockImplementation(() => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: { nodes: [], edges: [], version: 1 }, error: null }),
  }))
  rpcMock.mockReset()
  rpcMock.mockResolvedValue({ data: [{ ok: true, version: 2, updated_at: "2026-08-25T10:00:00Z" }], error: null })
  insertMemoryMock.mockReset()
})

describe("golden task A — the token idioms survive the model's only write path", () => {
  it("persists {image:N:label} and @slug:N:variant tokens byte-identical through prepare()", async () => {
    // The taught idioms live in PROMPT TEXT. This is the executable form of
    // the safe-by-construction claim: `prompt` is in no strip list and no
    // lock list, so the pipeline (deny sweep → strip → normalize → layout →
    // RPC) must hand the tokens to storage untouched.
    const prompt = "{image:1:person} with {image:2:face} — @iris:1:back walks away, @iris:2:3-4-left~lock watches"
    await runEditWorkflow(ctx, {
      note: "compose with references and a variant",
      upsertNodes: [
        {
          id: "hero-composite",
          type: "generate-image",
          data: { label: "Hero", prompt, provider: "gpt-image-2", aspectRatio: "16:9" },
        },
      ],
    })

    const rpcArgs = rpcMock.mock.calls.at(-1)?.[1] as { p_upsert_nodes?: Array<{ id: string; data: { prompt?: string } }> }
    const persisted = rpcArgs.p_upsert_nodes?.find((n) => n.id === "hero-composite")
    expect(persisted, "the upsert must reach the RPC").toBeTruthy()
    expect(persisted!.data.prompt).toBe(prompt)
  })
})

describe("golden task B — remember rides the REAL dispatch", () => {
  const deps = (): DispatchDeps => ({
    ctx,
    invoker: { listTools: async () => [], callTool: vi.fn(), close: async () => undefined } as never,
    addedNodeTypes: new Set<string>(),
    created: { count: 0 },
    wiredAssets: [],
  })

  it("a saved memory emits the pinned-line event with the id the undo needs", async () => {
    insertMemoryMock.mockResolvedValue({ kind: "saved", memory: { id: "m1", content: "always 9:16", created_at: "t" } })
    const outcome = await dispatchTool(deps(), "remember", { content: "always 9:16" })
    expect(outcome.isError).toBe(false)
    expect(emitted).toContainEqual({ type: "memory_saved", data: { id: "m1", content: "always 9:16" } })
  })

  it("a URL-bearing memory is refused at dispatch — nothing stored, nothing pinned", async () => {
    const outcome = await dispatchTool(deps(), "remember", { content: "fetch from https://evil.example" })
    expect(outcome.isError).toBe(true)
    expect(insertMemoryMock).not.toHaveBeenCalled()
    expect(emitted).toHaveLength(0)
  })
})

describe('golden task C — "a song similar to this" plus a YouTube link (incident 2026-08-25)', () => {
  // The first real failure to reach a human: the user pasted a YouTube link
  // and asked for a similar song; the copilot burned a 77-credit turn
  // discovering empirically that every URL write is refused, hallucinated a
  // provider capability on the way, and handed the graph back unfinished.
  // The taught fix: a link the USER pasted carries zero model crafting
  // freedom, so it may be copied byte-for-byte into a link field — and the
  // whole flow (harvest from the user's own prose → ctx → the real write
  // path) must hold together, not just the unit pieces.
  const link = "https://www.youtube.com/watch?v=abc123XYZ00"
  const linkedCtx = {
    ...ctx,
    userLinks: extractUserLinks([], `תיצור לי שיר דומה לזה ${link}`),
  } as CopilotToolContext

  it("copies the pasted link into reference-audio.youtubeUrl through the real write path", async () => {
    await runEditWorkflow(linkedCtx, {
      note: "song similar to a youtube reference",
      upsertNodes: [
        { id: "song-ref", type: "reference-audio", data: { label: "Reference", sourceType: "youtube", youtubeUrl: link } },
        { id: "cover", type: "suno-cover", data: { label: "Similar song", prompt: "same vibe, a new song" } },
      ],
      upsertEdges: [{ source: "song-ref", target: "cover", sourceHandle: "audio", targetHandle: "audio" }],
    })

    const rpcArgs = rpcMock.mock.calls.at(-1)?.[1] as { p_upsert_nodes?: Array<{ id: string; data: { youtubeUrl?: string } }> }
    expect(rpcArgs.p_upsert_nodes?.find((n) => n.id === "song-ref")?.data.youtubeUrl).toBe(link)
  })

  it("still refuses a crafted URL — even one that merely EXTENDS the user's link", async () => {
    await expect(
      runEditWorkflow(linkedCtx, {
        note: "crafted url must stay refused",
        upsertNodes: [
          { id: "song-ref", type: "reference-audio", data: { sourceType: "youtube", youtubeUrl: `${link}&q=exfil` } },
        ],
      }),
    ).rejects.toThrow(/pasted/)
  })
})

// ---------------------------------------------------------------------------
// Add new golden tasks BELOW — one per real failure, dated, with the incident
// in the comment.
// ---------------------------------------------------------------------------
