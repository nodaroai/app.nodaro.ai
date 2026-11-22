/**
 * Admin → Video Remake's Precise upscale: per output resolution, the Topaz target
 * a direct Prism Precise run's take is upscaled to before it is scaled back
 * (GET/PUT /v1/admin/video-remake/precise-upscale). Never saved
 * (`stored: null`) = every resolution at its default.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { hasAdmin } from "@/lib/edition"
import { queryKeys } from "@/lib/query-keys"
import { fetchNodaroMotionPreciseUpscale, saveNodaroMotionPreciseUpscale } from "@/lib/api"

export function useNodaroMotionPreciseUpscale() {
  return useQuery({
    queryKey: queryKeys.admin.nodaroMotionPreciseUpscale(),
    queryFn: fetchNodaroMotionPreciseUpscale,
    enabled: hasAdmin(),
    staleTime: 30_000,
  })
}

export function useSaveNodaroMotionPreciseUpscale() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: saveNodaroMotionPreciseUpscale,
    onSuccess: (view) => {
      qc.setQueryData(queryKeys.admin.nodaroMotionPreciseUpscale(), view)
    },
  })
}
