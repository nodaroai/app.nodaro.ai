/**
 * Admin → Video Remake's face grow: per engine, how far a direct Precise run's
 * face mask is widened onto the face's own skin (GET/PUT
 * /v1/admin/video-remake/face-grow). Never saved = no engine grows.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { hasAdmin } from "@/lib/edition"
import { queryKeys } from "@/lib/query-keys"
import { fetchNodaroMotionFaceGrow, saveNodaroMotionFaceGrow } from "@/lib/api"

export function useNodaroMotionFaceGrow() {
  return useQuery({
    queryKey: queryKeys.admin.nodaroMotionFaceGrow(),
    queryFn: fetchNodaroMotionFaceGrow,
    enabled: hasAdmin(),
    staleTime: 30_000,
  })
}

export function useSaveNodaroMotionFaceGrow() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: saveNodaroMotionFaceGrow,
    onSuccess: (view) => {
      qc.setQueryData(queryKeys.admin.nodaroMotionFaceGrow(), view)
    },
  })
}
