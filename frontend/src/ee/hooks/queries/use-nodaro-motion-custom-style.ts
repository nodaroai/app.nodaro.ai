/**
 * Admin → Video Remake's custom style: whether this deployment offers a
 * style in the person's own words on a direct Nodaro Prism run, and the
 * admin's own instructions and model for the engine's two LLM steps
 * (GET/PUT /v1/admin/video-remake/custom-style). The engine's defaults are
 * read from it (…/defaults, null where it has no custom style yet), and a
 * draft's steps are checked by it (…/check, nothing saved).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { hasAdmin } from "@/lib/edition"
import { queryKeys } from "@/lib/query-keys"
import {
  checkNodaroMotionCustomStyle,
  fetchNodaroMotionCustomStyle,
  fetchNodaroMotionCustomStyleDefaults,
  saveNodaroMotionCustomStyle,
  type NodaroMotionCustomStyle,
} from "@/lib/api"

export function useNodaroMotionCustomStyle() {
  return useQuery({
    queryKey: queryKeys.admin.nodaroMotionCustomStyle(),
    queryFn: fetchNodaroMotionCustomStyle,
    enabled: hasAdmin(),
    staleTime: 30_000,
  })
}

export function useSaveNodaroMotionCustomStyle() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: saveNodaroMotionCustomStyle,
    onSuccess: (view) => {
      qc.setQueryData(queryKeys.admin.nodaroMotionCustomStyle(), view)
    },
  })
}

/** The engine's defaults, asked only where this environment's engine takes a custom style (`supported`). */
export function useNodaroMotionCustomStyleDefaults(supported: boolean) {
  return useQuery({
    queryKey: queryKeys.admin.nodaroMotionCustomStyleDefaults(),
    queryFn: fetchNodaroMotionCustomStyleDefaults,
    enabled: hasAdmin() && supported,
    staleTime: 60_000,
  })
}

/** The engine's problems with `steps` (the settled draft's steps as a string; "" asks nothing). */
export function useNodaroMotionCustomStyleCheck(steps: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.admin.nodaroMotionCustomStyleCheck(steps),
    queryFn: () => checkNodaroMotionCustomStyle(JSON.parse(steps) as NodaroMotionCustomStyle),
    enabled: hasAdmin() && enabled && steps !== "",
    staleTime: Infinity,
  })
}
