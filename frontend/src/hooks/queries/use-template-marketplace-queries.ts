import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useAuth } from "@/hooks/use-auth"
import { queryKeys } from "@/lib/query-keys"
import { browseTemplates, toggleTemplateFavorite, getTemplateFavorites, getTemplateBySlug } from "@/lib/api"

export interface TemplateBrowseParams {
  category?: string
  outputType?: string
  tag?: string
  search?: string
  sort?: "popular" | "newest" | "most-favorited"
  nodeType?: string
  provider?: string
  complexity?: string
  favoritesOnly?: boolean
}

export function useTemplateBrowseInfinite(params: TemplateBrowseParams) {
  const filterKey = [
    params.category ?? "",
    params.outputType ?? "",
    params.tag ?? "",
    params.search ?? "",
    params.sort ?? "popular",
    params.nodeType ?? "",
    params.provider ?? "",
    params.complexity ?? "",
    params.favoritesOnly ? "fav" : "",
  ].filter(Boolean).join(":")

  return useInfiniteQuery({
    queryKey: queryKeys.templateMarketplace.browse(filterKey),
    queryFn: async ({ pageParam }) => {
      return browseTemplates({
        ...params,
        cursor: pageParam,
        limit: 20,
      })
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 30_000,
  })
}

export function useTemplateFavorites() {
  const { user } = useAuth()
  return useQuery({
    queryKey: queryKeys.templateMarketplace.favorites(user?.id ?? ""),
    queryFn: getTemplateFavorites,
    enabled: !!user?.id,
    staleTime: 60_000,
  })
}

export function useToggleTemplateFavoriteMutation() {
  const qc = useQueryClient()
  const { user } = useAuth()

  return useMutation({
    mutationFn: async ({ templateId }: { templateId: string }) => {
      return toggleTemplateFavorite(templateId)
    },
    onMutate: async ({ templateId }) => {
      const favKey = queryKeys.templateMarketplace.favorites(user?.id ?? "")
      await qc.cancelQueries({ queryKey: favKey })
      const prev = qc.getQueryData<string[]>(favKey) ?? []
      const isFav = prev.includes(templateId)
      qc.setQueryData<string[]>(favKey, isFav ? prev.filter((id) => id !== templateId) : [...prev, templateId])
      return { prev }
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) {
        const favKey = queryKeys.templateMarketplace.favorites(user?.id ?? "")
        qc.setQueryData(favKey, context.prev)
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.templateMarketplace.all })
    },
  })
}

export function useTemplateDetail(slug: string | null) {
  return useQuery({
    queryKey: queryKeys.templateMarketplace.detail(slug ?? ""),
    queryFn: () => getTemplateBySlug(slug!),
    enabled: !!slug,
    staleTime: 30_000,
  })
}
