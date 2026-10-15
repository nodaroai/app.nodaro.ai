/**
 * `resolveUserDirection` — the ONE step that turns `direction.colorLook:
 * "palette:<id>"` / `direction.style: "moodboard:<id>"` into what the
 * synchronous assembly folds (a clause per reference, a moodboard's images as
 * style references). Both lanes call it: the generate-image route and the
 * workflow engine (pinned by `user-direction-lanes.test.ts`).
 *
 * What must hold: a user-owned id is never silently ignored — malformed or
 * misplaced is a 400, not the caller's (or gone) is a 404 naming the key —
 * while the built-in catalog ids stay as tolerant as they are; a row is read
 * only among the given owners; nothing is read when nothing names one.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { argOf, has, type QueryResult, type RecordedQuery } from "./fake-supabase-query.js"

const db = vi.hoisted(() => ({
  log: [] as RecordedQuery[],
  respond: null as null | ((q: RecordedQuery) => QueryResult),
}))

vi.mock("../supabase.js", async () => {
  const { makeFakeFrom } = await import("./fake-supabase-query.js")
  return { supabase: { from: makeFakeFrom(db.log, (q) => db.respond!(q)) } }
})

import {
  hasUserDirectionRefs,
  resolveUserDirection,
  moodboardWarnings,
  type ResolvedUserDirection,
} from "../user-direction.js"
import { renderPaletteClause } from "@nodaro/prompts/prompt-builder"

const OWNER = "00000000-0000-4000-8000-000000000001"
const RUNNER = "00000000-0000-4000-8000-000000000002"
const PID = "0f9e8d7c-6b5a-4c3d-9e2f-1a2b3c4d5e6f"
const MID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d"
const PALETTE = `palette:${PID}`
const MOODBOARD = `moodboard:${MID}`

const PALETTE_ROW = { id: PID, name: "Harbour", colors: ["#0F4C5C", "#E3B23C"] }
const MOODBOARD_ROW = {
  id: MID,
  name: "Nordic calm",
  description: "Moody Nordic interiors,\nsoft daylight",
  images: [{ url: "https://cdn.test/a.png", caption: "linen" }, { url: "https://cdn.test/b.png" }],
}

beforeEach(() => {
  db.log.length = 0
  db.respond = (q) => {
    if (q.table === "color_palettes") return { data: PALETTE_ROW, error: null }
    if (q.table === "moodboards") return { data: MOODBOARD_ROW, error: null }
    return { data: null, error: null }
  }
})

describe("hasUserDirectionRefs", () => {
  it("spots a reference in a string or an array value, and nothing else", () => {
    expect(hasUserDirectionRefs({ colorLook: PALETTE })).toBe(true)
    expect(hasUserDirectionRefs({ style: [MOODBOARD] })).toBe(true)
    expect(hasUserDirectionRefs({ colorLook: "warm", style: ["anime"] })).toBe(false)
    expect(hasUserDirectionRefs(undefined)).toBe(false)
    expect(hasUserDirectionRefs(null)).toBe(false)
    expect(hasUserDirectionRefs("palette:x")).toBe(false)
    expect(hasUserDirectionRefs([PALETTE])).toBe(false)
  })
})

describe("resolveUserDirection — nothing to resolve", () => {
  it("answers nothing and reads nothing for catalog ids only", async () => {
    const out = await resolveUserDirection({ colorLook: "warm", style: "anime" }, [OWNER])
    expect(out).toEqual({ ok: true, value: undefined })
    expect(db.log).toHaveLength(0)
  })
})

describe("resolveUserDirection — a palette", () => {
  it("reads the palette among the given owners and renders its clause", async () => {
    const out = await resolveUserDirection({ colorLook: PALETTE, mood: "calm" }, [OWNER, RUNNER])
    expect(out.ok).toBe(true)
    const value = (out as { ok: true; value: ResolvedUserDirection }).value
    expect(value.refs.get(PALETTE)).toBe(renderPaletteClause(PALETTE_ROW.colors))
    expect(value.styleReferences).toEqual([])
    expect(value.moodboard).toBeUndefined()

    const [q] = db.log
    expect(q.table).toBe("color_palettes")
    expect(has(q, "eq", "id", PID)).toBe(true)
    expect(has(q, "in", "user_id", [OWNER, RUNNER])).toBe(true)
  })

  it("is a 404 naming the key when the palette is not among the owners' (or gone)", async () => {
    db.respond = () => ({ data: null, error: null })
    const out = await resolveUserDirection({ colorLook: PALETTE }, [OWNER])
    expect(out).toEqual({
      ok: false,
      refusal: expect.objectContaining({ status: 404, code: "direction_not_found", field: "direction.colorLook" }),
    })
    expect((out as { ok: false; refusal: { message: string } }).refusal.message).toContain(PID)
  })

  it("is a 404, not a 500, while the database has no palettes table", async () => {
    db.respond = () => ({ data: null, error: { code: "42P01", message: "missing" } })
    const out = await resolveUserDirection({ colorLook: PALETTE }, [OWNER])
    expect(out.ok).toBe(false)
    expect((out as { ok: false; refusal: { status: number } }).refusal.status).toBe(404)
  })

  it("throws any other database error for the caller to answer as a 500", async () => {
    db.respond = () => ({ data: null, error: { code: "57014", message: "timeout" } })
    await expect(resolveUserDirection({ colorLook: PALETTE }, [OWNER])).rejects.toBeTruthy()
  })

  it("dedupes the owners and refuses with no owner at all", async () => {
    await resolveUserDirection({ colorLook: PALETTE }, [OWNER, OWNER])
    expect(argOf(db.log[0], "in")).toEqual(["user_id", [OWNER]])
    db.log.length = 0
    const out = await resolveUserDirection({ colorLook: PALETTE }, [])
    expect(out.ok).toBe(false)
    expect(db.log).toHaveLength(0)
  })
})

describe("resolveUserDirection — a moodboard", () => {
  it("renders its description as a clause and hands its images on as style references", async () => {
    const out = await resolveUserDirection({ style: MOODBOARD }, [OWNER])
    const value = (out as { ok: true; value: ResolvedUserDirection }).value
    expect(value.refs.get(MOODBOARD)).toBe("Moody Nordic interiors, soft daylight")
    expect(value.styleReferences).toEqual([
      { url: "https://cdn.test/a.png", caption: "linen" },
      { url: "https://cdn.test/b.png" },
    ])
    expect(value.moodboard).toEqual({ id: MID, name: "Nordic calm" })
    const [q] = db.log
    expect(q.table).toBe("moodboards")
    expect(has(q, "in", "user_id", [OWNER])).toBe(true)
  })

  it("a moodboard without a description folds no clause but still sends its images", async () => {
    db.respond = () => ({ data: { ...MOODBOARD_ROW, description: null }, error: null })
    const value = ((await resolveUserDirection({ style: MOODBOARD }, [OWNER])) as { ok: true; value: ResolvedUserDirection }).value
    expect(value.refs.has(MOODBOARD)).toBe(false)
    expect(value.styleReferences).toHaveLength(2)
  })

  it("drops a stored image that is not an http(s) link", async () => {
    db.respond = () => ({ data: { ...MOODBOARD_ROW, images: [{ url: "javascript:alert(1)" }, { url: 7 }, { url: "https://cdn.test/ok.png" }] }, error: null })
    const value = ((await resolveUserDirection({ style: MOODBOARD }, [OWNER])) as { ok: true; value: ResolvedUserDirection }).value
    expect(value.styleReferences).toEqual([{ url: "https://cdn.test/ok.png" }])
  })

  it("resolves a palette and a moodboard together", async () => {
    const value = ((await resolveUserDirection({ colorLook: PALETTE, style: MOODBOARD }, [OWNER])) as { ok: true; value: ResolvedUserDirection }).value
    expect([...value.refs.keys()].sort()).toEqual([MOODBOARD, PALETTE].sort())
    expect(db.log.map((q) => q.table).sort()).toEqual(["color_palettes", "moodboards"])
  })
})

describe("resolveUserDirection — refused before any read", () => {
  it.each([
    ["a palette that is not a uuid", { colorLook: "palette:warm" }, "direction.colorLook"],
    ["an empty moodboard id", { style: "moodboard:" }, "direction.style"],
    ["a palette on the style key", { style: PALETTE }, "direction.style"],
    ["a moodboard on the colorLook key", { colorLook: MOODBOARD }, "direction.colorLook"],
    ["a palette on a key that takes none", { mood: PALETTE }, "direction.mood"],
    ["a palette beside another value", { colorLook: ["warm", PALETTE] }, "direction.colorLook"],
    ["a palette twice", { colorLook: [PALETTE, PALETTE] }, "direction.colorLook"],
  ])("%s is a 400 validation_error naming the key", async (_label, direction, field) => {
    const out = await resolveUserDirection(direction, [OWNER])
    expect(out).toEqual({ ok: false, refusal: expect.objectContaining({ status: 400, code: "validation_error", field }) })
    expect(db.log).toHaveLength(0)
  })

  it("a one-element array holding a reference is fine", async () => {
    const out = await resolveUserDirection({ colorLook: [PALETTE] }, [OWNER])
    expect(out.ok).toBe(true)
  })
})

describe("moodboardWarnings", () => {
  const resolved: ResolvedUserDirection = {
    refs: new Map(),
    styleReferences: [{ url: "https://cdn.test/a.png" }, { url: "https://cdn.test/b.png" }, { url: "https://cdn.test/c.png" }],
    moodboard: { id: MID, name: "Nordic calm" },
  }

  it("says nothing when every image went", () => {
    expect(moodboardWarnings(resolved, 3, "nano-banana-pro")).toEqual([])
    expect(moodboardWarnings(undefined, undefined, "nano-banana-pro")).toEqual([])
    expect(moodboardWarnings({ refs: new Map(), styleReferences: [] }, 0, "nano-banana-pro")).toEqual([])
  })

  it("names how many were left out, and why", () => {
    const [w] = moodboardWarnings(resolved, 1, "nano-banana-pro")
    expect(w.code).toBe("moodboard_images_not_sent")
    expect(w.message).toContain("2 of the 3 images")
    expect(w.message).toContain("Nordic calm")
    expect(w.message).toMatch(/reference images/)
  })

  it("says so plainly for a model that takes no reference images", () => {
    const [w] = moodboardWarnings(resolved, 0, "imagen4")
    expect(w.message).toContain("takes no reference images")
  })
})
