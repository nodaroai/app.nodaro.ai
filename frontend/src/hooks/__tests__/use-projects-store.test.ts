import { describe, it, expect, beforeEach } from "vitest"
import { useProjectsStore } from "../use-projects-store"

function resetStore() {
  useProjectsStore.setState({
    projects: [],
    folders: [],
    workflowMetas: [],
  })
}

describe("useProjectsStore", () => {
  beforeEach(() => {
    resetStore()
  })

  describe("projects", () => {
    it("creates a project with name and description", () => {
      const project = useProjectsStore.getState().createProject("My Project", "A description")

      expect(project.name).toBe("My Project")
      expect(project.description).toBe("A description")
      expect(project.id).toMatch(/^proj_/)
      expect(useProjectsStore.getState().projects).toHaveLength(1)
    })

    it("creates a project with empty description by default", () => {
      const project = useProjectsStore.getState().createProject("No Desc")

      expect(project.description).toBe("")
    })

    it("deletes a project and its folders and workflows", () => {
      const project = useProjectsStore.getState().createProject("To Delete")
      useProjectsStore.getState().createFolder(project.id, "Folder")
      useProjectsStore.getState().createWorkflow(project.id, "WF")

      useProjectsStore.getState().deleteProject(project.id)

      const state = useProjectsStore.getState()
      expect(state.projects).toHaveLength(0)
      expect(state.folders).toHaveLength(0)
      expect(state.workflowMetas).toHaveLength(0)
    })

    it("updates a project name and description", () => {
      const project = useProjectsStore.getState().createProject("Old Name", "Old Desc")

      useProjectsStore.getState().updateProject(project.id, { name: "New Name" })

      const updated = useProjectsStore.getState().projects[0]
      expect(updated.name).toBe("New Name")
      expect(updated.description).toBe("Old Desc")
    })
  })

  describe("folders", () => {
    it("creates a folder in a project", () => {
      const project = useProjectsStore.getState().createProject("P")
      const folder = useProjectsStore.getState().createFolder(project.id, "My Folder")

      expect(folder.name).toBe("My Folder")
      expect(folder.projectId).toBe(project.id)
      expect(folder.id).toMatch(/^folder_/)
    })

    it("renames a folder", () => {
      const project = useProjectsStore.getState().createProject("P")
      const folder = useProjectsStore.getState().createFolder(project.id, "Old")

      useProjectsStore.getState().renameFolder(folder.id, "New")

      expect(useProjectsStore.getState().folders[0].name).toBe("New")
    })

    it("deletes a folder and unassigns its workflows", () => {
      const project = useProjectsStore.getState().createProject("P")
      const folder = useProjectsStore.getState().createFolder(project.id, "F")
      useProjectsStore.getState().createWorkflow(project.id, "WF", folder.id)

      useProjectsStore.getState().deleteFolder(folder.id)

      const state = useProjectsStore.getState()
      expect(state.folders).toHaveLength(0)
      expect(state.workflowMetas).toHaveLength(1)
      expect(state.workflowMetas[0].folderId).toBeNull()
    })
  })

  describe("workflows", () => {
    it("creates a workflow at root level", () => {
      const project = useProjectsStore.getState().createProject("P")
      const wf = useProjectsStore.getState().createWorkflow(project.id, "My WF")

      expect(wf.name).toBe("My WF")
      expect(wf.projectId).toBe(project.id)
      expect(wf.folderId).toBeNull()
      expect(wf.id).toMatch(/^wf_/)
    })

    it("creates a workflow inside a folder", () => {
      const project = useProjectsStore.getState().createProject("P")
      const folder = useProjectsStore.getState().createFolder(project.id, "F")
      const wf = useProjectsStore.getState().createWorkflow(project.id, "WF", folder.id)

      expect(wf.folderId).toBe(folder.id)
    })

    it("deletes a workflow", () => {
      const project = useProjectsStore.getState().createProject("P")
      const wf = useProjectsStore.getState().createWorkflow(project.id, "WF")

      useProjectsStore.getState().deleteWorkflow(wf.id)

      expect(useProjectsStore.getState().workflowMetas).toHaveLength(0)
    })

    it("renames a workflow", () => {
      const project = useProjectsStore.getState().createProject("P")
      const wf = useProjectsStore.getState().createWorkflow(project.id, "Old")

      useProjectsStore.getState().renameWorkflow(wf.id, "New")

      expect(useProjectsStore.getState().workflowMetas[0].name).toBe("New")
    })

    it("moves a workflow to a folder", () => {
      const project = useProjectsStore.getState().createProject("P")
      const folder = useProjectsStore.getState().createFolder(project.id, "F")
      const wf = useProjectsStore.getState().createWorkflow(project.id, "WF")

      useProjectsStore.getState().moveWorkflow(wf.id, folder.id)

      expect(useProjectsStore.getState().workflowMetas[0].folderId).toBe(folder.id)
    })

    it("moves a workflow out of a folder to root", () => {
      const project = useProjectsStore.getState().createProject("P")
      const folder = useProjectsStore.getState().createFolder(project.id, "F")
      const wf = useProjectsStore.getState().createWorkflow(project.id, "WF", folder.id)

      useProjectsStore.getState().moveWorkflow(wf.id, null)

      expect(useProjectsStore.getState().workflowMetas[0].folderId).toBeNull()
    })

    it("duplicates a workflow", () => {
      const project = useProjectsStore.getState().createProject("P")
      const folder = useProjectsStore.getState().createFolder(project.id, "F")
      const wf = useProjectsStore.getState().createWorkflow(project.id, "Original", folder.id)

      const copy = useProjectsStore.getState().duplicateWorkflow(wf.id)

      expect(copy).not.toBeNull()
      expect(copy!.name).toBe("Original (Copy)")
      expect(copy!.projectId).toBe(project.id)
      expect(copy!.folderId).toBe(folder.id)
      expect(copy!.id).not.toBe(wf.id)
      expect(useProjectsStore.getState().workflowMetas).toHaveLength(2)
    })

    it("returns null when duplicating non-existent workflow", () => {
      const result = useProjectsStore.getState().duplicateWorkflow("nonexistent")
      expect(result).toBeNull()
    })
  })
})
