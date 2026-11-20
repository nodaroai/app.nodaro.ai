/**
 * Admin → Video Remake's shot-list frame rate: how many frames a second the
 * model that writes a run's shot list is shown of the clip
 * (GET/PUT /v1/admin/video-remake/shot-list-fps). Never saved = the engine's
 * own default, the recommended rate.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { hasAdmin } from "@/lib/edition"
import { queryKeys } from "@/lib/query-keys"
import { fetchNodaroMotionShotListFps, saveNodaroMotionShotListFps } from "@/lib/api"

export function useNodaroMotionShotListFps() {
  return useQuery({
    queryKey: queryKeys.admin.nodaroMotionShotListFps(),
    queryFn: fetchNodaroMotionShotListFps,
    enabled: hasAdmin(),
    staleTime: 30_000,
  })
}

export function useSaveNodaroMotionShotListFps() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: saveNodaroMotionShotListFps,
    onSuccess: (view) => {
      qc.setQueryData(queryKeys.admin.nodaroMotionShotListFps(), view)
    },
  })
}
