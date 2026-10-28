/**
 * Admin → Nodaro Motion's Pulse audio: what sound every Pulse run people
 * start themselves delivers (GET/PUT /v1/admin/nodaro-motion/pulse-audio).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { hasAdmin } from "@/lib/edition"
import { queryKeys } from "@/lib/query-keys"
import { fetchNodaroMotionPulseAudio, saveNodaroMotionPulseAudio } from "@/lib/api"

export function useNodaroMotionPulseAudio() {
  return useQuery({
    queryKey: queryKeys.admin.nodaroMotionPulseAudio(),
    queryFn: fetchNodaroMotionPulseAudio,
    enabled: hasAdmin(),
    staleTime: 30_000,
  })
}

export function useSaveNodaroMotionPulseAudio() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: saveNodaroMotionPulseAudio,
    onSuccess: (view) => {
      qc.setQueryData(queryKeys.admin.nodaroMotionPulseAudio(), view)
    },
  })
}
