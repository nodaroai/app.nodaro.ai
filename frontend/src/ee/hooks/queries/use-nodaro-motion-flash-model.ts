/**
 * Admin → Video Remake's flash-model test: per engine, a test switch that
 * makes new runs on the faster model of the same family
 * (GET/PUT /v1/admin/video-remake/flash-model). Never saved = off for every
 * engine. Read only while its block on the page is open (`enabled`).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { hasAdmin } from "@/lib/edition"
import { queryKeys } from "@/lib/query-keys"
import { fetchNodaroMotionFlashModel, saveNodaroMotionFlashModel } from "@/lib/api"

export function useNodaroMotionFlashModel(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.admin.nodaroMotionFlashModel(),
    queryFn: fetchNodaroMotionFlashModel,
    enabled: enabled && hasAdmin(),
    staleTime: 30_000,
  })
}

export function useSaveNodaroMotionFlashModel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: saveNodaroMotionFlashModel,
    onSuccess: (view) => {
      qc.setQueryData(queryKeys.admin.nodaroMotionFlashModel(), view)
    },
  })
}
