/**
 * Admin → Nodaro Motion's Motion setting: per engine, how a run people start
 * themselves with the Motion style prepares its clip and words its prompt
 * (GET/PUT /v1/admin/nodaro-motion/motion). A save also re-asks the engine
 * prompt previews: the Motion tab's parts follow the saved setting.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { hasAdmin } from "@/lib/edition"
import { queryKeys } from "@/lib/query-keys"
import { fetchNodaroMotionMotion, saveNodaroMotionMotion } from "@/lib/api"

export function useNodaroMotionMotion() {
  return useQuery({
    queryKey: queryKeys.admin.nodaroMotionMotion(),
    queryFn: fetchNodaroMotionMotion,
    enabled: hasAdmin(),
    staleTime: 30_000,
  })
}

export function useSaveNodaroMotionMotion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: saveNodaroMotionMotion,
    onSuccess: (view) => {
      qc.setQueryData(queryKeys.admin.nodaroMotionMotion(), view)
      void qc.invalidateQueries({ queryKey: [...queryKeys.admin.nodaroMotionPromptParts(), "preview"] })
    },
  })
}
