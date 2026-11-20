/**
 * Admin → Video Remake's shot lock: per engine, whether a direct run's prompt
 * on an ordinary clip carries the line that keeps the shot order and adds no
 * shot (GET/PUT /v1/admin/video-remake/shot-lock). Never saved = off for
 * every engine.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { hasAdmin } from "@/lib/edition"
import { queryKeys } from "@/lib/query-keys"
import { fetchNodaroMotionShotLock, saveNodaroMotionShotLock } from "@/lib/api"

export function useNodaroMotionShotLock() {
  return useQuery({
    queryKey: queryKeys.admin.nodaroMotionShotLock(),
    queryFn: fetchNodaroMotionShotLock,
    enabled: hasAdmin(),
    staleTime: 30_000,
  })
}

export function useSaveNodaroMotionShotLock() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: saveNodaroMotionShotLock,
    onSuccess: (view) => {
      qc.setQueryData(queryKeys.admin.nodaroMotionShotLock(), view)
    },
  })
}
