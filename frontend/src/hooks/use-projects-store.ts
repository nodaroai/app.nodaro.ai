import { create } from "zustand"
import { persist } from "zustand/middleware"

export interface Project {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface Folder {
  readonly id: string
  readonly projectId: string
  readonly name: string
  readonly createdAt: string
}

export interface WorkflowMeta {
  readonly id: string
  readonly projectId: string
  readonly folderId: string | null
  readonly name: string
  readonly createdAt: string
  readonly updatedAt: string
}

interface ProjectsState {
  readonly projects: Project[]
  readonly folders: Folder[]
  readonly workflowMetas: WorkflowMeta[]

  readonly createProject: (name: string, description?: string) => Project
  readonly deleteProject: (id: string) => void
  readonly updateProject: (id: string, updates: { name?: string; description?: string }) => void

  readonly createFolder: (projectId: string, name: string) => Folder
  readonly renameFolder: (id: string, name: string) => void
  readonly deleteFolder: (id: string) => void

  readonly createWorkflow: (projectId: string, name: string, folderId?: string | null) => WorkflowMeta
  readonly deleteWorkflow: (id: string) => void
  readonly renameWorkflow: (id: string, name: string) => void
  readonly moveWorkflow: (id: string, folderId: string | null) => void
  readonly duplicateWorkflow: (id: string) => WorkflowMeta | null
}

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function nowIso(): string {
  return new Date().toISOString()
}

export const useProjectsStore = create<ProjectsState>()(
  persist(
    (set, get) => ({
      projects: [],
      folders: [],
      workflowMetas: [],

      createProject: (name, description = "") => {
        const project: Project = {
          id: generateId("proj"),
          name,
          description,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        }
        set((s) => ({ projects: [...s.projects, project] }))
        return project
      },

      deleteProject: (id) =>
        set((s) => ({
          projects: s.projects.filter((p) => p.id !== id),
          folders: s.folders.filter((f) => f.projectId !== id),
          workflowMetas: s.workflowMetas.filter((w) => w.projectId !== id),
        })),

      updateProject: (id, updates) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === id ? { ...p, ...updates, updatedAt: nowIso() } : p,
          ),
        })),

      createFolder: (projectId, name) => {
        const folder: Folder = {
          id: generateId("folder"),
          projectId,
          name,
          createdAt: nowIso(),
        }
        set((s) => ({ folders: [...s.folders, folder] }))
        return folder
      },

      renameFolder: (id, name) =>
        set((s) => ({
          folders: s.folders.map((f) => (f.id === id ? { ...f, name } : f)),
        })),

      deleteFolder: (id) =>
        set((s) => ({
          folders: s.folders.filter((f) => f.id !== id),
          workflowMetas: s.workflowMetas.map((w) =>
            w.folderId === id ? { ...w, folderId: null } : w,
          ),
        })),

      createWorkflow: (projectId, name, folderId = null) => {
        const wf: WorkflowMeta = {
          id: generateId("wf"),
          projectId,
          folderId: folderId ?? null,
          name,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        }
        set((s) => ({ workflowMetas: [...s.workflowMetas, wf] }))
        return wf
      },

      deleteWorkflow: (id) =>
        set((s) => ({
          workflowMetas: s.workflowMetas.filter((w) => w.id !== id),
        })),

      renameWorkflow: (id, name) =>
        set((s) => ({
          workflowMetas: s.workflowMetas.map((w) =>
            w.id === id ? { ...w, name, updatedAt: nowIso() } : w,
          ),
        })),

      moveWorkflow: (id, folderId) =>
        set((s) => ({
          workflowMetas: s.workflowMetas.map((w) =>
            w.id === id ? { ...w, folderId, updatedAt: nowIso() } : w,
          ),
        })),

      duplicateWorkflow: (id) => {
        const source = get().workflowMetas.find((w) => w.id === id)
        if (!source) return null
        const copy: WorkflowMeta = {
          id: generateId("wf"),
          projectId: source.projectId,
          folderId: source.folderId,
          name: `${source.name} (Copy)`,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        }
        set((s) => ({ workflowMetas: [...s.workflowMetas, copy] }))
        return copy
      },
    }),
    { name: "scenenode-projects" },
  ),
)
