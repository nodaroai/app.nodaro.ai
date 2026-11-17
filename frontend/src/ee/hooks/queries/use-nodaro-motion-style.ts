/**
 * Admin → Video Remake's Style choice: per engine, whether people choose a
 * direct run's style or it is Precise in Video Remake / always Flex
 * (GET/PUT /v1/admin/video-remake/style). Never saved (`style: null`) =
 * people choose on every engine.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { hasAdmin } from "@/lib/edition"
import { queryKeys } from "@/lib/query-keys"
import { fetchNodaroMotionStyle, saveNodaroMotionStyle } from "@/lib/api"

export function useNodaroMotionStyle() {
  return useQuery({
    queryKey: queryKeys.admin.nodaroMotionStyle(),
    queryFn: fetchNodaroMotionStyle,
    enabled: hasAdmin(),
    staleTime: 30_000,
  })
}

export function useSaveNodaroMotionStyle() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: saveNodaroMotionStyle,
    onSuccess: (view) => {
      qc.setQueryData(queryKeys.admin.nodaroMotionStyle(), view)
    },
  })
}
