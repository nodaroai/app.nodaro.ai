/**
 * Admin → Video Remake's Advanced switch: whether the Video Remake page
 * shows its Advanced chip (Prepare references and the pre-prompt), one switch
 * for the whole page (GET/PUT /v1/admin/video-remake/advanced). Never saved
 * (`updatedAt: null`) = hidden.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { hasAdmin } from "@/lib/edition"
import { queryKeys } from "@/lib/query-keys"
import { fetchNodaroMotionAdvanced, saveNodaroMotionAdvanced } from "@/lib/api"

export function useNodaroMotionAdvanced() {
  return useQuery({
    queryKey: queryKeys.admin.nodaroMotionAdvanced(),
    queryFn: fetchNodaroMotionAdvanced,
    enabled: hasAdmin(),
    staleTime: 30_000,
  })
}

export function useSaveNodaroMotionAdvanced() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: saveNodaroMotionAdvanced,
    onSuccess: (view) => {
      qc.setQueryData(queryKeys.admin.nodaroMotionAdvanced(), view)
    },
  })
}
