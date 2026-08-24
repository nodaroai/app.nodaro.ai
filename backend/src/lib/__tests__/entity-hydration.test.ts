/**
 * A node bound to an entity that has no picture on it.
 *
 * The browser hydrator only runs in a browser, only on load, and only for
 * `character`. Every other writer — the Copilot's `edit_workflow`, an MCP
 * client, a template import — produces a node carrying a `*DbId` and nothing
 * else. The run engine then reads `defaultAssetUrl || sourceImageUrl`, finds
 * neither, and SKIPS the reference without a word: the run succeeds, the
 * credits are spent, and the picture is of the wrong person.
 *
 * These tests pin the run-time fill, and — more importantly — pin WHOSE
 * entities it reads.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../supabase.js", () => ({ supabase: { from: vi.fn() } }))

import { supabase } from "../supabase.js"
import { hydrateEntityNodes } from "../entity-hydration.js"

const mockFrom = vi.mocked(supabase.from)

interface Recorded {
  table: string
  columns: string
  ids: string[]
  userId: string
  deletedAt: unknown
}

let queries: Recorded[] = []

/** Stand in for the PostgREST builder: record the filters, resolve at `.is()`. */
function stubRows(rowsByTable: Record<string, Record<string, unknown>[]>, fail?: "error" | "throw"): void {
  mockFrom.mockImplementation(((table: string) => {
    const rec: Recorded = { table, columns: "", ids: [], userId: "", deletedAt: undefined }
    queries.push(rec)
    const chain = {
      select(columns: string) {
        rec.columns = columns
        return chain
      },
      in(_column: string, ids: string[]) {
        rec.ids = ids
        return chain
      },
      eq(column: string, value: string) {
        if (column === "user_id") rec.userId = value
        return chain
      },
      is(_column: string, value: unknown) {
        rec.deletedAt = value
        if (fail === "throw") throw new Error("connection reset")
        if (fail === "error") return Promise.resolve({ data: null, error: { message: "f0000000-0000-4000-8000-0000000000fd" } })
        return Promise.resolve({ data: rowsByTable[table] ?? [], error: null })
      },
    }
    return chain
  }) as never)
}

const AMMA = {
  id: "c0000000-0000-4000-8000-000000000001",
  name: "Amma",
  description: "a botanist",
  source_image_url: "https://r2.example/amma.png",
  expressions: [{ name: "happy", url: "https://r2.example/amma-happy.png" }],
}

beforeEach(() => {
  queries = []
  mockFrom.mockReset()
})

describe("hydrateEntityNodes", () => {
  it("fills the picture onto a node that has only an id", async () => {
    stubRows({ characters: [AMMA] })
    const node = { type: "character", data: { characterDbId: "c0000000-0000-4000-8000-000000000001" } as Record<string, unknown> }

    await hydrateEntityNodes([node], "owner-1")

    expect(node.data.sourceImageUrl).toBe("https://r2.example/amma.png")
    expect(node.data.characterName).toBe("Amma")
    expect(node.data.description).toBe("a botanist")
    // The variant buckets matter as much as the portrait: a prompt that
    // @mentions "happy" resolves against these.
    expect(node.data.expressions).toEqual(AMMA.expressions)
  })

  it("reads the WORKFLOW OWNER's library, not the runner's", async () => {
    // A published app runs under whoever pressed play. Scoping to the runner
    // would strip the creator's characters out of their own app.
    stubRows({ characters: [AMMA] })

    await hydrateEntityNodes([{ type: "character", data: { characterDbId: "c0000000-0000-4000-8000-000000000001" } }], "creator-1")

    expect(queries).toHaveLength(1)
    expect(queries[0]!.userId).toBe("creator-1")
    expect(queries[0]!.deletedAt).toBeNull()
  })

  it("leaves an entity that is not the owner's exactly as it was", async () => {
    // A foreign id returns zero rows — same shape as a deleted or bogus one,
    // so there is nothing to distinguish and nothing to leak.
    stubRows({ characters: [] })
    const data: Record<string, unknown> = { characterDbId: "f0000000-0000-4000-8000-0000000000ff" }

    await hydrateEntityNodes([{ type: "character", data }], "owner-1")

    expect(data).toEqual({ characterDbId: "f0000000-0000-4000-8000-0000000000ff" })
  })

  it("never touches a node that already carries its media", async () => {
    stubRows({ characters: [AMMA] })
    const data: Record<string, unknown> = { characterDbId: "c0000000-0000-4000-8000-000000000001", sourceImageUrl: "https://r2.example/kept.png" }

    await hydrateEntityNodes([{ type: "character", data }], "owner-1")

    expect(queries).toHaveLength(0)
    expect(data.sourceImageUrl).toBe("https://r2.example/kept.png")
  })

  it("fills only what is missing — a renamed node keeps its name", async () => {
    stubRows({ characters: [AMMA] })
    const data: Record<string, unknown> = { characterDbId: "c0000000-0000-4000-8000-000000000001", characterName: "Amma (young)" }

    await hydrateEntityNodes([{ type: "character", data }], "owner-1")

    expect(data.characterName).toBe("Amma (young)")
    expect(data.sourceImageUrl).toBe("https://r2.example/amma.png")
  })

  it("queries once per KIND, never once per node", async () => {
    stubRows({
      characters: [AMMA, { id: "c0000000-0000-4000-8000-000000000002", name: "Jone", source_image_url: "https://r2.example/jone.png" }],
      objects: [{ id: "0b000000-0000-4000-8000-000000000001", name: "Kettle", source_image_url: "https://r2.example/kettle.png" }],
    })
    const nodes = [
      { type: "character", data: { characterDbId: "c0000000-0000-4000-8000-000000000001" } as Record<string, unknown> },
      { type: "character", data: { characterDbId: "c0000000-0000-4000-8000-000000000002" } as Record<string, unknown> },
      { type: "object", data: { objectDbId: "0b000000-0000-4000-8000-000000000001" } as Record<string, unknown> },
    ]

    await hydrateEntityNodes(nodes, "owner-1")

    expect(queries.map((q) => q.table).sort()).toEqual(["characters", "objects"])
    expect(queries.find((q) => q.table === "characters")!.ids.sort()).toEqual(["c0000000-0000-4000-8000-000000000001", "c0000000-0000-4000-8000-000000000002"])
    expect(nodes[1]!.data.characterName).toBe("Jone")
    expect(nodes[2]!.data.objectName).toBe("Kettle")
  })

  it("hydrates every node bound to the SAME entity", async () => {
    stubRows({ characters: [AMMA] })
    const a: Record<string, unknown> = { characterDbId: "c0000000-0000-4000-8000-000000000001" }
    const b: Record<string, unknown> = { characterDbId: "c0000000-0000-4000-8000-000000000001" }

    await hydrateEntityNodes([{ type: "character", data: a }, { type: "character", data: b }], "owner-1")

    expect(a.sourceImageUrl).toBe("https://r2.example/amma.png")
    expect(b.sourceImageUrl).toBe("https://r2.example/amma.png")
  })

  it("is best-effort: a failed lookup neither throws nor mutates, but SAYS so", async () => {
    // Swallowing is right and dangerous: this whole module exists because a
    // missing reference is invisible at run time, and a silent catch is the
    // same disease one layer up. A schema drift must reach a log.
    stubRows({}, "error")
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const data: Record<string, unknown> = { characterDbId: "c0000000-0000-4000-8000-000000000001" }

    await expect(hydrateEntityNodes([{ type: "character", data }], "owner-1")).resolves.toBeUndefined()
    expect(data).toEqual({ characterDbId: "c0000000-0000-4000-8000-000000000001" })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("f0000000-0000-4000-8000-0000000000fd"))
    warn.mockRestore()
  })

  it("swallows a thrown lookup too — a run without a reference beats no run", async () => {
    stubRows({}, "throw")
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    await expect(
      hydrateEntityNodes([{ type: "character", data: { characterDbId: "c0000000-0000-4000-8000-000000000001" } }], "owner-1"),
    ).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("connection reset"))
    warn.mockRestore()
  })

  it("one bad id does not take the whole kind down with it", async () => {
    // Every `*DbId` goes into ONE `.in("id", …)` per kind, against a uuid
    // column. A single non-uuid value makes Postgres reject the whole query,
    // the catch swallows it, and EVERY character in the graph silently stays
    // unhydrated — the exact failure this module exists to prevent, triggered
    // by one node a model typed a name into.
    stubRows({ characters: [AMMA] })
    const good: Record<string, unknown> = { characterDbId: "c0000000-0000-4000-8000-000000000001" }
    const bad: Record<string, unknown> = { characterDbId: "amma" }

    await hydrateEntityNodes(
      [{ type: "character", data: good }, { type: "character", data: bad }],
      "owner-1",
    )

    expect(good.sourceImageUrl).toBe("https://r2.example/amma.png")
    expect(queries[0]!.ids).toEqual(["c0000000-0000-4000-8000-000000000001"])
  })

  it("asks nothing at all when every id is malformed", async () => {
    stubRows({ characters: [AMMA] })

    await hydrateEntityNodes([{ type: "character", data: { characterDbId: "amma" } }], "owner-1")

    expect(queries).toHaveLength(0)
  })

  it("does nothing without an owner", async () => {
    stubRows({ characters: [AMMA] })

    await hydrateEntityNodes([{ type: "character", data: { characterDbId: "c0000000-0000-4000-8000-000000000001" } }], "")

    expect(queries).toHaveLength(0)
  })

  it("ignores nodes that are not entities and entity nodes with no id", async () => {
    stubRows({ characters: [AMMA] })

    await hydrateEntityNodes(
      [
        { type: "generate-image", data: { characterDbId: "c0000000-0000-4000-8000-000000000001" } },
        { type: "character", data: {} },
        { type: "character", data: { characterDbId: "" } },
      ],
      "owner-1",
    )

    expect(queries).toHaveLength(0)
  })
})
