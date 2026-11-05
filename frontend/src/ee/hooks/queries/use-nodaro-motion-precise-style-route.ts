/**
 * Admin → Nodaro Motion's Precise art-style route: whether a direct Prism Precise
 * run with an art style runs as Flex, and the accounts that skip it
 * (GET/PUT /v1/admin/nodaro-motion/precise-style-route). Never saved
 * (`preciseStyleRoute: null`) = routing on, nobody bypassed.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { hasAdmin } from "@/lib/edition"
import { queryKeys } from "@/lib/query-keys"
import { fetchNodaroMotionPreciseStyleRoute, saveNodaroMotionPreciseStyleRoute } from "@/lib/api"

export function useNodaroMotionPreciseStyleRoute() {
  return useQuery({
    queryKey: queryKeys.admin.nodaroMotionPreciseStyleRoute(),
    queryFn: fetchNodaroMotionPreciseStyleRoute,
    enabled: hasAdmin(),
    staleTime: 30_000,
  })
}

export function useSaveNodaroMotionPreciseStyleRoute() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: saveNodaroMotionPreciseStyleRoute,
    onSuccess: (view) => {
      qc.setQueryData(queryKeys.admin.nodaroMotionPreciseStyleRoute(), view)
    },
  })
}
