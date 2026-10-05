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
/** Columns the owner's projection does not return (the filters still match). */
let unselected: string[] = []

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
              if (!hit || unselected.length === 0) return { data: hit ? tableRow : null, error: null }
              const projected: Record<string, unknown> = { ...tableRow }
              for (const col of unselected) delete projected[col]
              return { data: projected, error: null }
            },
          }
          return query
        },
      }
    },
  }),
}))

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { mayHoldStoredRow, readWorkflowContent, readWorkflowContentFromServer, recheckedAccess, savedBaselineNodes } from "../workflow-content"
import { buildWorkflowDelta } from "../workflow-delta"
import type { WorkflowNode } from "@/types/nodes"

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
  unselected = []
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

describe("mayHoldStoredRow (T86)", () => {
  it("is true only for the owner and an `edit` collaborator of the workflow the load answered for", () => {
    expect(mayHoldStoredRow({ workflowId: "w1", access: "own" }, "w1")).toBe(true)
    expect(mayHoldStoredRow({ workflowId: "w1", access: "edit" }, "w1")).toBe(true)
    expect(mayHoldStoredRow({ workflowId: "w1", access: "view" }, "w1")).toBe(false)
    // What a re-check records when the reader has no access left (T97).
    expect(mayHoldStoredRow({ workflowId: "w1", access: "none" }, "w1")).toBe(false)
  })

  it("fails closed: no answer yet, or an answer about another workflow, is `view`", () => {
    expect(mayHoldStoredRow(null, "w1")).toBe(false)
    expect(mayHoldStoredRow(undefined, "w1")).toBe(false)
    expect(mayHoldStoredRow({ workflowId: "w0", access: "own" }, "w1")).toBe(false)
    expect(mayHoldStoredRow({ workflowId: "w1", access: "own" }, null)).toBe(false)
    expect(mayHoldStoredRow({ workflowId: "", access: "own" }, "")).toBe(false)
  })
})

describe("recheckedAccess (T97)", () => {
  it("a re-check's answer replaces the level, narrower or wider, `none` included", () => {
    expect(recheckedAccess({ workflowId: "w1", access: "edit" }, "view")).toEqual({ workflowId: "w1", access: "view" })
    expect(recheckedAccess({ workflowId: "w1", access: "edit" }, "none")).toEqual({ workflowId: "w1", access: "none" })
    expect(recheckedAccess({ workflowId: "w1", access: "view" }, "edit")).toEqual({ workflowId: "w1", access: "edit" })
    expect(recheckedAccess({ workflowId: "w1", access: "none" }, "view")).toEqual({ workflowId: "w1", access: "view" })
  })

  it("the caller's own row stays `own`, whatever the verdict says they may do with it", () => {
    // An archived workspace answers its creator `view`; a suspended membership, `none`.
    const own = { workflowId: "w1", access: "own" } as const
    expect(recheckedAccess(own, "view")).toBe(own)
    expect(recheckedAccess(own, "none")).toBe(own)
    expect(recheckedAccess(own, "edit")).toBe(own)
  })

  it("an answer that changes nothing returns the record itself", () => {
    const edit = { workflowId: "w1", access: "edit" } as const
    expect(recheckedAccess(edit, "edit")).toBe(edit)
  })
})

describe("readWorkflowContent — saved result ids the server resolves (decided 2026-10-05)", () => {
  const PLACEHOLDER_ROW = {
    ...STORED,
    nodes: [{ id: "gen", type: "generate-image", data: { generatedResults: [{ url: "https://m.test/a.png", jobId: "exec-gen" }] } }],
  }
  const UNLABELLED_RENDER_ROW = {
    ...STORED,
    nodes: [{ id: "render", type: "apply-edl", data: { generatedResults: [{ url: "https://m.test/e.mp4", jobId: "f0000000-0000-4000-8000-000000000001" }] } }],
  }
  const SERVER_OWN = {
    ...SERVER_VIEW,
    access: "own",
    nodes: [{ id: "gen", type: "generate-image", data: { generatedResults: [{ url: "https://m.test/a.png", jobId: "job-1" }] } }],
  }

  it("the owner's row holding a placeholder job id is read through the server, which resolves it", async () => {
    mockGetCurrentUserId.mockResolvedValue("owner-1")
    tableRow = PLACEHOLDER_ROW
    mockGetWorkflowDocument.mockResolvedValue(SERVER_OWN)
    const content = await readWorkflowContent("w1", "*")
    expect(mockGetWorkflowDocument).toHaveBeenCalledTimes(1)
    expect(content?.access).toBe("own")
    expect(content?.row.nodes).toEqual(SERVER_OWN.nodes)
    // The save cursor is the stored row's: the server read wrote nothing.
    expect(content?.row.version).toBe(9)
    expect(content?.row.updated_at).toBe(STORED.updated_at)
  })

  it("so is an Apply EDL take with no render quality", async () => {
    mockGetCurrentUserId.mockResolvedValue("owner-1")
    tableRow = UNLABELLED_RENDER_ROW
    mockGetWorkflowDocument.mockResolvedValue({ ...SERVER_OWN, nodes: UNLABELLED_RENDER_ROW.nodes })
    await readWorkflowContent("w1", "*")
    expect(mockGetWorkflowDocument).toHaveBeenCalledTimes(1)
  })

  it("a row with nothing to resolve never asks the server", async () => {
    mockGetCurrentUserId.mockResolvedValue("owner-1")
    tableRow = {
      ...STORED,
      nodes: [
        { id: "gen", type: "generate-image", data: { generatedResults: [{ url: "https://m.test/a.png", jobId: "f0000000-0000-4000-8000-000000000001" }] } },
        { id: "render", type: "apply-edl", data: { generatedResults: [{ url: "https://m.test/e.mp4", jobId: "f0000000-0000-4000-8000-000000000002", quality: "proxy" }] } },
      ],
    }
    await readWorkflowContent("w1", "*")
    expect(mockGetWorkflowDocument).not.toHaveBeenCalled()
  })

  it("takes the server's answer for a projection that selected no `id` (duplicate's read)", async () => {
    mockGetCurrentUserId.mockResolvedValue("owner-1")
    tableRow = PLACEHOLDER_ROW
    unselected = ["id"]
    mockGetWorkflowDocument.mockResolvedValue(SERVER_OWN)
    const content = await readWorkflowContent("w1", "project_id, folder_id, name, nodes, edges, settings")
    expect(mockGetWorkflowDocument).toHaveBeenCalledTimes(1)
    expect(content?.row.nodes).toEqual(SERVER_OWN.nodes)
    // …and never an answer about another workflow.
    mockGetWorkflowDocument.mockResolvedValue({ ...SERVER_OWN, id: "w2" })
    expect((await readWorkflowContent("w1", "project_id, folder_id, name, nodes, edges, settings"))?.row.nodes).toEqual(PLACEHOLDER_ROW.nodes)
  })

  it("hands the owner's stored nodes along with a served answer, so the canvas knows what is NOT saved yet", async () => {
    mockGetCurrentUserId.mockResolvedValue("owner-1")
    tableRow = PLACEHOLDER_ROW
    mockGetWorkflowDocument.mockResolvedValue(SERVER_OWN)
    const content = await readWorkflowContent("w1", "*")
    expect(content?.storedNodes).toBe(PLACEHOLDER_ROW.nodes)
    // A stored row taken as it is carries none: it IS what is saved.
    tableRow = STORED
    expect((await readWorkflowContent("w1", "*"))?.storedNodes).toBeUndefined()
  })

  it("keeps the stored row when the server fails, has none, or answers the owner less than `own`", async () => {
    mockGetCurrentUserId.mockResolvedValue("owner-1")
    tableRow = PLACEHOLDER_ROW
    mockGetWorkflowDocument.mockRejectedValueOnce(new Error("offline"))
    expect((await readWorkflowContent("w1", "*"))?.row).toBe(PLACEHOLDER_ROW)
    mockGetWorkflowDocument.mockResolvedValueOnce(null)
    expect((await readWorkflowContent("w1", "*"))?.row).toBe(PLACEHOLDER_ROW)
    // An archived workspace answers its creator `view` — a STRIPPED projection
    // the owner's canvas would then save back over their drafts.
    mockGetWorkflowDocument.mockResolvedValueOnce({ ...SERVER_OWN, access: "view" })
    const content = await readWorkflowContent("w1", "*")
    expect(content?.row).toBe(PLACEHOLDER_ROW)
    expect(content?.access).toBe("own")
  })
})

describe("savedBaselineNodes — a delta save persists what the server resolved on load (decided 2026-10-05)", () => {
  const stored = [
    { id: "gen", type: "generate-image", position: { x: 0, y: 0 }, data: { generatedResults: [{ url: "https://m.test/a.png", jobId: "exec-gen" }] } },
    { id: "text", type: "text", position: { x: 0, y: 0 }, data: { text: "hi" } },
  ] as unknown as WorkflowNode[]
  const served = [
    { ...stored[0], data: { generatedResults: [{ url: "https://m.test/a.png", jobId: "job-1" }] } },
    stored[1],
  ] as unknown as WorkflowNode[]

  it("puts the STORED copy of each resolved node in the save baseline, and only those", () => {
    // The canvas's own copies (what a load hands the store), equal in content to the served ones.
    const loaded = served.map((n) => ({ ...n })) as WorkflowNode[]
    const baseline = savedBaselineNodes(loaded, { row: { nodes: served }, storedNodes: stored })
    expect(baseline[0]).toBe(stored[0])
    expect(baseline[1]).toBe(loaded[1])
    // Against the canvas's load baseline the resolved node never diffs, so a
    // delta save would never write it; against this one it is upserted once.
    expect(buildWorkflowDelta({ nodes: loaded, edges: [] }, { nodes: loaded, edges: [] }).upsertNodes).toEqual([])
    expect(buildWorkflowDelta({ nodes: loaded, edges: [] }, { nodes: baseline, edges: [] }).upsertNodes.map((n) => n.id)).toEqual(["gen"])
  })

  it("returns the SAME baseline when nothing was served in place of the stored row", () => {
    const loaded = served.map((n) => ({ ...n })) as WorkflowNode[]
    expect(savedBaselineNodes(loaded, { row: { nodes: served } })).toBe(loaded)
    expect(savedBaselineNodes(loaded, { row: { nodes: served }, storedNodes: served })).toBe(loaded)
  })

  it("is what the editor's load seeds its save baseline with", () => {
    const src = readFileSync(join(__dirname, "..", "..", "hooks", "use-workflow-persistence.ts"), "utf8")
    expect(src).toMatch(/savedBaselineNodes\(/)
  })
})
