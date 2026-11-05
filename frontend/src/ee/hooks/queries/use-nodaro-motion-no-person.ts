/**
 * Admin → Nodaro Motion's no-person setting: per engine, whether a direct
 * Precise run with no person role with pictures sends its clip as it is — on
 * (the default) or `sourceClip: false` (GET/PUT /v1/admin/nodaro-motion/no-person).
 * Never saved (`noPerson: null`) = the default on every engine.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { hasAdmin } from "@/lib/edition"
import { queryKeys } from "@/lib/query-keys"
import { fetchNodaroMotionNoPerson, saveNodaroMotionNoPerson } from "@/lib/api"

export function useNodaroMotionNoPerson() {
  return useQuery({
    queryKey: queryKeys.admin.nodaroMotionNoPerson(),
    queryFn: fetchNodaroMotionNoPerson,
    enabled: hasAdmin(),
    staleTime: 30_000,
  })
}

export function useSaveNodaroMotionNoPerson() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: saveNodaroMotionNoPerson,
    onSuccess: (view) => {
      qc.setQueryData(queryKeys.admin.nodaroMotionNoPerson(), view)
    },
  })
}
