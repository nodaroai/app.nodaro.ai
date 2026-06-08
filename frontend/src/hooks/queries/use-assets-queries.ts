import {
  useQuery,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query"
import {
  getCharacters,
  getObjects,
  getCreatures,
  getLocations,
  getFaces,
  getLibraryAssets,
  deleteLibraryAsset,
  removeLibraryAsset,
  type LibraryAsset,
} from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"
import { removeInfiniteItems } from "@/lib/optimistic-cache"

type LibraryPage = { data: LibraryAsset[]; nextCursor: string | null; totalCount?: number }

// --- Characters ---
export function useCharacters(projectId?: string, userId?: string) {
  return useQuery({
    queryKey: queryKeys.assets.characters(projectId, userId),
    queryFn: () => getCharacters(projectId, userId),
    enabled: !!userId,
    staleTime: 60_000,
    select: (data) => data.characters,
  })
}

/**
 * Archived ("soft-deleted") characters for the library's Archive tab.
 * Keyed separately from useCharacters so the active list cache isn't
 * polluted; on archive/restore, invalidate both.
 */
export function useArchivedCharacters(projectId?: string, userId?: string) {
  return useQuery({
    queryKey: [...queryKeys.assets.characters(projectId, userId), "archived"],
    queryFn: async () => {
      const { listArchivedCharacters } = await import("@/lib/api")
      return listArchivedCharacters(projectId)
    },
    enabled: !!userId,
    staleTime: 60_000,
    select: (data) => data.characters,
  })
}

// --- Objects ---
export function useObjects(projectId?: string, userId?: string) {
  return useQuery({
    queryKey: queryKeys.assets.objects(projectId, userId),
    queryFn: () => getObjects(projectId, userId),
    enabled: !!userId,
    staleTime: 60_000,
    select: (data) => data.objects,
  })
}

// --- Animal/Creatures ---
export function useCreatures(projectId?: string, userId?: string) {
  return useQuery({
    queryKey: queryKeys.assets.creatures(projectId, userId),
    queryFn: () => getCreatures(projectId, userId),
    enabled: !!userId,
    staleTime: 60_000,
    select: (data) => data.creatures,
  })
}

// --- Locations ---
export function useLocations(projectId?: string, userId?: string) {
  return useQuery({
    queryKey: queryKeys.assets.locations(projectId, userId),
    queryFn: () => getLocations(projectId, userId),
    enabled: !!userId,
    staleTime: 60_000,
    select: (data) => data.locations,
  })
}

/**
 * Archived ("soft-deleted") locations for the library's Archive tab. Mirrors
 * `useArchivedCharacters` — keyed separately from `useLocations` so the active
 * list cache isn't polluted. On archive/restore/permanent-delete, invalidate
 * both via `useInvalidateLocation` (active) + this hook's key (archived).
 */
export function useArchivedLocations(projectId?: string, userId?: string) {
  return useQuery({
    queryKey: [...queryKeys.assets.locations(projectId, userId), "archived"],
    queryFn: async () => {
      const { listArchivedLocations } = await import("@/lib/api")
      return listArchivedLocations(projectId)
    },
    enabled: !!userId,
    staleTime: 60_000,
    select: (data) => data.locations,
  })
}

// --- Faces ---
export function useFaces(projectId?: string, userId?: string) {
  return useQuery({
    queryKey: queryKeys.assets.faces(projectId, userId),
    queryFn: () => getFaces(projectId, userId),
    enabled: !!userId,
    staleTime: 60_000,
    select: (data) => data.faces,
  })
}

// --- Library (paginated) ---
export function useLibraryInfinite(params: {
  userId: string | undefined
  type?: string
  search?: string
  owned?: boolean
  limit?: number
}) {
  const { userId, type, search, owned, limit = 40 } = params
  return useInfiniteQuery({
    queryKey: queryKeys.library.list({
      userId: userId ?? "",
      type,
      search,
      owned,
    }),
    queryFn: async ({ pageParam }) => {
      return getLibraryAssets({
        userId: userId!,
        type: type && type !== "all" ? type : undefined,
        search,
        limit,
        cursor: pageParam,
        owned,
      })
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: !!userId,
    staleTime: 30_000,
  })
}

export function useDeleteLibraryAssetMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ assetId, userId }: { assetId: string; userId: string }) =>
      deleteLibraryAsset(assetId, userId),
    // Optimistically drop the asset from every cached library-list variant.
    // Items live under `.data` on each infinite-query page.
    onMutate: async ({ assetId }) => {
      await qc.cancelQueries({ queryKey: queryKeys.library.all })
      const previous = qc.getQueriesData<InfiniteData<LibraryPage>>({
        queryKey: queryKeys.library.all,
      })
      qc.setQueriesData<InfiniteData<LibraryPage>>(
        { queryKey: queryKeys.library.all },
        (data) =>
          removeInfiniteItems<"data", LibraryAsset, LibraryPage>(
            data,
            "data",
            (item) => item.id === assetId,
          ),
      )
      return { previous }
    },
    onError: (_err, _vars, context) => {
      context?.previous?.forEach(([key, data]) => qc.setQueryData(key, data))
    },
    onSettled: (_data, _err, { userId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.library.all })
      qc.invalidateQueries({ queryKey: queryKeys.billing.storage(userId) })
    },
  })
}

export function useRemoveLibraryAssetMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ assetId, userId }: { assetId: string; userId: string }) =>
      removeLibraryAsset(assetId, userId),
    // Optimistically drop the asset from every cached library-list variant.
    onMutate: async ({ assetId }) => {
      await qc.cancelQueries({ queryKey: queryKeys.library.all })
      const previous = qc.getQueriesData<InfiniteData<LibraryPage>>({
        queryKey: queryKeys.library.all,
      })
      qc.setQueriesData<InfiniteData<LibraryPage>>(
        { queryKey: queryKeys.library.all },
        (data) =>
          removeInfiniteItems<"data", LibraryAsset, LibraryPage>(
            data,
            "data",
            (item) => item.id === assetId,
          ),
      )
      return { previous }
    },
    onError: (_err, _vars, context) => {
      context?.previous?.forEach(([key, data]) => qc.setQueryData(key, data))
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.library.all })
    },
  })
}
