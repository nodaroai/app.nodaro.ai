/**
 * Which models an admin has forced the content filter on for
 * (`GET /v1/provider-safety/locks`): the node's filter checkbox is shown on and
 * locked for those. A filter off by default stays the node's own choice.
 */
import { useQuery } from "@tanstack/react-query"
import { getAuthHeaders } from "@/lib/api"

export function useProviderSafetyLocks() {
  return useQuery({
    queryKey: ["provider-safety-locks"] as const,
    queryFn: async (): Promise<readonly string[]> => {
      const res = await fetch("/v1/provider-safety/locks", { headers: await getAuthHeaders() })
      if (!res.ok) return []
      const body = (await res.json()) as { forcedOn?: readonly string[] }
      return body.forcedOn ?? []
    },
    staleTime: 60_000,
    retry: false,
  })
}

/** True when an admin has forced this model's filter on. */
export function useFilterForcedOn(provider: string | undefined): boolean {
  const { data } = useProviderSafetyLocks()
  return !!provider && (data ?? []).includes(provider)
}
