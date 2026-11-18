/**
 * Admin → Video Remake's Pulse reference audio: what audio the clip of every
 * Pulse run people start themselves sends to the video model
 * (GET/PUT /v1/admin/video-remake/pulse-reference-audio).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { hasAdmin } from "@/lib/edition"
import { queryKeys } from "@/lib/query-keys"
import { fetchNodaroMotionPulseReferenceAudio, saveNodaroMotionPulseReferenceAudio } from "@/lib/api"

export function useNodaroMotionPulseReferenceAudio() {
  return useQuery({
    queryKey: queryKeys.admin.nodaroMotionPulseReferenceAudio(),
    queryFn: fetchNodaroMotionPulseReferenceAudio,
    enabled: hasAdmin(),
    staleTime: 30_000,
  })
}

export function useSaveNodaroMotionPulseReferenceAudio() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: saveNodaroMotionPulseReferenceAudio,
    onSuccess: (view) => {
      qc.setQueryData(queryKeys.admin.nodaroMotionPulseReferenceAudio(), view)
    },
  })
}
