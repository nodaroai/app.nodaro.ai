/**
 * Admin → Nodaro Motion's preparation steps: per engine, how the reference
 * sheets, the engine prompt and the scene description of a run people start
 * themselves are made (GET/PUT /v1/admin/nodaro-motion/steps). Never saved
 * (`steps: null`) = every direct run is today's.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { hasAdmin } from "@/lib/edition"
import { fetchNodaroMotionSteps, saveNodaroMotionSteps } from "@/lib/api"

export const NODARO_MOTION_STEPS_KEY = ["admin", "nodaro-motion", "steps"] as const

export function useNodaroMotionSteps() {
  return useQuery({
    queryKey: NODARO_MOTION_STEPS_KEY,
    queryFn: fetchNodaroMotionSteps,
    enabled: hasAdmin(),
    staleTime: 30_000,
  })
}

export function useSaveNodaroMotionSteps() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: saveNodaroMotionSteps,
    onSuccess: (view) => qc.setQueryData(NODARO_MOTION_STEPS_KEY, view),
  })
}
