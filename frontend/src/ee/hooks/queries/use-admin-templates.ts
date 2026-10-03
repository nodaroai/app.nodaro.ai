// Hooks for Admin → Templates.
//
//   useAdminTemplatesList   → every template on the platform, newest first,
//                             paged by the server's created_at cursor
//   useSetTemplateListing   → PATCH /listing: on/off and in/out of the gallery,
//                             shown at once and rolled back if the server refuses

import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import {
  listAdminWorkflowTemplates,
  setAdminTemplateListing,
  type AdminWorkflowTemplateRow,
} from "@/lib/api"

export type TemplateListingFilter = "" | "marketplace" | "tutorial" | "unlisted"

type TemplatesPage = { data: AdminWorkflowTemplateRow[]; nextCursor: string | null }

const PAGE_SIZE = 50

/** Every admin Templates list, whatever its filters (partial key match). */
const ALL_TEMPLATES_PAGES = queryKeys.admin.templatesPages()

export function useAdminTemplatesList(filters: { search: string; listed: TemplateListingFilter }) {
  return useInfiniteQuery({
    queryKey: queryKeys.admin.templatesPage(filters),
    queryFn: ({ pageParam }) =>
      listAdminWorkflowTemplates({
        cursor: pageParam,
        limit: PAGE_SIZE,
        search: filters.search || undefined,
        listed: filters.listed || undefined,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: TemplatesPage) => last.nextCursor ?? undefined,
    staleTime: 30_000,
  })
}

export interface TemplateListingChange {
  readonly templateId: string
  readonly isActive?: boolean
  readonly isListed?: boolean
}

/** The row as it reads after the change; `listedIn` keeps the other tags. */
export function applyListingChange(
  row: AdminWorkflowTemplateRow,
  change: TemplateListingChange,
): AdminWorkflowTemplateRow {
  if (row.id !== change.templateId) return row
  const isActive = change.isActive ?? row.isActive
  if (change.isListed === undefined) return { ...row, isActive }
  const others = row.listedIn.filter((tag) => tag !== "marketplace")
  return {
    ...row,
    isActive,
    isListed: change.isListed,
    listedIn: change.isListed ? [...others, "marketplace"] : others,
  }
}

export function useSetTemplateListing() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ templateId, ...change }: TemplateListingChange) =>
      setAdminTemplateListing(templateId, change),
    onMutate: async (change) => {
      await qc.cancelQueries({ queryKey: ALL_TEMPLATES_PAGES })
      const previous = qc.getQueriesData<InfiniteData<TemplatesPage>>({ queryKey: ALL_TEMPLATES_PAGES })
      qc.setQueriesData<InfiniteData<TemplatesPage>>({ queryKey: ALL_TEMPLATES_PAGES }, (data) =>
        data && {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            data: page.data.map((row) => applyListingChange(row, change)),
          })),
        },
      )
      return { previous }
    },
    onError: (_error, _change, context) => {
      for (const [key, data] of context?.previous ?? []) qc.setQueryData(key, data)
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "workflow-templates"] })
      void qc.invalidateQueries({ queryKey: queryKeys.tutorials.all })
      void qc.invalidateQueries({ queryKey: queryKeys.templateMarketplace.all })
    },
  })
}
