/**
 * Admin → Video Remake's roles from the prompt: whether this deployment
 * offers roles planned from a person's own words and loose reference images,
 * and the admin's own instructions and model for the engine's planning step
 * (GET/PUT /v1/admin/video-remake/plan-roles). The engine's defaults are
 * read from it (…/defaults, null where it plans no roles yet), and a draft's
 * step is checked by it (…/check, nothing saved).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { hasAdmin } from "@/lib/edition"
import { queryKeys } from "@/lib/query-keys"
import {
  checkNodaroMotionPlanRoles,
  fetchNodaroMotionPlanRoles,
  fetchNodaroMotionPlanRolesDefaults,
  saveNodaroMotionPlanRoles,
  type NodaroMotionPlanRoles,
} from "@/lib/api"

export function useNodaroMotionPlanRoles() {
  return useQuery({
    queryKey: queryKeys.admin.nodaroMotionPlanRoles(),
    queryFn: fetchNodaroMotionPlanRoles,
    enabled: hasAdmin(),
    staleTime: 30_000,
  })
}

export function useSaveNodaroMotionPlanRoles() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: saveNodaroMotionPlanRoles,
    onSuccess: (view) => {
      qc.setQueryData(queryKeys.admin.nodaroMotionPlanRoles(), view)
    },
  })
}

/** The engine's defaults, asked only where this environment's engine plans roles (`supported`). */
export function useNodaroMotionPlanRolesDefaults(supported: boolean) {
  return useQuery({
    queryKey: queryKeys.admin.nodaroMotionPlanRolesDefaults(),
    queryFn: fetchNodaroMotionPlanRolesDefaults,
    enabled: hasAdmin() && supported,
    staleTime: 60_000,
  })
}

/** The engine's problems with `steps` (the settled draft's step as a string; "" asks nothing). */
export function useNodaroMotionPlanRolesCheck(steps: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.admin.nodaroMotionPlanRolesCheck(steps),
    queryFn: () => checkNodaroMotionPlanRoles(JSON.parse(steps) as NodaroMotionPlanRoles),
    enabled: hasAdmin() && enabled && steps !== "",
    staleTime: Infinity,
  })
}
