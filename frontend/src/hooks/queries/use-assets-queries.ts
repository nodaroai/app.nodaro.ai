import {
  useQuery,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query"
import {
  getCharacters,
  getObjects,
  getLocations,
  getFaces,
  getLibraryAssets,
  deleteLibraryAsset,
  removeLibraryAsset,
} from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"

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
    onSuccess: (_data, { userId }) => {
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.library.all })
    },
  })
}
