/**
 * Handing the model a file.
 *
 * The model never writes an address — the egress lock refuses that, and the
 * refusal is the whole boundary. It writes `data.assetId`, the field the upload
 * nodes already have, and the server fills in the rest. Before this, an
 * `assetId` written by an agent was persisted, read by nobody, and the node sat
 * empty: the same silence PR 1 spent itself repairing.
 *
 * The acceptance line for this work was "the destination lock and its tests are
 * unchanged" — so these live beside `edit-workflow.test.ts`, not inside it.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"

const { fromMock, rpcMock, graphState, dbState } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  rpcMock: vi.fn(),
  graphState: { nodes: [] as unknown[], edges: [] as unknown[], version: 1 },
  dbState: {
    jobs: [] as Array<{ id: string; output_data: Record<string, unknown> }>,
    assets: [] as Array<Record<string, unknown>>,
    /** Every table a call touched, so a test can prove a lookup did NOT happen. */
    touched: [] as string[],
  },
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: fromMock, rpc: rpcMock } }))

const { runEditWorkflow, EditRejected } = await import("../tools/edit-workflow.js")
import type { CopilotToolContext } from "../tools/types.js"

const ctx = {
  // A session user id is a uuid off a verified JWT, never a short name —
  // fixtures that pretend otherwise describe a caller that cannot exist.
  userId: "aaaaaaaa-0000-4000-8000-000000000001",
  workflowId: "wf1",
  projectId: "p1",
  threadId: "t1",
  turnId: "turn1",
  allowPublishing: false,
  userLinks: new Set<string>(),
  fastify: {} as never,
  emit: () => undefined,
} as CopilotToolContext

const IMAGE_ID = "11111111-1111-4111-8111-111111111111"
const VIDEO_ID = "22222222-2222-4222-8222-222222222222"
const OTHER_ID = "33333333-3333-4333-8333-333333333333"

function tableChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {}
  for (const method of ["select", "in", "eq", "or", "is"]) {
    chain[method] = vi.fn(() => chain)
  }
  // Thenable at any point, like a PostgREST builder.
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve)
  return chain
}

function graphChain() {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: { nodes: graphState.nodes, edges: graphState.edges, version: graphState.version },
      error: null,
    }),
  }
}

beforeEach(() => {
  graphState.nodes = []
  graphState.edges = []
  graphState.version = 1
  dbState.jobs = []
  dbState.assets = []
  dbState.touched = []
  fromMock.mockReset()
  fromMock.mockImplementation((table: string) => {
    dbState.touched.push(table)
    if (table === "jobs") return tableChain(dbState.jobs)
    if (table === "assets") return tableChain(dbState.assets)
    return graphChain()
  })
  rpcMock.mockReset()
  rpcMock.mockResolvedValue({ data: [{ ok: true, version: 2, updated_at: "2026-08-23T10:00:00Z" }], error: null })
})

/** What the RPC was actually asked to persist. */
function persistedNodes(): Array<{ id: string; type: string; data: Record<string, unknown> }> {
  return rpcMock.mock.calls.at(-1)![1].p_upsert_nodes
}

describe("wiring a file onto a node", () => {
  it("fills in everything that follows from the id", async () => {
    dbState.assets = [
      {
        id: IMAGE_ID,
        type: "image",
        r2_url: "https://r2.example/cat.png",
        filename: "cat.png",
        mime_type: "image/png",
        size_bytes: 4096,
        metadata: { thumbnailUrl: "https://r2.example/cat-thumb.png" },
      },
    ]

    await runEditWorkflow(ctx, {
      note: "use their cat",
      upsertNodes: [{ id: "up1", type: "upload-image", data: { assetId: IMAGE_ID } }],
    })

    const data = persistedNodes()[0]!.data
    // The run engine reads `url`; the canvas reads `url` and `r2Url`. Both, or
    // the node works in one place and not the other.
    expect(data.url).toBe("https://r2.example/cat.png")
    expect(data.r2Url).toBe("https://r2.example/cat.png")
    expect(data.filename).toBe("cat.png")
    expect(data.mimeType).toBe("image/png")
    expect(data.fileSize).toBe(4096)
    expect(data.thumbnailUrl).toBe("https://r2.example/cat-thumb.png")
    expect(data.assetId).toBe(IMAGE_ID)
  })

  it("wires a generation the user already made, not only an upload", async () => {
    dbState.jobs = [{ id: IMAGE_ID, output_data: { imageUrl: "https://r2.example/made.png" } }]

    await runEditWorkflow(ctx, {
      note: "reuse it",
      upsertNodes: [{ id: "up1", type: "upload-image", data: { assetId: IMAGE_ID } }],
    })

    expect(persistedNodes()[0]!.data.url).toBe("https://r2.example/made.png")
  })

  it("replaces the WHOLE copy when the file changes, never just the address", async () => {
    // A node keeps the name, size and type of what it points at. Stamping a new
    // url over an old filename produces a node that says one thing and does
    // another — and that mismatch is exactly the bug class PR 1 closed.
    graphState.nodes = [
      {
        id: "up1",
        type: "upload-image",
        data: {
          assetId: OTHER_ID,
          url: "https://r2.example/old.png",
          r2Url: "https://r2.example/old.png",
          filename: "old.png",
          mimeType: "image/gif",
          fileSize: 999,
          externalUrl: "https://elsewhere.example/old.png",
        },
      },
    ]
    dbState.assets = [
      { id: IMAGE_ID, type: "image", r2_url: "https://r2.example/new.png", filename: "new.png", mime_type: "image/png", size_bytes: 10, metadata: {} },
    ]

    await runEditWorkflow(ctx, {
      note: "point it at the new one",
      patchNodes: [{ id: "up1", data: { assetId: IMAGE_ID } }],
    })

    const data = persistedNodes()[0]!.data
    expect(data.url).toBe("https://r2.example/new.png")
    expect(data.filename).toBe("new.png")
    expect(data.mimeType).toBe("image/png")
    expect(data.fileSize).toBe(10)
    // A file the user picked is theirs; the old external provenance must not
    // survive being pointed somewhere else.
    expect(data.externalUrl).toBe("")
  })

  it("says the same thing whether the file is someone else's or does not exist", async () => {
    // Three messages would let a model tell those apart, which turns a tool it
    // may call into a way to ask whether an id exists.
    const foreign = runEditWorkflow(ctx, {
      note: "x",
      upsertNodes: [{ id: "up1", type: "upload-image", data: { assetId: IMAGE_ID } }],
    })
    await expect(foreign).rejects.toBeInstanceOf(EditRejected)
    await expect(
      runEditWorkflow(ctx, { note: "x", upsertNodes: [{ id: "up1", type: "upload-image", data: { assetId: IMAGE_ID } }] }),
    ).rejects.toThrow(/not a file in this user's library/)
  })

  it("treats a job that is still running as a miss, not a url", async () => {
    dbState.jobs = [{ id: IMAGE_ID, output_data: {} }]

    await expect(
      runEditWorkflow(ctx, { note: "x", upsertNodes: [{ id: "up1", type: "upload-image", data: { assetId: IMAGE_ID } }] }),
    ).rejects.toThrow(/not a file in this user's library/)
  })

  it("refuses a file of the wrong sort, and names where it belongs", async () => {
    dbState.assets = [
      { id: VIDEO_ID, type: "video", r2_url: "https://r2.example/clip.mp4", filename: "clip.mp4", mime_type: "video/mp4", size_bytes: 1, metadata: {} },
    ]

    await expect(
      runEditWorkflow(ctx, { note: "x", upsertNodes: [{ id: "up1", type: "upload-image", data: { assetId: VIDEO_ID } }] }),
    ).rejects.toThrow(/belongs on a "upload-video" node/)
  })

  it("refuses a file on a node that does not take one", async () => {
    await expect(
      runEditWorkflow(ctx, {
        note: "x",
        upsertNodes: [{ id: "gen", type: "generate-image", data: { prompt: "a cat", assetId: IMAGE_ID } }],
      }),
    ).rejects.toThrow(/does not take a file/)
  })

  it("never asks the database about an id that could not be one", async () => {
    // Entity and asset ids are a uuid column: one malformed value rejects the
    // whole batch, taking every well-formed id in the same call with it.
    await expect(
      runEditWorkflow(ctx, { note: "x", upsertNodes: [{ id: "up1", type: "upload-image", data: { assetId: "the cat one" } }] }),
    ).rejects.toThrow(/not a file in this user's library/)
    expect(dbState.touched).not.toContain("assets")
    expect(dbState.touched).not.toContain("jobs")
  })

  it("does not re-resolve an id the node already had", async () => {
    // An upsert that echoes a whole node re-sends the id it already carried.
    // Re-resolving would cost a lookup per echo and would fail the edit outright
    // once the asset is deleted — punishing the model for repeating the truth.
    graphState.nodes = [
      { id: "up1", type: "upload-image", data: { assetId: IMAGE_ID, url: "https://r2.example/cat.png" } },
    ]

    await runEditWorkflow(ctx, {
      note: "just moving it",
      upsertNodes: [{ id: "up1", type: "upload-image", data: { assetId: IMAGE_ID, url: "https://r2.example/cat.png", label: "The cat" } }],
    })

    expect(dbState.touched).not.toContain("assets")
    expect(persistedNodes()[0]!.data.label).toBe("The cat")
  })

  it("refuses a file id it invented its own syntax for", async () => {
    // A model that reaches for `{"$asset": …}` would otherwise have it
    // persisted, read by nobody, and the node would sit empty with no error.
    await expect(
      runEditWorkflow(ctx, {
        note: "x",
        upsertNodes: [{ id: "up1", type: "upload-image", data: { url: { $asset: IMAGE_ID } } }],
      }),
    ).rejects.toThrow(/set "assetId" to its id/)
  })

  it("still refuses a plain address, exactly as before", async () => {
    await expect(
      runEditWorkflow(ctx, {
        note: "x",
        upsertNodes: [{ id: "up1", type: "upload-image", data: { url: "https://evil.example/x.png" } }],
      }),
    ).rejects.toThrow(/only when the user pasted that exact link/)
  })

  it("refuses to wire more files than one edit should", async () => {
    const many = Array.from({ length: 21 }, (_, i) => ({
      id: `up${i}`,
      type: "upload-image",
      data: { assetId: `1111111${String(i).padStart(2, "0")}-1111-4111-8111-111111111111` },
    }))

    await expect(runEditWorkflow(ctx, { note: "x", upsertNodes: many })).rejects.toThrow(/is the limit for one edit/)
  })
})

describe("a node's own results survive being edited", () => {
  // The RPC replaces a node WHOLE, and a patch merges the stored data first —
  // so a completed node's results travel back through the write on any edit.
  // Stripping them then DELETES them: the user watches finished images vanish
  // from a node the copilot only renamed.
  const RESULTS = [{ url: "https://r2.example/done.png" }]

  it("keeps results the model did not touch", async () => {
    graphState.nodes = [
      { id: "gen", type: "generate-image", data: { prompt: "a cat", generatedResults: RESULTS, activeResultIndex: 0 } },
    ]

    await runEditWorkflow(ctx, { note: "rename it", patchNodes: [{ id: "gen", data: { label: "The cat" } }] })

    const data = persistedNodes()[0]!.data
    expect(data.generatedResults).toEqual(RESULTS)
    expect(data.label).toBe("The cat")
  })

  it("strips an execution value the model INVENTED", async () => {
    // Anything URL-shaped never gets this far — the egress lock refuses it one
    // step earlier (see below). What the strip still owns is the rest of the
    // execution surface: a model that could write `generatedText` could fake a
    // finished node and feed a downstream one whatever it liked.
    graphState.nodes = [{ id: "gen", type: "generate-script", data: { prompt: "a cat" } }]

    await runEditWorkflow(ctx, {
      note: "x",
      patchNodes: [{ id: "gen", data: { generatedText: "words the model made up" } }],
    })

    expect(persistedNodes()[0]!.data.generatedText).toBeUndefined()
  })

  it("strips a CHANGED execution value even when the node had one", async () => {
    graphState.nodes = [
      { id: "gen", type: "generate-script", data: { prompt: "a cat", generatedText: "the real script" } },
    ]

    await runEditWorkflow(ctx, {
      note: "x",
      patchNodes: [{ id: "gen", data: { generatedText: "a different script" } }],
    })

    expect(persistedNodes()[0]!.data.generatedText).toBeUndefined()
  })

  it("keeps a non-URL execution value the model echoed back unchanged", async () => {
    graphState.nodes = [
      { id: "gen", type: "generate-script", data: { prompt: "a cat", generatedText: "the real script" } },
    ]

    await runEditWorkflow(ctx, {
      note: "x",
      upsertNodes: [{ id: "gen", type: "generate-script", data: { prompt: "a dog", generatedText: "the real script" } }],
    })

    const data = persistedNodes()[0]!.data
    expect(data.generatedText).toBe("the real script")
    expect(data.prompt).toBe("a dog")
  })

  it("a URL-shaped forgery is refused outright, one step before the strip", async () => {
    // The two guards overlap and the lock is the stronger: it REJECTS rather
    // than silently dropping, so the model is told instead of wondering why its
    // write did nothing. Pinned so nobody "simplifies" the strip into owning
    // this and turns a refusal back into a silence.
    graphState.nodes = [{ id: "gen", type: "generate-image", data: { prompt: "a cat" } }]

    await expect(
      runEditWorkflow(ctx, {
        note: "x",
        patchNodes: [{ id: "gen", data: { generatedImageUrl: "https://evil.example/fake.png" } }],
      }),
    ).rejects.toThrow(/can't change generatedImageUrl/)
  })
})

describe("a file's fields are configuration, not execution state", () => {
  it("no field the stamp writes is treated as runtime data", async () => {
    // The stamp lands after the strip, so this is not about the stamp being
    // erased — it is about the OTHER direction. Move any of these into the
    // runtime sets and every edit of an upload node drops the user's own file
    // from the row, which reads exactly like the file was never there.
    const { EXECUTION_DATA_KEYS, TRANSIENT_RUNTIME_KEYS } = await import("@nodaro/shared")
    const { assetStamp } = await import("../tools/asset-slots.js")
    const written = Object.keys(
      assetStamp({ id: "a", kind: "image", url: "u", filename: "f", mimeType: "m", fileSize: 1, thumbnailUrl: "t" }),
    )
    expect(written).toContain("url")
    expect(written).toContain("r2Url")
    for (const key of written) {
      expect(EXECUTION_DATA_KEYS.has(key), `${key} is in EXECUTION_DATA_KEYS`).toBe(false)
      expect(TRANSIENT_RUNTIME_KEYS.has(key), `${key} is in TRANSIENT_RUNTIME_KEYS`).toBe(false)
    }
  })
})

describe("the run card names the files that were wired", () => {
  it("carries the filename, not a count", async () => {
    // Approving a run is the moment the user agrees to spend credits on THIS
    // graph. A file they cannot see was wired in is a thing they did not
    // actually approve, and "1 file attached" does not tell them which.
    dbState.assets = [
      { id: IMAGE_ID, type: "image", r2_url: "https://r2.example/cat.png", filename: "cat.png", mime_type: "image/png", size_bytes: 1, metadata: {} },
    ]

    const result = await runEditWorkflow(ctx, {
      note: "use their cat",
      upsertNodes: [{ id: "up1", type: "upload-image", data: { assetId: IMAGE_ID } }],
    })

    expect(result.wiredAssets).toEqual([
      { id: IMAGE_ID, kind: "image", filename: "cat.png", nodeId: "up1" },
    ])
  })

  it("reports nothing when the edit wired nothing", async () => {
    const result = await runEditWorkflow(ctx, {
      note: "just a prompt",
      upsertNodes: [{ id: "t1", type: "text-prompt", data: { prompt: "a cat" } }],
    })

    expect(result.wiredAssets).toEqual([])
  })
})

describe("an edit that is not about the file leaves the file alone", () => {
  it("keeps the media when an UPSERT echoes the same assetId", async () => {
    // The doctrine tells the model to write `assetId` and leave every other
    // field alone. An upsert replaces the node WHOLE — so a model doing exactly
    // what it was told, on a node that already has the file, would erase the
    // very thing it was pointing at.
    graphState.nodes = [
      {
        id: "up1",
        type: "upload-image",
        data: {
          assetId: IMAGE_ID,
          url: "https://r2.example/cat.png",
          r2Url: "https://r2.example/cat.png",
          filename: "cat.png",
          mimeType: "image/png",
          fileSize: 4096,
        },
      },
    ]

    await runEditWorkflow(ctx, {
      note: "rename it",
      upsertNodes: [{ id: "up1", type: "upload-image", data: { assetId: IMAGE_ID, label: "The cat" } }],
    })

    const data = persistedNodes()[0]!.data
    expect(data.url).toBe("https://r2.example/cat.png")
    expect(data.filename).toBe("cat.png")
    expect(data.label).toBe("The cat")
    // And it cost nothing to know that — the id did not change.
    expect(dbState.touched).not.toContain("assets")
  })

  it("does not resurrect media onto a node whose file was cleared", async () => {
    // Carrying the stored copy forward must follow the ID. A user who cleared
    // the node has no assetId on it, and nothing should come back.
    graphState.nodes = [{ id: "up1", type: "upload-image", data: { assetId: "", url: "", filename: "" } }]

    await runEditWorkflow(ctx, {
      note: "label it",
      upsertNodes: [{ id: "up1", type: "upload-image", data: { label: "Empty" } }],
    })

    const data = persistedNodes()[0]!.data
    expect(data.url).toBeUndefined()
    expect(data.assetId).toBeUndefined()
  })
})
