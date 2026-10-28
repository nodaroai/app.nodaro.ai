/**
 * Admin → Nodaro Motion's Prism reference audio: what audio the reference
 * video of every Prism run people start themselves carries
 * (GET/PUT /v1/admin/nodaro-motion/prism-reference-audio).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { hasAdmin } from "@/lib/edition"
import { queryKeys } from "@/lib/query-keys"
import { fetchNodaroMotionPrismReferenceAudio, saveNodaroMotionPrismReferenceAudio } from "@/lib/api"

export function useNodaroMotionPrismReferenceAudio() {
  return useQuery({
    queryKey: queryKeys.admin.nodaroMotionPrismReferenceAudio(),
    queryFn: fetchNodaroMotionPrismReferenceAudio,
    enabled: hasAdmin(),
    staleTime: 30_000,
  })
}

export function useSaveNodaroMotionPrismReferenceAudio() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: saveNodaroMotionPrismReferenceAudio,
    onSuccess: (view) => {
      qc.setQueryData(queryKeys.admin.nodaroMotionPrismReferenceAudio(), view)
    },
  })
}
