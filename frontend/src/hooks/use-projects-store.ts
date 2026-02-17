import { create } from "zustand"
import { createClient } from "@/lib/supabase"
import { queryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"

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
  readonly loading: boolean
  readonly error: string | null

  readonly fetchProjects: () => Promise<void>
  readonly fetchProjectData: (projectId: string) => Promise<void>

  readonly createProject: (name: string, description?: string) => Promise<Project | null>
  readonly deleteProject: (id: string) => Promise<void>
  readonly updateProject: (id: string, updates: { name?: string; description?: string }) => Promise<void>

  readonly createFolder: (projectId: string, name: string) => Promise<Folder | null>
  readonly renameFolder: (id: string, name: string) => Promise<void>
  readonly deleteFolder: (id: string) => Promise<void>

  readonly createWorkflow: (projectId: string, name: string, folderId?: string | null) => Promise<WorkflowMeta | null>
  readonly deleteWorkflow: (id: string) => Promise<void>
  readonly renameWorkflow: (id: string, name: string) => Promise<void>
  readonly moveWorkflow: (id: string, folderId: string | null) => Promise<void>
  readonly duplicateWorkflow: (id: string) => Promise<WorkflowMeta | null>
}

function toProject(row: Record<string, unknown>): Project {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) ?? "",
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

function toFolder(row: Record<string, unknown>): Folder {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    name: row.name as string,
    createdAt: row.created_at as string,
  }
}

function toWorkflowMeta(row: Record<string, unknown>): WorkflowMeta {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    folderId: (row.folder_id as string) ?? null,
    name: row.name as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

export const useProjectsStore = create<ProjectsState>((set, get) => ({
  projects: [],
  folders: [],
  workflowMetas: [],
  loading: false,
  error: null,

  fetchProjects: async () => {
    set({ loading: true, error: null })
    try {
      const supabase = createClient()
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .order("created_at", { ascending: false })

      if (error) {
        set({ error: error.message, loading: false })
        return
      }
      set({ projects: data.map(toProject), loading: false })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Failed to fetch projects", loading: false })
    }
  },

  fetchProjectData: async (projectId: string) => {
    set({ loading: true, error: null })
    try {
      const supabase = createClient()

      const [foldersRes, workflowsRes] = await Promise.all([
        supabase
          .from("folders")
          .select("*")
          .eq("project_id", projectId)
          .order("created_at"),
        supabase
          .from("workflows")
          .select("id, project_id, folder_id, name, created_at, updated_at")
          .eq("project_id", projectId)
          .order("created_at", { ascending: false }),
      ])

      if (foldersRes.error) {
        set({ error: foldersRes.error.message, loading: false })
        return
      }
      if (workflowsRes.error) {
        set({ error: workflowsRes.error.message, loading: false })
        return
      }

      set({
        folders: foldersRes.data.map(toFolder),
        workflowMetas: workflowsRes.data.map(toWorkflowMeta),
        loading: false,
      })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Failed to fetch project data", loading: false })
    }
  },

  createProject: async (name, description = "") => {
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return null

      const { data, error } = await supabase
        .from("projects")
        .insert({ name, description, user_id: user.id })
        .select()
        .single()

      if (error || !data) return null

      const project = toProject(data)
      set((s) => ({ projects: [project, ...s.projects] }))
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.all })
      return project
    } catch {
      return null
    }
  },

  deleteProject: async (id) => {
    try {
      const supabase = createClient()
      const { error } = await supabase.from("projects").delete().eq("id", id)
      if (error) return

      set((s) => ({
        projects: s.projects.filter((p) => p.id !== id),
        folders: s.folders.filter((f) => f.projectId !== id),
        workflowMetas: s.workflowMetas.filter((w) => w.projectId !== id),
      }))
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.all })
    } catch {
      // silent
    }
  },

  updateProject: async (id, updates) => {
    try {
      const supabase = createClient()
      const { error } = await supabase.from("projects").update(updates).eq("id", id)
      if (error) return

      set((s) => ({
        projects: s.projects.map((p) =>
          p.id === id ? { ...p, ...updates, updatedAt: new Date().toISOString() } : p,
        ),
      }))
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.all })
    } catch {
      // silent
    }
  },

  createFolder: async (projectId, name) => {
    try {
      const supabase = createClient()
      const { data, error } = await supabase
        .from("folders")
        .insert({ project_id: projectId, name })
        .select()
        .single()

      if (error || !data) return null

      const folder = toFolder(data)
      set((s) => ({ folders: [...s.folders, folder] }))
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.all })
      return folder
    } catch {
      return null
    }
  },

  renameFolder: async (id, name) => {
    try {
      const supabase = createClient()
      const { error } = await supabase.from("folders").update({ name }).eq("id", id)
      if (error) return

      set((s) => ({
        folders: s.folders.map((f) => (f.id === id ? { ...f, name } : f)),
      }))
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.all })
    } catch {
      // silent
    }
  },

  deleteFolder: async (id) => {
    try {
      const supabase = createClient()
      const { error } = await supabase.from("folders").delete().eq("id", id)
      if (error) return

      set((s) => ({
        folders: s.folders.filter((f) => f.id !== id),
        workflowMetas: s.workflowMetas.map((w) =>
          w.folderId === id ? { ...w, folderId: null } : w,
        ),
      }))
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.all })
    } catch {
      // silent
    }
  },

  createWorkflow: async (projectId, name, folderId = null) => {
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return null

      const { data, error } = await supabase
        .from("workflows")
        .insert({
          project_id: projectId,
          user_id: user.id,
          folder_id: folderId,
          name,
        })
        .select("id, project_id, folder_id, name, created_at, updated_at")
        .single()

      if (error || !data) return null

      const wf = toWorkflowMeta(data)
      set((s) => ({ workflowMetas: [wf, ...s.workflowMetas] }))
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.all })
      return wf
    } catch {
      return null
    }
  },

  deleteWorkflow: async (id) => {
    try {
      const supabase = createClient()
      const { error } = await supabase.from("workflows").delete().eq("id", id)
      if (error) return

      set((s) => ({
        workflowMetas: s.workflowMetas.filter((w) => w.id !== id),
      }))
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.all })
    } catch {
      // silent
    }
  },

  renameWorkflow: async (id, name) => {
    try {
      const supabase = createClient()
      const { error } = await supabase.from("workflows").update({ name }).eq("id", id)
      if (error) return

      set((s) => ({
        workflowMetas: s.workflowMetas.map((w) =>
          w.id === id ? { ...w, name, updatedAt: new Date().toISOString() } : w,
        ),
      }))
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.all })
    } catch {
      // silent
    }
  },

  moveWorkflow: async (id, folderId) => {
    try {
      const supabase = createClient()
      const { error } = await supabase
        .from("workflows")
        .update({ folder_id: folderId })
        .eq("id", id)
      if (error) return

      set((s) => ({
        workflowMetas: s.workflowMetas.map((w) =>
          w.id === id ? { ...w, folderId, updatedAt: new Date().toISOString() } : w,
        ),
      }))
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.all })
    } catch {
      // silent
    }
  },

  duplicateWorkflow: async (id) => {
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return null

      // Fetch original workflow with nodes/edges
      const { data: original, error: fetchError } = await supabase
        .from("workflows")
        .select("*")
        .eq("id", id)
        .single()

      if (fetchError || !original) return null

      const { data, error } = await supabase
        .from("workflows")
        .insert({
          project_id: original.project_id,
          user_id: user.id,
          folder_id: original.folder_id,
          name: `${original.name} (Copy)`,
          nodes: original.nodes,
          edges: original.edges,
          settings: original.settings,
        })
        .select("id, project_id, folder_id, name, created_at, updated_at")
        .single()

      if (error || !data) return null

      const wf = toWorkflowMeta(data)
      set((s) => ({ workflowMetas: [wf, ...s.workflowMetas] }))
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.all })
      return wf
    } catch {
      return null
    }
  },
}))
