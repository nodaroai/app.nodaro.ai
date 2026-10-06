import { describe, it, expect, vi } from "vitest"
import { createClient, StaticTokenAuth } from "../../index.js"
import type { Collection, CollectionRecord } from "../../index.js"

function mockOk<T>(body: T, status = 200) {
  return Promise.resolve({
    ok: true,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  } as unknown as Response)
}

function client(fetchMock: ReturnType<typeof vi.fn>) {
  return createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock })
}

function call(fetchMock: ReturnType<typeof vi.fn>, n = 0) {
  const [url, init] = fetchMock.mock.calls[n] as [string, { method: string; body?: string; headers?: Record<string, string> }]
  return { url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers ?? {} }
}

const ID = "00000000-0000-4000-8000-0000000000c1"
const COLLECTION: Collection = { id: ID, name: "News", description: "", recordCount: 2, createdAt: "2026-10-06T08:00:00Z", updatedAt: "2026-10-06T08:00:00Z" }
const RECORD: CollectionRecord = {
  id: "00000000-0000-4000-8000-0000000000e1",
  collectionId: ID,
  title: "Telegram turns ten",
  text: "The body.",
  url: "https://t.me/telegram/441",
  media: [],
  fields: {},
  dedupeKey: "https://t.me/telegram/441",
  source: { via: "api" },
  createdAt: "2026-10-06T09:00:00Z",
}

describe("collections resource", () => {
  it("lists, reads, creates, changes and removes collections", async () => {
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(mockOk({ data: [COLLECTION], available: true, caps: { collections: 3, records: 500 } }))
      .mockReturnValueOnce(mockOk(COLLECTION))
      .mockReturnValueOnce(mockOk(COLLECTION, 201))
      .mockReturnValueOnce(mockOk({ ...COLLECTION, name: "World" }))
      .mockReturnValueOnce(mockOk({ success: true }))
    const sdk = client(fetchMock)

    const page = await sdk.collections.list()
    expect(page.data).toEqual([COLLECTION])
    expect(page.caps).toEqual({ collections: 3, records: 500 })
    expect((await sdk.collections.get(ID)).name).toBe("News")
    await sdk.collections.create({ name: "News", description: "Articles" })
    expect((await sdk.collections.update(ID, { name: "World" })).name).toBe("World")
    await expect(sdk.collections.delete(ID)).resolves.toBeUndefined()

    expect(call(fetchMock, 0)).toMatchObject({ url: "https://api.example.com/v1/collections", method: "GET" })
    expect(call(fetchMock, 1)).toMatchObject({ url: `https://api.example.com/v1/collections/${ID}`, method: "GET" })
    expect(call(fetchMock, 2)).toMatchObject({ method: "POST", body: { name: "News", description: "Articles" } })
    expect(call(fetchMock, 3)).toMatchObject({ url: `https://api.example.com/v1/collections/${ID}`, method: "PATCH", body: { name: "World" } })
    expect(call(fetchMock, 4)).toMatchObject({ url: `https://api.example.com/v1/collections/${ID}`, method: "DELETE" })
  })

  it("pages the records with the filters, adds one under an Idempotency-Key, removes one", async () => {
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(mockOk({ data: [RECORD], nextCursor: "abc" }))
      .mockReturnValueOnce(mockOk({ record: RECORD, outcome: "inserted", evicted: 0 }, 201))
      .mockReturnValueOnce(mockOk({ record: RECORD, outcome: "duplicate", evicted: 0 }))
      .mockReturnValueOnce(mockOk({ success: true }))
    const sdk = client(fetchMock)

    const page = await sdk.collections.records(ID, { q: "telegram", since: "2026-10-05T00:00:00Z", limit: 10, cursor: "prev" })
    expect(page.nextCursor).toBe("abc")
    const added = await sdk.collections.addRecord(ID, { item: { postUrl: RECORD.url, text: "x" }, fields: { topic: "tech" } }, { idempotencyKey: "run-1-0" })
    expect(added.outcome).toBe("inserted")
    const again = await sdk.collections.addRecord(ID, { url: RECORD.url! })
    expect(again.outcome).toBe("duplicate")
    await expect(sdk.collections.deleteRecord(ID, RECORD.id)).resolves.toBeUndefined()

    const listed = call(fetchMock, 0)
    expect(listed.method).toBe("GET")
    const url = new URL(listed.url)
    expect(url.pathname).toBe(`/v1/collections/${ID}/records`)
    expect(url.searchParams.get("q")).toBe("telegram")
    expect(url.searchParams.get("since")).toBe("2026-10-05T00:00:00Z")
    expect(url.searchParams.get("limit")).toBe("10")
    expect(url.searchParams.get("cursor")).toBe("prev")
    const add = call(fetchMock, 1)
    expect(add).toMatchObject({ url: `https://api.example.com/v1/collections/${ID}/records`, method: "POST", body: { item: { postUrl: RECORD.url, text: "x" }, fields: { topic: "tech" } } })
    expect(add.headers["Idempotency-Key"]).toBe("run-1-0")
    expect(call(fetchMock, 2).headers["Idempotency-Key"]).toBeUndefined()
    expect(call(fetchMock, 3)).toMatchObject({ url: `https://api.example.com/v1/collections/${ID}/records/${RECORD.id}`, method: "DELETE" })
  })

  it("exports the collection as text, in the format asked for", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk("id,created_at\r\n")).mockReturnValueOnce(mockOk("[]\n"))
    const sdk = client(fetchMock)
    expect(await sdk.collections.export(ID)).toBe("id,created_at\r\n")
    expect(await sdk.collections.export(ID, { format: "json", since: "2026-10-05T00:00:00Z" })).toBe("[]\n")
    const first = new URL(call(fetchMock, 0).url)
    expect(first.pathname).toBe(`/v1/collections/${ID}/export`)
    expect(first.searchParams.get("format")).toBeNull()
    const second = new URL(call(fetchMock, 1).url)
    expect(second.searchParams.get("format")).toBe("json")
    expect(second.searchParams.get("since")).toBe("2026-10-05T00:00:00Z")
  })
})
