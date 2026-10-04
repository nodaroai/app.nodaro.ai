import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * The content funnel (T76): the stored row reaches the browser only for its
 * owner; everyone else gets the server's answer. Driven against a table stub
 * that honours `.eq` filters the way PostgREST does, so a read that loses its
 * owner filter is visible here, not in production.
 */

const mockGetCurrentUserId = vi.fn()
const mockGetWorkflowDocument = vi.fn()
const selects: string[] = []
const filterLog: Array<Array<[string, unknown]>> = []
let tableRow: Record<string, unknown> | null = null
let tableError: { message: string } | null = null

vi.mock("@/lib/api", () => ({
  getCurrentUserId: () => mockGetCurrentUserId(),
  getWorkflowDocument: (...args: unknown[]) => mockGetWorkflowDocument(...args),
}))

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table !== "workflows") throw new Error(`unexpected table ${table}`)
      return {
        select: (projection: string) => {
          selects.push(projection)
          const filters: Array<[string, unknown]> = []
          filterLog.push(filters)
          const query = {
            eq: (col: string, val: unknown) => {
              filters.push([col, val])
              return query
            },
            maybeSingle: async () => {
              if (tableError) return { data: null, error: tableError }
              const hit = tableRow && filters.every(([col, val]) => tableRow![col] === val)
              return { data: hit ? tableRow : null, error: null }
            },
          }
          return query
        },
      }
    },
  }),
}))

import { isOwnWorkflowRow, readWorkflowContent, readWorkflowContentFromServer } from "../workflow-content"

const STORED = {
  id: "w1",
  name: "A production",
  user_id: "owner-1",
  nodes: [{ id: "n1", data: { generatedResults: [{ url: "u", revoiceTo: { voiceId: "v" } }] } }],
  edges: [],
  settings: { studio: { shots: [{ id: "s1", stillSlots: [{ id: "slot" }] }] } },
  updated_at: "2026-10-01T00:00:00.123456+00:00",
  version: 9,
}

/** What the server would hand a `view` reader (a stand-in projection: the
 *  real strip is the server's, pinned in the backend's route tests). */
const SERVER_VIEW = {
  id: "w1", projectId: "p1", userId: "owner-1", folderId: "f1", name: "A production", version: 9,
  nodes: [{ id: "n1", data: { generatedResults: [{ url: "u" }] } }], edges: [],
  settings: { studio: { shots: [{ id: "s1" }] } },
  createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00.123456+00:00", access: "view",
}

beforeEach(() => {
  vi.clearAllMocks()
  selects.length = 0
  filterLog.length = 0
  tableRow = STORED
  tableError = null
})

describe("readWorkflowContent", () => {
  it("the owner reads the stored row — the query they always made, plus the owner filter", async () => {
    mockGetCurrentUserId.mockResolvedValue("owner-1")
    const content = await readWorkflowContent("w1", "*")

    expect(content).toEqual({ row: STORED, access: "own" })
    expect(selects).toEqual(["*"])
    expect(filterLog[0]).toEqual([["id", "w1"], ["user_id", "owner-1"]])
    expect(mockGetWorkflowDocument).not.toHaveBeenCalled()
  })

  it("anyone else gets the server's answer, in the table's own spelling — never the stored row", async () => {
    mockGetCurrentUserId.mockResolvedValue("viewer-2")
    mockGetWorkflowDocument.mockResolvedValue(SERVER_VIEW)
    const content = await readWorkflowContent("w1", "*")

    expect(mockGetWorkflowDocument).toHaveBeenCalledWith("w1")
    expect(content).toEqual({
      access: "view",
      row: {
        id: "w1", name: "A production", user_id: "owner-1", project_id: "p1", folder_id: "f1",
        nodes: SERVER_VIEW.nodes, edges: [], settings: SERVER_VIEW.settings,
        updated_at: "2026-10-01T00:00:00.123456+00:00", version: 9,
      },
    })
  })

  it("an `edit` collaborator gets what the server answers them, access and all", async () => {
    mockGetCurrentUserId.mockResolvedValue("editor-3")
    mockGetWorkflowDocument.mockResolvedValue({ ...SERVER_VIEW, nodes: STORED.nodes, settings: STORED.settings, access: "edit" })
    const content = await readWorkflowContent("w1", "id, nodes, edges")

    expect(content?.access).toBe("edit")
    expect(content?.row.settings).toEqual(STORED.settings)
  })

  it("with no session it never touches the table", async () => {
    mockGetCurrentUserId.mockResolvedValue(undefined)
    mockGetWorkflowDocument.mockResolvedValue(null)
    expect(await readWorkflowContent("w1", "*")).toBeNull()
    expect(selects).toEqual([])
  })

  it("null when neither the table nor the server will hand it over", async () => {
    mockGetCurrentUserId.mockResolvedValue("stranger")
    mockGetWorkflowDocument.mockResolvedValue(null)
    expect(await readWorkflowContent("w1", "*")).toBeNull()
  })

  it("a failed table read throws rather than falling through", async () => {
    mockGetCurrentUserId.mockResolvedValue("owner-1")
    tableError = { message: "boom" }
    await expect(readWorkflowContent("w1", "*")).rejects.toThrow("boom")
    expect(mockGetWorkflowDocument).not.toHaveBeenCalled()
  })

  it("the server-only read skips the table", async () => {
    mockGetWorkflowDocument.mockResolvedValue(SERVER_VIEW)
    const content = await readWorkflowContentFromServer("w1")
    expect(content?.access).toBe("view")
    expect(selects).toEqual([])
    expect(mockGetCurrentUserId).not.toHaveBeenCalled()
  })
})

describe("isOwnWorkflowRow", () => {
  it("is true only for the caller's own row, and fails closed", () => {
    expect(isOwnWorkflowRow({ user_id: "me" }, "me")).toBe(true)
    expect(isOwnWorkflowRow({ user_id: "someone" }, "me")).toBe(false)
    expect(isOwnWorkflowRow({}, "me")).toBe(false)
    expect(isOwnWorkflowRow({ user_id: null }, "me")).toBe(false)
    expect(isOwnWorkflowRow({ user_id: "me" }, undefined)).toBe(false)
    expect(isOwnWorkflowRow({ user_id: "" }, "")).toBe(false)
  })
})
