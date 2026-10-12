/**
 * A switched-off template's kept example run is deleted 30 days on, through the storage-delete funnel,
 * and only under that template's own `kept/` prefix (`sweepDeletedTemplateKeptCopies`).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => ({
  rows: [] as Array<{ id: unknown }>,
  filters: [] as Array<[string, string, unknown]>,
  queryError: null as unknown,
  listed: new Map<string, string[]>(),
  deleted: [] as Array<{ keys: string[]; source: string }>,
  failOn: new Set<string>(),
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      for (const op of ["eq", "lt", "gt"]) chain[op] = (column: string, value: unknown) => {
        h.filters.push([op, `${table}.${column}`, value])
        return chain
      }
      chain.limit = async () => ({ data: h.queryError ? null : h.rows, error: h.queryError })
      return chain
    },
  },
}))
vi.mock("@/lib/storage.js", () => ({
  isStorageConfigured: () => true,
  listObjectsByPrefixWithMeta: vi.fn(async (prefix: string) => {
    if (h.failOn.has(prefix)) throw new Error("list failed")
    return (h.listed.get(prefix) ?? []).map((key) => ({ key }))
  }),
}))
vi.mock("@/lib/storage-delete.js", () => ({
  deleteKeysRecordingFailures: vi.fn(async (keys: string[], source: string) => {
    h.deleted.push({ keys, source })
    return { deleted: keys.length, errors: 0, failed: [] }
  }),
}))

import { sweepDeletedTemplateKeptCopies, TEMPLATE_KEPT_GRACE_MS, TEMPLATE_KEPT_WINDOW_MS } from "../template-kept-sweep.js"

const NOW = Date.parse("2026-12-01T00:00:00Z")

beforeEach(() => {
  h.rows = []
  h.filters = []
  h.queryError = null
  h.listed.clear()
  h.deleted = []
  h.failOn.clear()
})

describe("sweepDeletedTemplateKeptCopies", () => {
  it("asks only for switched-off templates between 30 and 90 days off", async () => {
    await sweepDeletedTemplateKeptCopies(NOW)
    expect(h.filters).toEqual([
      ["eq", "workflow_templates.is_active", false],
      ["lt", "workflow_templates.updated_at", new Date(NOW - TEMPLATE_KEPT_GRACE_MS).toISOString()],
      ["gt", "workflow_templates.updated_at", new Date(NOW - TEMPLATE_KEPT_GRACE_MS - TEMPLATE_KEPT_WINDOW_MS).toISOString()],
    ])
  })

  it("deletes each template's kept copies through the funnel, and nothing outside its kept prefix", async () => {
    h.rows = [{ id: "t1" }, { id: "t2" }]
    h.listed.set("templates/t1/kept/", ["templates/t1/kept/a.png", "templates/t1/kept/b.mp4", "templates/t1/preview-x.png"])
    const result = await sweepDeletedTemplateKeptCopies(NOW)
    expect(h.deleted).toEqual([{ keys: ["templates/t1/kept/a.png", "templates/t1/kept/b.mp4"], source: "template-kept" }])
    expect(result).toEqual({ templates: 2, deleted: 2, failed: 0 })
  })

  it("a failed listing is counted, never thrown, and the others still run", async () => {
    h.rows = [{ id: "t1" }, { id: "t2" }]
    h.failOn.add("templates/t1/kept/")
    h.listed.set("templates/t2/kept/", ["templates/t2/kept/a.png"])
    const result = await sweepDeletedTemplateKeptCopies(NOW)
    expect(result.failed).toBe(1)
    expect(h.deleted).toEqual([{ keys: ["templates/t2/kept/a.png"], source: "template-kept" }])
  })

  it("a failed query deletes nothing", async () => {
    h.queryError = { message: "down" }
    expect(await sweepDeletedTemplateKeptCopies(NOW)).toEqual({ templates: 0, deleted: 0, failed: 1 })
    expect(h.deleted).toEqual([])
  })

  it("a row with no id is skipped", async () => {
    h.rows = [{ id: "" }, { id: null }]
    await sweepDeletedTemplateKeptCopies(NOW)
    expect(h.deleted).toEqual([])
  })
})
