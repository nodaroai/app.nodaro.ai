import { useQuery } from "@tanstack/react-query"
import { API_BASE_URL } from "@/lib/api"
import { makerLogoMap, type ModelMakersBody } from "@/lib/maker-logos"
import { queryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"

const NONE: ReadonlyMap<string, string> = new Map()

async function fetchMakerLogos(): Promise<ReadonlyMap<string, string>> {
  // Public read, no auth: the same answer any API client gets.
  const res = await fetch(`${API_BASE_URL}/v1/model-makers`)
  if (!res.ok) return NONE
  return makerLogoMap((await res.json()) as ModelMakersBody)
}

/**
 * Maker id -> the mark this instance publishes for it, read once per session.
 * Empty while loading, on an error, and on an instance that publishes no
 * marks — the picker then draws each maker's initial. Bound to the app's
 * query client explicitly, so a picker rendered outside the provider (tests,
 * portals) still works.
 */
export function useMakerLogoUrls(): ReadonlyMap<string, string> {
  const { data } = useQuery(
    {
      queryKey: queryKeys.makerLogos(),
      queryFn: fetchMakerLogos,
      staleTime: 30 * 60_000,
      gcTime: 60 * 60_000,
      retry: 1,
    },
    queryClient,
  )
  return data ?? NONE
}
