/**
 * Admin → Provider safety: GET/PUT /v1/admin/provider-safety. A save answers
 * with the whole page as saved, which replaces the cached one.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { hasAdmin } from "@/lib/edition"
import { fetchProviderSafety, saveProviderSafety } from "@/ee/lib/provider-safety-api"

export const PROVIDER_SAFETY_KEY = ["admin", "provider-safety"] as const

export function useProviderSafety() {
  return useQuery({
    queryKey: PROVIDER_SAFETY_KEY,
    queryFn: fetchProviderSafety,
    enabled: hasAdmin(),
    staleTime: 30_000,
  })
}

export function useSaveProviderSafety() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: saveProviderSafety,
    onSuccess: (view) => {
      qc.setQueryData(PROVIDER_SAFETY_KEY, view)
    },
  })
}
