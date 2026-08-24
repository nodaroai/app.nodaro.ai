/**
 * Binding a node to somebody else's character.
 *
 * A made-up or copied `*DbId` is the mistake this system used to absorb in
 * complete silence: the write succeeds, the owner-scoped hydrator finds no row,
 * the run engine skips the reference, and the user pays for a finished picture
 * of the wrong person. Rejecting at write time is what turns that into
 * something the model can still fix in the same turn.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))

import { supabase } from "../../../lib/supabase.js"
import { assertEntitiesAreTheirs } from "../tools/entity-ownership.js"
import { EditRejected } from "../tools/edit-rejected.js"

const mockFrom = vi.mocked(supabase.from)

interface Recorded {
  table: string
  ids: string[]
  userId: string
  deletedAt: unknown
}

let queries: Recorded[] = []

// Entity ids are a uuid column. Fixtures that are not uuids describe a graph
// the database would reject, and would hide the malformed-id path entirely.
const A = "a0000000-0000-4000-8000-00000000000a"
const B = "a0000000-0000-4000-8000-00000000000b"
const C = "a0000000-0000-4000-8000-00000000000c"

function stubOwned(ownedByTable: Record<string, string[]>, fail?: "error" | "throw"): void {
  mockFrom.mockImplementation(((table: string) => {
    const rec: Recorded = { table, ids: [], userId: "", deletedAt: undefined }
    queries.push(rec)
    const chain = {
      select: () => chain,
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
        const owned = ownedByTable[table] ?? []
        return Promise.resolve({ data: rec.ids.filter((id) => owned.includes(id)).map((id) => ({ id })), error: null })
      },
    }
    return chain
  }) as never)
}

beforeEach(() => {
  queries = []
  mockFrom.mockReset()
})

describe("assertEntitiesAreTheirs", () => {
  it("lets through an id the user owns", async () => {
    stubOwned({ characters: ["c0000000-0000-4000-8000-000000000001"] })

    await expect(
      assertEntitiesAreTheirs([{ type: "character", data: { characterDbId: "c0000000-0000-4000-8000-000000000001" } }], "owner-1"),
    ).resolves.toBeUndefined()

    expect(queries[0]!.userId).toBe("owner-1")
    expect(queries[0]!.deletedAt).toBeNull()
  })

  it("rejects an id that is not theirs, and names the tool that would have found a real one", async () => {
    stubOwned({ characters: [] })

    await expect(
      assertEntitiesAreTheirs([{ type: "character", data: { characterDbId: "f0000000-0000-4000-8000-0000000000ff" } }], "owner-1"),
    ).rejects.toBeInstanceOf(EditRejected)

    await expect(
      assertEntitiesAreTheirs([{ type: "character", data: { characterDbId: "f0000000-0000-4000-8000-0000000000ff" } }], "owner-1"),
    ).rejects.toThrow(/list_characters/)
  })

  it("checks a PATCH too, which carries no node type", async () => {
    // A patch is `{id, data}` — the field name is the only thing that says
    // which kind it is, which is exactly why the check keys off the field.
    stubOwned({ objects: [] })

    await expect(
      assertEntitiesAreTheirs([{ data: { objectDbId: "f0000000-0000-4000-8000-0000000000fe" } }], "owner-1"),
    ).rejects.toThrow(/list_objects/)
  })

  it("covers all four kinds", async () => {
    const FIELDS = {
      character: "characterDbId",
      object: "objectDbId",
      creature: "creatureDbId",
      location: "locationDbId",
    } as const
    for (const [kind, field] of Object.entries(FIELDS)) {
      queries = []
      stubOwned({})
      await expect(
        assertEntitiesAreTheirs([{ data: { [field]: "f0000000-0000-4000-8000-0000000000fd" } }], "owner-1"),
      ).rejects.toThrow(new RegExp(`list_${kind}s`))
    }
  })

  it("rejects an id that cannot be one at all, without asking the database", async () => {
    // The guard exists to catch INVENTED ids, and an invented one is far more
    // likely to be a name than a uuid. Sent to a uuid column it makes Postgres
    // error, which the fail-open path reads as "could not check" — so the one
    // value this was built to catch was the one that walked through.
    stubOwned({ characters: ["c0000000-0000-4000-8000-000000000001"] })

    await expect(
      assertEntitiesAreTheirs([{ type: "character", data: { characterDbId: "amma" } }], "owner-1"),
    ).rejects.toThrow(/list_characters/)
    expect(queries).toHaveLength(0)
  })

  it("still checks the well-formed ids alongside a malformed one", async () => {
    stubOwned({ characters: ["11111111-1111-4111-8111-111111111111"] })

    await expect(
      assertEntitiesAreTheirs(
        [
          { type: "character", data: { characterDbId: "11111111-1111-4111-8111-111111111111" } },
          { type: "character", data: { characterDbId: "amma" } },
        ],
        "owner-1",
      ),
    ).rejects.toThrow(/amma/)
  })

  it("queries once per kind, not once per node", async () => {
    stubOwned({ characters: [A, B], objects: [C] })

    await assertEntitiesAreTheirs(
      [
        { type: "character", data: { characterDbId: A } },
        { type: "character", data: { characterDbId: B } },
        { type: "object", data: { objectDbId: C } },
      ],
      "owner-1",
    )

    expect(queries).toHaveLength(2)
    expect(queries.find((q) => q.table === "characters")!.ids.sort()).toEqual([A, B].sort())
  })

  it("asks nothing when the call binds no entity", async () => {
    stubOwned({ characters: [] })

    await assertEntitiesAreTheirs(
      [{ type: "generate-image", data: { prompt: "a knight" } }, { type: "character", data: {} }],
      "owner-1",
    )

    expect(queries).toHaveLength(0)
  })

  it("lets the write through when the lookup itself fails", async () => {
    // This is a helpfulness guard, not the security boundary — every read is
    // owner-scoped either way. Blocking a real edit because a lookup flaked
    // would trade a silent wrong picture for a broken editor.
    stubOwned({}, "error")
    await expect(
      assertEntitiesAreTheirs([{ type: "character", data: { characterDbId: "c0000000-0000-4000-8000-000000000001" } }], "owner-1"),
    ).resolves.toBeUndefined()

    stubOwned({}, "throw")
    await expect(
      assertEntitiesAreTheirs([{ type: "character", data: { characterDbId: "c0000000-0000-4000-8000-000000000001" } }], "owner-1"),
    ).resolves.toBeUndefined()
  })
})
