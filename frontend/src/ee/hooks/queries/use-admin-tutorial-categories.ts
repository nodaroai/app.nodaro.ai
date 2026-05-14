// Admin CRUD hooks for the shared tutorial taxonomy. All mutations invalidate
// both the admin categories list AND the downstream caches that depend on it
// (admin tutorials list, public grouped tutorials, admin flow tutorials list)
// so renaming or disabling a category propagates immediately.

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import {
  fetchAdminTutorialCategories,
  createTutorialCategory,
  updateTutorialCategory,
  deleteTutorialCategory,
  type TutorialCategory,
} from "@/lib/api"

export function useAdminTutorialCategories() {
  return useQuery({
    queryKey: queryKeys.admin.tutorialCategories(),
    queryFn: fetchAdminTutorialCategories,
    staleTime: 60_000,
  })
}

/** Categories that are enabled, ordered for use in dropdowns. */
export function useEnabledTutorialCategories(): TutorialCategory[] {
  const { data } = useAdminTutorialCategories()
  return (data ?? []).filter((c) => c.isEnabled)
}

function invalidateDownstream(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: queryKeys.admin.tutorialCategories() })
  qc.invalidateQueries({ queryKey: queryKeys.admin.tutorials() })
  qc.invalidateQueries({ queryKey: queryKeys.tutorials.all })
}

export function useCreateTutorialCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createTutorialCategory,
    onSuccess: () => invalidateDownstream(qc),
  })
}

export function useUpdateTutorialCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof updateTutorialCategory>[1] }) =>
      updateTutorialCategory(id, data),
    onSuccess: () => invalidateDownstream(qc),
  })
}

/**
 * Delete a category. The mutation throws `TutorialCategoryInUseError`
 * (with videoCount + flowCount) when something still references the
 * category — the UI should catch that to surface the counts.
 */
export function useDeleteTutorialCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteTutorialCategory,
    onSuccess: () => invalidateDownstream(qc),
  })
}
