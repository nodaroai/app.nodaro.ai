import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud" },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

import type { CollectionRecord } from "@nodaro/shared"
import { supabase } from "../supabase.js"
import { enrichRecordSources, itemFromWire, prepareRecord, setRecordUsed, type SetUsedOutcome } from "../collections-store.js"

const fromMock = supabase.from as ReturnType<typeof vi.fn>

type Result = { data?: unknown; error?: { code?: string; message?: string } | null }

/** Chainable + thenable query-builder mock; `maybeSingle` / await resolve to `result`. */
function makeQB(result: Result = {}) {
  const resolved = { data: result.data ?? null, error: result.error ?? null, count: null }
  const qb: Record<string, unknown> = {}
  for (const name of ["select", "update", "eq", "in", "is", "not"]) qb[name] = vi.fn(() => qb)
  qb.maybeSingle = vi.fn(() => Promise.resolve({ data: resolved.data, error: resolved.error }))
  qb.then = (resolve: (v: unknown) => unknown) => resolve(resolved)
  return qb
}

const USER = "00000000-0000-4000-8000-000000000001"
const COLL = "00000000-0000-4000-8000-0000000000c1"
const WF = "00000000-0000-4000-8000-0000000000f1"
const WF2 = "00000000-0000-4000-8000-0000000000f2"
const PROJECT = "00000000-0000-4000-8000-0000000000a1"

function rec(id: string, overrides: Partial<CollectionRecord> = {}): CollectionRecord {
  return { id, collectionId: COLL, title: `Story ${id}`, text: "", url: null, media: [], fields: {}, dedupeKey: null, source: {}, createdAt: "2026-10-06T09:00:00Z", usedAt: null, usedBy: {}, ...overrides }
}

describe("itemFromWire — what a node receives on its `in` wire", () => {
  it("reads JSON text that is an object as that object", () => {
    expect(itemFromWire('{"postUrl":"https://t.me/x/1","text":"hi"}')).toEqual({ postUrl: "https://t.me/x/1", text: "hi" })
    expect(itemFromWire('  {"a":1}  ')).toEqual({ a: 1 })
  })

  it("keeps a list, broken JSON and plain text as the text they are", () => {
    expect(itemFromWire('[{"a":1},{"a":2}]')).toBe('[{"a":1},{"a":2}]')
    expect(itemFromWire('{"a":')).toBe('{"a":')
    expect(itemFromWire("Just a headline")).toBe("Just a headline")
  })

  it("a list of exactly ONE object is that object — an each wire that held a single post never fanned out", () => {
    expect(itemFromWire('[{"postUrl":"https://t.me/x/9","text":"only one"}]')).toEqual({ postUrl: "https://t.me/x/9", text: "only one" })
    expect(itemFromWire([{ title: "T" }])).toEqual({ title: "T" })
    expect(itemFromWire('["just a string"]')).toBe('["just a string"]')
    expect(itemFromWire("[]")).toBe("[]")
  })

  it("JSON a model wrapped in a ```json fence is still JSON", () => {
    expect(itemFromWire('```json\n{"headline":"Markets rally","slug":"markets-rally"}\n```')).toEqual({ headline: "Markets rally", slug: "markets-rally" })
    expect(itemFromWire("```\n{\"a\":1}\n```")).toEqual({ a: 1 })
    expect(itemFromWire("```json\nnot json\n```")).toBe("```json\nnot json\n```")
  })

  it("passes a real object or list through untouched", () => {
    const obj = { title: "T" }
    expect(itemFromWire(obj)).toBe(obj)
    expect(itemFromWire(undefined)).toBeUndefined()
  })
})

describe("prepareRecord — explicit fields win over the item", () => {
  it("maps a feed post from JSON text, the node's title winning and the link keying the dedupe", () => {
    const prepared = prepareRecord({
      item: JSON.stringify({ id: 441, channel: "telegram", postUrl: "https://T.me/Telegram/441", text: "Telegram turns ten.", media: [{ type: "photo", url: "https://cdn.example.com/a.jpg" }] }),
      title: "Telegram turns ten",
      fields: { topic: "tech" },
    })
    expect(prepared).toEqual({
      title: "Telegram turns ten",
      text: "Telegram turns ten.",
      url: "https://T.me/Telegram/441",
      media: [{ type: "image", url: "https://cdn.example.com/a.jpg" }],
      fields: { id: 441, channel: "telegram", topic: "tech" },
      // The host folds to lower case; the path keeps its case.
      dedupeKey: "https://t.me/Telegram/441",
    })
  })

  it("the item's own media and the wired media are kept together, the item's first, repeats dropped", () => {
    const prepared = prepareRecord({
      item: { url: "https://a.example.com/1", imageUrl: "https://cdn.example.com/a.jpg" },
      media: [
        { type: "video", url: "https://cdn.example.com/b.mp4" },
        { type: "image", url: "https://cdn.example.com/a.jpg" },
      ],
    })
    expect(prepared?.media).toEqual([
      { type: "image", url: "https://cdn.example.com/a.jpg" },
      { type: "video", url: "https://cdn.example.com/b.mp4" },
    ])
  })

  it("a plain-text item that is one link is the record's link (a list of article addresses, saved row by row)", () => {
    const prepared = prepareRecord({ item: "  https://news.example.test/story-7 " })
    expect(prepared).toEqual({ title: "", text: "", url: "https://news.example.test/story-7", media: [], fields: {}, dedupeKey: "https://news.example.test/story-7" })
    // A sentence with a link in it stays text.
    expect(prepareRecord({ item: "Read https://news.example.test/story-7 today" })?.url).toBeNull()
  })

  it("an explicit link and dedupe key win; a link that is not http(s) is ignored", () => {
    const prepared = prepareRecord({ item: { url: "https://a.example.com/1" }, url: "https://b.example.com/2", dedupeKey: " Story-7 " })
    expect(prepared?.url).toBe("https://b.example.com/2")
    expect(prepared?.dedupeKey).toBe("story-7")
    expect(prepareRecord({ text: "t", url: "javascript:alert(1)" })?.url).toBeNull()
  })

  it("plain text becomes the text; a record with nothing in it is null; a poster that is null is a medium", () => {
    expect(prepareRecord({ item: "Just a headline" })?.text).toBe("Just a headline")
    expect(prepareRecord({ item: { nothing: null } })).toBeNull()
    expect(prepareRecord({})).toBeNull()
    expect(prepareRecord({ media: [{ type: "image", url: "https://cdn.example.com/a.jpg", posterUrl: null }] })?.media).toEqual([
      { type: "image", url: "https://cdn.example.com/a.jpg" },
    ])
  })

  it("cuts a long text to whole characters", () => {
    const prepared = prepareRecord({ text: "😀".repeat(20_500) })
    expect(Array.from(prepared!.text)).toHaveLength(20_000)
  })
})

describe("enrichRecordSources — the saving and using workflows' names, one lookup per page", () => {
  it("looks every uuid workflow id up once, scoped to the caller, and names the ones that are theirs on `source` and `usedBy`", async () => {
    fromMock.mockReset()
    const workflows = makeQB({ data: [{ id: WF, name: "News pipeline", project_id: PROJECT }] })
    fromMock.mockReturnValue(workflows)
    const out = await enrichRecordSources(
      [
        rec("a", { source: { via: "node", workflowId: WF, executionId: "exec1" }, usedAt: "2026-10-07T10:00:00Z", usedBy: { via: "node", workflowId: WF2 } }),
        rec("b", { source: { via: "node", workflowId: WF } }),
        rec("c", { source: { via: "mcp" } }),
      ],
      USER,
    )
    expect(fromMock).toHaveBeenCalledTimes(1)
    expect(fromMock).toHaveBeenCalledWith("workflows")
    const ids = (workflows.in as ReturnType<typeof vi.fn>).mock.calls[0]![1] as string[]
    expect([...ids].sort()).toEqual([WF, WF2])
    expect(workflows.eq).toHaveBeenCalledWith("user_id", USER)
    expect(out[0]!.source).toEqual({ via: "node", workflowId: WF, executionId: "exec1", workflowName: "News pipeline", projectId: PROJECT })
    // Another person's workflow: the user-scoped lookup does not answer it, so it stays a bare id.
    expect(out[0]!.usedBy).toEqual({ via: "node", workflowId: WF2 })
    expect(out[1]!.source.workflowName).toBe("News pipeline")
    expect(out[2]!.source).toEqual({ via: "mcp" })
  })

  it("reads nothing when no record names a uuid workflow, and keeps the records as they are when the lookup fails", async () => {
    fromMock.mockReset()
    const none = await enrichRecordSources([rec("a", { source: { via: "api" } }), rec("b", { source: { via: "node", workflowId: "wf-local" } })], USER)
    expect(fromMock).not.toHaveBeenCalled()
    expect(none[1]!.source).toEqual({ via: "node", workflowId: "wf-local" })
    fromMock.mockReturnValue(makeQB({ error: { code: "XX000", message: "boom" } }))
    const failed = await enrichRecordSources([rec("a", { source: { via: "node", workflowId: WF } })], USER)
    expect(failed[0]!.source).toEqual({ via: "node", workflowId: WF })
  })
})

describe("setRecordUsed", () => {
  const row = {
    id: "00000000-0000-4000-8000-0000000000e1",
    collection_id: COLL,
    title: "T",
    text: "",
    url: null,
    media: [],
    fields: {},
    dedupe_key: null,
    source: {},
    created_at: "2026-10-06T09:00:00Z",
    used_at: "2026-10-07T10:00:00Z",
    used_by: { via: "ui" },
  }

  it("stamps now and who on mark, clears both on unmark, scoped to the caller's record in its collection", async () => {
    fromMock.mockReset()
    const qb = makeQB({ data: row })
    fromMock.mockReturnValue(qb)
    const before = Date.now()
    const marked = await setRecordUsed({ userId: USER, collectionId: COLL, recordId: row.id, used: true, by: { via: "ui" } })
    expect(marked).toMatchObject({ kind: "updated", record: { id: row.id, usedAt: "2026-10-07T10:00:00Z", usedBy: { via: "ui" } } })
    const stamped = (qb.update as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { used_at: string; used_by: unknown }
    expect(Date.parse(stamped.used_at)).toBeGreaterThanOrEqual(before - 1_000)
    expect(stamped.used_by).toEqual({ via: "ui" })
    expect(qb.eq).toHaveBeenCalledWith("id", row.id)
    expect(qb.eq).toHaveBeenCalledWith("collection_id", COLL)
    expect(qb.eq).toHaveBeenCalledWith("user_id", USER)
    await setRecordUsed({ userId: USER, collectionId: COLL, recordId: row.id, used: false, by: { via: "ui" } })
    expect((qb.update as ReturnType<typeof vi.fn>).mock.calls[1]![0]).toEqual({ used_at: null, used_by: {} })
  })

  it("first use wins for a node's mark: a record already used keeps its stamps and answers already_used; an unknown record is not_found; the page overwrites", async () => {
    fromMock.mockReset()
    const update = makeQB({ data: null })
    const existing = makeQB({ data: { ...row, used_by: { via: "node", executionId: "first-run" } } })
    fromMock.mockReturnValueOnce(update).mockReturnValueOnce(existing)
    const outcome = await setRecordUsed({ userId: USER, collectionId: COLL, recordId: row.id, used: true, by: { via: "node", executionId: "second-run" }, firstUseWins: true })
    expect(update.is).toHaveBeenCalledWith("used_at", null)
    expect(outcome).toMatchObject({ kind: "already_used", record: { usedBy: { executionId: "first-run" } } })
    expect(existing.eq).toHaveBeenCalledWith("user_id", USER)

    fromMock.mockReset()
    fromMock.mockReturnValue(makeQB({ data: null }))
    expect((await setRecordUsed({ userId: USER, collectionId: COLL, recordId: row.id, used: true, by: { via: "node" }, firstUseWins: true })).kind).toBe("not_found")

    // The page and the API overwrite on purpose: no "still unused" filter without the flag.
    fromMock.mockReset()
    const plain = makeQB({ data: row })
    fromMock.mockReturnValue(plain)
    expect((await setRecordUsed({ userId: USER, collectionId: COLL, recordId: row.id, used: true, by: { via: "ui" } })).kind).toBe("updated")
    expect(plain.is).not.toHaveBeenCalled()
  })

  it("tells a record that is not there, a server without collections, and one before the usage migration apart from a real error", async () => {
    const outcomes: SetUsedOutcome["kind"][] = []
    for (const result of [
      { data: null },
      { error: { code: "42P01", message: 'relation "collection_records" does not exist' } },
      { error: { code: "42703", message: "column collection_records.used_at does not exist" } },
      { error: { code: "XX000", message: "boom" } },
    ]) {
      fromMock.mockReset()
      fromMock.mockReturnValue(makeQB(result))
      outcomes.push((await setRecordUsed({ userId: USER, collectionId: COLL, recordId: row.id, used: true, by: { via: "api" } })).kind)
    }
    expect(outcomes).toEqual(["not_found", "missing_table", "missing_column", "error"])
  })
})
