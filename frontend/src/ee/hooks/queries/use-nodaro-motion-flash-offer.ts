/**
 * Admin → Video Remake's Offer Flash: per engine, whether every user may pick
 * its Flash choice (Nodaro Prism Flash, Nodaro Pulse Flash) at its own price
 * (GET/PUT /v1/admin/video-remake/flash-offer). Never saved = off for every
 * engine. A section of the stored settings sets, so the page reads it with the
 * others.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { hasAdmin } from "@/lib/edition"
import { queryKeys } from "@/lib/query-keys"
import { fetchNodaroMotionFlashOffer, saveNodaroMotionFlashOffer } from "@/lib/api"

export function useNodaroMotionFlashOffer() {
  return useQuery({
    queryKey: queryKeys.admin.nodaroMotionFlashOffer(),
    queryFn: fetchNodaroMotionFlashOffer,
    enabled: hasAdmin(),
    staleTime: 30_000,
  })
}

export function useSaveNodaroMotionFlashOffer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: saveNodaroMotionFlashOffer,
    onSuccess: (view) => {
      qc.setQueryData(queryKeys.admin.nodaroMotionFlashOffer(), view)
    },
  })
}
