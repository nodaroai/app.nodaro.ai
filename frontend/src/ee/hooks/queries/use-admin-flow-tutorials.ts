// Hooks for the admin "Flow Tutorials" tab.
//
//   useAdminAllWorkflowTemplates  → fetch ALL templates across users (the
//                                   picker uses this to let admins flag any
//                                   template as a tutorial)
//   useAdminFlowTutorials          → templates with 'tutorial' in listed_in,
//                                    ordered by tutorial_sort_order
//   useToggleTutorialFlag          → PATCH /tutorial-flag

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import {
  listAdminWorkflowTemplates,
  toggleTemplateTutorialFlag,
  type AdminWorkflowTemplateRow,
} from "@/lib/api"

interface ListParams {
  search?: string
  listed?: "marketplace" | "tutorial" | "unlisted"
  limit?: number
}

export function useAdminAllWorkflowTemplates(params: ListParams = {}) {
  return useQuery({
    queryKey: queryKeys.admin.workflowTemplatesAll({
      search: params.search,
      listed: params.listed,
    }),
    queryFn: () => listAdminWorkflowTemplates({ ...params }),
    staleTime: 30_000,
  })
}

/** Flow tutorials — sorted client-side by tutorial_sort_order, then name. */
export function useAdminFlowTutorials() {
  const result = useAdminAllWorkflowTemplates({ listed: "tutorial", limit: 100 })
  const rows: AdminWorkflowTemplateRow[] = result.data?.data ?? []
  const sorted = [...rows].sort((a, b) => {
    if (a.tutorialSortOrder !== b.tutorialSortOrder) {
      return a.tutorialSortOrder - b.tutorialSortOrder
    }
    return a.name.localeCompare(b.name)
  })
  return { ...result, flows: sorted }
}

function invalidateAfterFlag(qc: ReturnType<typeof useQueryClient>) {
  // Invalidate every variant of the admin all-templates list (we don't know
  // which filter the user is currently viewing).
  qc.invalidateQueries({ queryKey: ["admin", "workflow-templates"] })
  qc.invalidateQueries({ queryKey: queryKeys.tutorials.all })
}

export function useToggleTutorialFlag() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      templateId,
      isTutorial,
      tutorialCategoryId,
      tutorialSortOrder,
    }: {
      templateId: string
      isTutorial: boolean
      tutorialCategoryId?: string
      tutorialSortOrder?: number
    }) =>
      toggleTemplateTutorialFlag(templateId, {
        isTutorial,
        tutorialCategoryId,
        tutorialSortOrder,
      }),
    onSuccess: () => invalidateAfterFlag(qc),
  })
}
