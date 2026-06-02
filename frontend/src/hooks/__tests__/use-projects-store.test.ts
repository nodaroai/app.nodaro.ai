import { describe, it, expect, beforeEach, vi } from "vitest"
import { useProjectsStore } from "../use-projects-store"

const FAKE_USER_ID = "user-123"
const NOW = "2026-01-30T00:00:00.000Z"

let callLog: Array<{ table: string; method: string; args: unknown[] }> = []

function makeChain(resolvedValue: { data: unknown; error: null } | { data: null; error: { message: string } }) {
  const chain: Record<string, unknown> = {}
  const methods = ["select", "insert", "update", "delete", "eq", "single", "order"]
  for (const m of methods) {
    chain[m] = vi.fn((..._args: unknown[]) => chain)
  }
  // Make the chain thenable so await resolves to the value
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
    return Promise.resolve(resolvedValue).then(resolve, reject)
  }
  return chain
}

function createMockSupabase(overrides?: {
  fromHandler?: (table: string) => ReturnType<typeof makeChain>
}) {
  const client = {
    from: vi.fn((table: string) => {
      if (overrides?.fromHandler) {
        return overrides.fromHandler(table)
      }
      return makeChain({ data: null, error: null } as unknown as { data: null; error: { message: string } })
    }),
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: FAKE_USER_ID } },
        error: null,
      }),
    },
  }
  return client
}

let mockSupabase: ReturnType<typeof createMockSupabase>

vi.mock("@/lib/supabase", () => ({
  createClient: () => mockSupabase,
}))

function resetStore() {
  useProjectsStore.setState({
    projects: [],
    folders: [],
    workflowMetas: [],
    loading: false,
    error: null,
  })
}

function setupMockForCreate(table: string, returnRow: Record<string, unknown>) {
  return createMockSupabase({
    fromHandler: (t: string) => {
      if (t === table) {
        return makeChain({ data: returnRow, error: null })
      }
      return makeChain({ data: [], error: null })
    },
  })
}

describe("useProjectsStore", () => {
  beforeEach(() => {
    resetStore()
    callLog = []
    mockSupabase = createMockSupabase()
  })

  describe("projects", () => {
    it("creates a project with name and description", async () => {
      const row = {
        id: "proj-1",
        name: "My Project",
        description: "A description",
        created_at: NOW,
        updated_at: NOW,
      }
      mockSupabase = setupMockForCreate("projects", row)

      const project = await useProjectsStore.getState().createProject("My Project", "A description")

      expect(project).not.toBeNull()
      expect(project!.name).toBe("My Project")
      expect(project!.description).toBe("A description")
      expect(project!.id).toBe("proj-1")
      expect(useProjectsStore.getState().projects).toHaveLength(1)
    })

    it("creates a project with empty description by default", async () => {
      const row = {
        id: "proj-2",
        name: "No Desc",
        description: "",
        created_at: NOW,
        updated_at: NOW,
      }
      mockSupabase = setupMockForCreate("projects", row)

      const project = await useProjectsStore.getState().createProject("No Desc")

      expect(project).not.toBeNull()
      expect(project!.description).toBe("")
    })

    it("deletes a project and its folders and workflows", async () => {
      // Pre-populate the store
      useProjectsStore.setState({
        projects: [{ id: "p1", name: "To Delete", description: "", isDefault: false, createdAt: NOW, updatedAt: NOW, settings: {} }],
        folders: [{ id: "f1", projectId: "p1", name: "Folder", createdAt: NOW }],
        workflowMetas: [{ id: "w1", projectId: "p1", folderId: null, name: "WF", thumbnailUrl: null, createdAt: NOW, updatedAt: NOW }],
      })

      mockSupabase = createMockSupabase({
        fromHandler: () => makeChain({ data: null, error: null } as unknown as { data: null; error: { message: string } }),
      })

      await useProjectsStore.getState().deleteProject("p1")

      const state = useProjectsStore.getState()
      expect(state.projects).toHaveLength(0)
      expect(state.folders).toHaveLength(0)
      expect(state.workflowMetas).toHaveLength(0)
    })

    it("updates a project name and description", async () => {
      useProjectsStore.setState({
        projects: [{ id: "p1", name: "Old Name", description: "Old Desc", isDefault: false, createdAt: NOW, updatedAt: NOW, settings: {} }],
      })

      mockSupabase = createMockSupabase({
        fromHandler: () => makeChain({ data: null, error: null } as unknown as { data: null; error: { message: string } }),
      })

      await useProjectsStore.getState().updateProject("p1", { name: "New Name" })

      const updated = useProjectsStore.getState().projects[0]
      expect(updated.name).toBe("New Name")
      expect(updated.description).toBe("Old Desc")
    })
  })

  describe("folders", () => {
    it("creates a folder in a project", async () => {
      const row = { id: "f1", project_id: "p1", name: "My Folder", created_at: NOW }
      mockSupabase = setupMockForCreate("folders", row)

      const folder = await useProjectsStore.getState().createFolder("p1", "My Folder")

      expect(folder).not.toBeNull()
      expect(folder!.name).toBe("My Folder")
      expect(folder!.projectId).toBe("p1")
      expect(folder!.id).toBe("f1")
    })

    it("renames a folder", async () => {
      useProjectsStore.setState({
        folders: [{ id: "f1", projectId: "p1", name: "Old", createdAt: NOW }],
      })

      mockSupabase = createMockSupabase({
        fromHandler: () => makeChain({ data: null, error: null } as unknown as { data: null; error: { message: string } }),
      })

      await useProjectsStore.getState().renameFolder("f1", "New")

      expect(useProjectsStore.getState().folders[0].name).toBe("New")
    })

    it("deletes a folder and unassigns its workflows", async () => {
      useProjectsStore.setState({
        folders: [{ id: "f1", projectId: "p1", name: "F", createdAt: NOW }],
        workflowMetas: [{ id: "w1", projectId: "p1", folderId: "f1", name: "WF", thumbnailUrl: null, createdAt: NOW, updatedAt: NOW }],
      })

      mockSupabase = createMockSupabase({
        fromHandler: () => makeChain({ data: null, error: null } as unknown as { data: null; error: { message: string } }),
      })

      await useProjectsStore.getState().deleteFolder("f1")

      const state = useProjectsStore.getState()
      expect(state.folders).toHaveLength(0)
      expect(state.workflowMetas).toHaveLength(1)
      expect(state.workflowMetas[0].folderId).toBeNull()
    })
  })

  describe("workflows", () => {
    it("creates a workflow at root level", async () => {
      const row = {
        id: "w1",
        project_id: "p1",
        folder_id: null,
        name: "My WF",
        created_at: NOW,
        updated_at: NOW,
      }
      mockSupabase = setupMockForCreate("workflows", row)

      const wf = await useProjectsStore.getState().createWorkflow("p1", "My WF")

      expect(wf).not.toBeNull()
      expect(wf!.name).toBe("My WF")
      expect(wf!.projectId).toBe("p1")
      expect(wf!.folderId).toBeNull()
      expect(wf!.id).toBe("w1")
    })

    it("creates a workflow inside a folder", async () => {
      const row = {
        id: "w1",
        project_id: "p1",
        folder_id: "f1",
        name: "WF",
        created_at: NOW,
        updated_at: NOW,
      }
      mockSupabase = setupMockForCreate("workflows", row)

      const wf = await useProjectsStore.getState().createWorkflow("p1", "WF", "f1")

      expect(wf).not.toBeNull()
      expect(wf!.folderId).toBe("f1")
    })

    it("deletes a workflow", async () => {
      useProjectsStore.setState({
        workflowMetas: [{ id: "w1", projectId: "p1", folderId: null, name: "WF", thumbnailUrl: null, createdAt: NOW, updatedAt: NOW }],
      })

      mockSupabase = createMockSupabase({
        fromHandler: () => makeChain({ data: null, error: null } as unknown as { data: null; error: { message: string } }),
      })

      await useProjectsStore.getState().deleteWorkflow("w1")

      expect(useProjectsStore.getState().workflowMetas).toHaveLength(0)
    })

    it("renames a workflow", async () => {
      useProjectsStore.setState({
        workflowMetas: [{ id: "w1", projectId: "p1", folderId: null, name: "Old", thumbnailUrl: null, createdAt: NOW, updatedAt: NOW }],
      })

      mockSupabase = createMockSupabase({
        fromHandler: () => makeChain({ data: null, error: null } as unknown as { data: null; error: { message: string } }),
      })

      await useProjectsStore.getState().renameWorkflow("w1", "New")

      expect(useProjectsStore.getState().workflowMetas[0].name).toBe("New")
    })

    it("moves a workflow to a folder", async () => {
      useProjectsStore.setState({
        workflowMetas: [{ id: "w1", projectId: "p1", folderId: null, name: "WF", thumbnailUrl: null, createdAt: NOW, updatedAt: NOW }],
      })

      mockSupabase = createMockSupabase({
        fromHandler: () => makeChain({ data: null, error: null } as unknown as { data: null; error: { message: string } }),
      })

      await useProjectsStore.getState().moveWorkflow("w1", "f1")

      expect(useProjectsStore.getState().workflowMetas[0].folderId).toBe("f1")
    })

    it("moves a workflow out of a folder to root", async () => {
      useProjectsStore.setState({
        workflowMetas: [{ id: "w1", projectId: "p1", folderId: "f1", name: "WF", thumbnailUrl: null, createdAt: NOW, updatedAt: NOW }],
      })

      mockSupabase = createMockSupabase({
        fromHandler: () => makeChain({ data: null, error: null } as unknown as { data: null; error: { message: string } }),
      })

      await useProjectsStore.getState().moveWorkflow("w1", null)

      expect(useProjectsStore.getState().workflowMetas[0].folderId).toBeNull()
    })

    it("duplicates a workflow", async () => {
      useProjectsStore.setState({
        workflowMetas: [{ id: "w1", projectId: "p1", folderId: "f1", name: "Original", thumbnailUrl: null, createdAt: NOW, updatedAt: NOW }],
      })

      // First call: select original workflow; second call: insert duplicate
      let callCount = 0
      mockSupabase = createMockSupabase({
        fromHandler: (table: string) => {
          if (table === "workflows") {
            callCount++
            if (callCount === 1) {
              // fetch original
              return makeChain({
                data: {
                  id: "w1",
                  project_id: "p1",
                  folder_id: "f1",
                  name: "Original",
                  nodes: [],
                  edges: [],
                  settings: {},
                  created_at: NOW,
                  updated_at: NOW,
                },
                error: null,
              })
            }
            // insert copy
            return makeChain({
              data: {
                id: "w2",
                project_id: "p1",
                folder_id: "f1",
                name: "Original (Copy)",
                created_at: NOW,
                updated_at: NOW,
              },
              error: null,
            })
          }
          return makeChain({ data: [], error: null })
        },
      })

      const copy = await useProjectsStore.getState().duplicateWorkflow("w1")

      expect(copy).not.toBeNull()
      expect(copy!.name).toBe("Original (Copy)")
      expect(copy!.projectId).toBe("p1")
      expect(copy!.folderId).toBe("f1")
      expect(copy!.id).not.toBe("w1")
      expect(useProjectsStore.getState().workflowMetas).toHaveLength(2)
    })

    it("returns null when duplicating non-existent workflow", async () => {
      mockSupabase = createMockSupabase({
        fromHandler: () => makeChain({ data: null, error: { message: "not found" } }),
      })

      const result = await useProjectsStore.getState().duplicateWorkflow("nonexistent")
      expect(result).toBeNull()
    })
  })

  describe("fetchProjects", () => {
    it("fetches projects and updates store", async () => {
      const rows = [
        { id: "p1", name: "Project 1", description: "Desc", created_at: NOW, updated_at: NOW },
        { id: "p2", name: "Project 2", description: "", created_at: NOW, updated_at: NOW },
      ]
      mockSupabase = createMockSupabase({
        fromHandler: () => makeChain({ data: rows, error: null }),
      })

      await useProjectsStore.getState().fetchProjects()

      const state = useProjectsStore.getState()
      expect(state.projects).toHaveLength(2)
      expect(state.projects[0].name).toBe("Project 1")
      expect(state.loading).toBe(false)
    })

    it("sets error on fetch failure", async () => {
      mockSupabase = createMockSupabase({
        fromHandler: () => makeChain({ data: null, error: { message: "DB error" } }),
      })

      await useProjectsStore.getState().fetchProjects()

      expect(useProjectsStore.getState().error).toBe("DB error")
      expect(useProjectsStore.getState().loading).toBe(false)
    })
  })

  describe("fetchProjectData", () => {
    it("fetches folders and workflows for a project", async () => {
      const folderRows = [{ id: "f1", project_id: "p1", name: "Folder", created_at: NOW }]
      const workflowRows = [
        { id: "w1", project_id: "p1", folder_id: "f1", name: "WF", created_at: NOW, updated_at: NOW },
      ]

      mockSupabase = createMockSupabase({
        fromHandler: (table: string) => {
          if (table === "folders") return makeChain({ data: folderRows, error: null })
          if (table === "workflows") return makeChain({ data: workflowRows, error: null })
          return makeChain({ data: [], error: null })
        },
      })

      await useProjectsStore.getState().fetchProjectData("p1")

      const state = useProjectsStore.getState()
      expect(state.folders).toHaveLength(1)
      expect(state.folders[0].name).toBe("Folder")
      expect(state.workflowMetas).toHaveLength(1)
      expect(state.workflowMetas[0].name).toBe("WF")
      expect(state.loading).toBe(false)
    })
  })
})
