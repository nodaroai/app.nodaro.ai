import { useQuery } from "@tanstack/react-query"
import { createClient } from "@/lib/supabase"
import { getAuthHeaders } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"

export interface Project {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly isDefault: boolean
  readonly createdAt: string
  readonly updatedAt: string
  readonly userId?: string
  readonly ownerEmail?: string
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

function toProject(row: Record<string, unknown>): Project {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) ?? "",
    isDefault: (row.is_default ?? row.isDefault) === true,
    createdAt: (row.created_at ?? row.createdAt) as string,
    updatedAt: (row.updated_at ?? row.updatedAt) as string,
    userId: (row.user_id ?? row.userId) as string | undefined,
    ownerEmail: row.ownerEmail as string | undefined,
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

export function useProjects() {
  return useQuery({
    queryKey: queryKeys.projects.list(),
    queryFn: async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      let query = supabase
        .from("projects")
        .select("*")
        .order("created_at", { ascending: false })
      if (user) {
        query = query.eq("user_id", user.id)
      }
      const { data, error } = await query
      if (error) throw error
      return data.map(toProject)
    },
    staleTime: 30_000,
  })
}

export interface AllProjectsResult {
  readonly projects: Project[]
  readonly currentUserId: string
}

export function useAllProjects(enabled: boolean) {
  return useQuery({
    queryKey: [...queryKeys.projects.all, "all-admin"] as const,
    queryFn: async (): Promise<AllProjectsResult> => {
      const res = await fetch(`/v1/projects?viewAll=true`, {
        headers: await getAuthHeaders(),
      })
      if (!res.ok) throw new Error("Failed to fetch all projects")
      const json = await res.json()
      return {
        projects: (json.data as Record<string, unknown>[]).map(toProject),
        currentUserId: json.currentUserId as string,
      }
    },
    enabled,
    staleTime: 30_000,
  })
}

export function useProject(projectId: string | undefined) {
  return useQuery({
    queryKey: [...queryKeys.projects.all, "single", projectId ?? ""] as const,
    queryFn: async (): Promise<Project | null> => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .eq("id", projectId!)
        .single()
      if (error) {
        if (error.code === "PGRST116") return null
        throw error
      }
      return toProject(data)
    },
    enabled: !!projectId,
    staleTime: 30_000,
  })
}

export function useProjectData(projectId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.projects.detail(projectId ?? ""),
    queryFn: async () => {
      const supabase = createClient()
      const [foldersRes, workflowsRes] = await Promise.all([
        supabase
          .from("folders")
          .select("*")
          .eq("project_id", projectId!)
          .order("created_at"),
        supabase
          .from("workflows")
          .select("id, project_id, folder_id, name, created_at, updated_at")
          .eq("project_id", projectId!)
          .order("created_at", { ascending: false }),
      ])
      if (foldersRes.error) throw foldersRes.error
      if (workflowsRes.error) throw workflowsRes.error
      return {
        folders: foldersRes.data.map(toFolder),
        workflowMetas: workflowsRes.data.map(toWorkflowMeta),
      }
    },
    enabled: !!projectId,
    staleTime: 30_000,
  })
}
