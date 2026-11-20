/**
 * Admin → Video Remake's 3D previz clips: whether this deployment accepts a
 * run whose clip is a 3D previz, rendered into its look instead of edited
 * (GET/PUT /v1/admin/video-remake/previz). Never saved = the deployment's
 * default.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { hasAdmin } from "@/lib/edition"
import { queryKeys } from "@/lib/query-keys"
import { fetchNodaroMotionPreviz, saveNodaroMotionPreviz } from "@/lib/api"

export function useNodaroMotionPreviz() {
  return useQuery({
    queryKey: queryKeys.admin.nodaroMotionPreviz(),
    queryFn: fetchNodaroMotionPreviz,
    enabled: hasAdmin(),
    staleTime: 30_000,
  })
}

export function useSaveNodaroMotionPreviz() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: saveNodaroMotionPreviz,
    onSuccess: (view) => {
      qc.setQueryData(queryKeys.admin.nodaroMotionPreviz(), view)
    },
  })
}
