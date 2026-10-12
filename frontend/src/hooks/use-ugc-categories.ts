import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { ugcCategoriesApi } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"

/** One product category a sampled UGC creator can be drawn for: the id the node stores and the label shown. */
export interface UgcCategory {
  readonly id: string
  readonly label: string
}

/**
 * The route's answer, read untrusted: each entry's id and label, in the
 * route's order. An entry with no id is dropped, one with no label shows its
 * id, and a repeated id is shown once. Anything else is an empty list.
 */
export function readUgcCategories(raw: unknown): UgcCategory[] {
  const list = raw && typeof raw === "object" ? (raw as { categories?: unknown }).categories : undefined
  if (!Array.isArray(list)) return []
  const seen = new Set<string>()
  const out: UgcCategory[] = []
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue
    const { id, label } = entry as { id?: unknown; label?: unknown }
    if (typeof id !== "string" || id === "" || seen.has(id)) continue
    seen.add(id)
    out.push({ id, label: typeof label === "string" && label !== "" ? label : id })
  }
  return out
}

/**
 * The product categories for UGC Creator's override, fetched when its panel
 * opens: the list is the plugin's own (`GET /v1/ugc/categories`, free), so it
 * never sits in the app. Where the route is not served the list is empty and
 * the panel offers only "From the script"; nothing is retried or reported.
 */
export function useUgcCategories(): readonly UgcCategory[] {
  const { data } = useQuery({
    queryKey: queryKeys.ugc.categories(),
    queryFn: ugcCategoriesApi,
    staleTime: 30 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  })
  return useMemo(() => readUgcCategories(data), [data])
}
