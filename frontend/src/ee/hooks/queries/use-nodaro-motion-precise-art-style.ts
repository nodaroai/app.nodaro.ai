/**
 * Admin → Nodaro Motion's Precise art-style setting: per engine, how a direct
 * Precise run with an art style opens its prompt — "restyle" (the default) or
 * the edit opener of before (GET/PUT /v1/admin/nodaro-motion/precise-art-style).
 * Never saved (`preciseArtStyle: null`) = the default on every engine.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { hasAdmin } from "@/lib/edition"
import { queryKeys } from "@/lib/query-keys"
import { fetchNodaroMotionPreciseArtStyle, saveNodaroMotionPreciseArtStyle } from "@/lib/api"

export function useNodaroMotionPreciseArtStyle() {
  return useQuery({
    queryKey: queryKeys.admin.nodaroMotionPreciseArtStyle(),
    queryFn: fetchNodaroMotionPreciseArtStyle,
    enabled: hasAdmin(),
    staleTime: 30_000,
  })
}

export function useSaveNodaroMotionPreciseArtStyle() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: saveNodaroMotionPreciseArtStyle,
    onSuccess: (view) => {
      qc.setQueryData(queryKeys.admin.nodaroMotionPreciseArtStyle(), view)
    },
  })
}
