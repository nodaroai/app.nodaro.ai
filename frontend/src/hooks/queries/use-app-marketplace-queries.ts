import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useAuth } from "@/hooks/use-auth"
import { queryKeys } from "@/lib/query-keys"
import { browseApps, toggleAppFavorite, getAppFavorites } from "@/lib/api"

export interface AppBrowseParams {
  category?: string
  outputType?: string
  tag?: string
  search?: string
  sort?: "popular" | "newest" | "most-favorited"
  creatorId?: string
  favoritesOnly?: boolean
  publishType?: "app" | "component"
}

export function useAppBrowseInfinite(params: AppBrowseParams) {
  const filterKey = [
    params.category ?? "",
    params.outputType ?? "",
    params.tag ?? "",
    params.search ?? "",
    params.sort ?? "popular",
    params.creatorId ?? "",
    params.favoritesOnly ? "fav" : "",
    params.publishType ?? "",
  ].filter(Boolean).join(":")

  return useInfiniteQuery({
    queryKey: queryKeys.appMarketplace.browse(filterKey),
    queryFn: async ({ pageParam }) => {
      return browseApps({
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

export function useAppFavorites() {
  const { user } = useAuth()
  return useQuery({
    queryKey: queryKeys.appMarketplace.favorites(user?.id ?? ""),
    queryFn: getAppFavorites,
    enabled: !!user?.id,
    staleTime: 60_000,
  })
}

export function useToggleAppFavoriteMutation() {
  const qc = useQueryClient()
  const { user } = useAuth()

  return useMutation({
    mutationFn: async ({ appId }: { appId: string }) => {
      return toggleAppFavorite(appId)
    },
    // Optimistic update on favorites list
    onMutate: async ({ appId }) => {
      const favKey = queryKeys.appMarketplace.favorites(user?.id ?? "")
      await qc.cancelQueries({ queryKey: favKey })
      const prev = qc.getQueryData<string[]>(favKey) ?? []
      const isFav = prev.includes(appId)
      qc.setQueryData<string[]>(favKey, isFav ? prev.filter((id) => id !== appId) : [...prev, appId])
      return { prev }
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) {
        const favKey = queryKeys.appMarketplace.favorites(user?.id ?? "")
        qc.setQueryData(favKey, context.prev)
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.appMarketplace.all })
    },
  })
}
