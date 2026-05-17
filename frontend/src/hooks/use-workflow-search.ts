import { useEffect, useRef, useState } from "react"
import { createClient } from "@/lib/supabase"
import type { WorkflowMeta } from "@/hooks/use-projects-store"

export interface WorkflowSearchResult extends WorkflowMeta {
  readonly projectName: string
}

/**
 * Debounced workflow name search used by the "My Projects" tab on the
 * dashboard. Runs against Supabase JS directly (relies on RLS to scope to
 * the caller) and joins each result against the in-memory `projectMap`
 * so the card can render the owning project. Returns empty results until
 * the user types ≥ 2 characters.
 */
export function useWorkflowSearch(search: string, projectMap: Map<string, string>) {
  const [results, setResults] = useState<WorkflowSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const projectMapRef = useRef(projectMap)
  projectMapRef.current = projectMap

  useEffect(() => {
    if (search.length < 2) {
      setResults([])
      return
    }

    let cancelled = false
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const supabase = createClient()
        const { data, error } = await supabase
          .from("workflows")
          .select("id, project_id, folder_id, name, thumbnail_url, created_at, updated_at")
          .ilike("name", `%${search}%`)
          .order("updated_at", { ascending: false })
          .limit(20)

        if (error || cancelled) return

        const map = projectMapRef.current
        setResults(
          data.map((row) => ({
            id: row.id,
            projectId: row.project_id,
            folderId: row.folder_id ?? null,
            name: row.name,
            thumbnailUrl: row.thumbnail_url ?? null,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            projectName: map.get(row.project_id) ?? "Unknown Project",
          })),
        )
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 300)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [search])

  return { results, loading }
}
