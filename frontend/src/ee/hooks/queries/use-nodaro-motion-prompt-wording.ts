/**
 * Admin → Nodaro Motion's Flex prompt wording: per engine, how every direct
 * Flex run's prompt is worded, the current wording or the new one
 * (GET/PUT /v1/admin/nodaro-motion/prompt-wording). Never saved
 * (`promptWording: null`) = the current wording on every engine.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { hasAdmin } from "@/lib/edition"
import { queryKeys } from "@/lib/query-keys"
import { fetchNodaroMotionPromptWording, saveNodaroMotionPromptWording } from "@/lib/api"

export function useNodaroMotionPromptWording() {
  return useQuery({
    queryKey: queryKeys.admin.nodaroMotionPromptWording(),
    queryFn: fetchNodaroMotionPromptWording,
    enabled: hasAdmin(),
    staleTime: 30_000,
  })
}

export function useSaveNodaroMotionPromptWording() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: saveNodaroMotionPromptWording,
    onSuccess: (view) => {
      qc.setQueryData(queryKeys.admin.nodaroMotionPromptWording(), view)
    },
  })
}
