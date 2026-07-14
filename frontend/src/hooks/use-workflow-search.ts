import { useEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { createClient } from "@/lib/supabase"
import type { WorkflowMeta } from "@/hooks/use-projects-store"
import {
  fetchListedAppSlugs,
  readShowClientAppsFlag,
  workflowVisibilityFilter,
} from "@/hooks/queries/use-client-apps-queries"

export interface WorkflowSearchResult extends WorkflowMeta {
  readonly projectName: string
}

/**
 * Debounced workflow name search used by the "My Projects" tab on the
 * dashboard. Runs against Supabase JS directly (relies on RLS to scope to
 * the caller) and joins each result against the in-memory `projectMap`
 * so the card can render the owning project. Returns empty results until
 * the user types ≥ 2 characters.
 *
 * VISIBILITY: the SAME rule as the dashboard lists — native OR a listed client
 * app — so a voice-changer-pro user typing two characters never sees their
 * conversions here. Lifted only by the admin "show client-app content" flag.
 */
export function useWorkflowSearch(search: string, projectMap: Map<string, string>) {
  const [results, setResults] = useState<WorkflowSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const projectMapRef = useRef(projectMap)
  projectMapRef.current = projectMap
  const queryClient = useQueryClient()

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

        // Native-only by default (app_slug IS NULL OR a listed app); an admin can
        // reveal client-app rows via the flag. workflows.app_slug predates this
        // work (migration 253), so no pre-migration fallback is needed.
        const showAll = readShowClientAppsFlag()
        const listed = showAll ? [] : await fetchListedAppSlugs(queryClient)

        let query = supabase
          .from("workflows")
          .select("id, project_id, folder_id, name, thumbnail_url, created_at, updated_at")
          .ilike("name", `%${search}%`)
          .order("updated_at", { ascending: false })
          .limit(20)
        if (!showAll) query = query.or(workflowVisibilityFilter(listed))
        const { data, error } = await query

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
  }, [search, queryClient])

  return { results, loading }
}
