import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useAuth } from "@/hooks/use-auth"
import { hasAdmin } from "@/lib/edition"
import { queryKeys } from "@/lib/query-keys"
import { getAuthHeaders } from "@/lib/api"

export interface GalleryItem {
  readonly id: string
  readonly type: "image" | "video" | "audio"
  readonly jobName: string
  readonly outputUrl: string
  readonly thumbnailUrl: string | null
  readonly createdAt: string
  readonly prompt: string | null
  readonly model: string | null
  readonly referenceImages?: readonly string[]
}

export function useGalleryInfinite(filter: string) {
  return useInfiniteQuery({
    queryKey: queryKeys.gallery.list(filter),
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({ limit: "20" })
      if (filter && filter !== "all") params.set("type", filter)
      if (pageParam) params.set("cursor", pageParam)
      const res = await fetch(`/v1/gallery?${params.toString()}`)
      if (!res.ok) throw new Error("Failed to fetch gallery")
      return res.json() as Promise<{ data: GalleryItem[]; nextCursor: string | null }>
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 30_000,
  })
}

export function useGalleryReportCount() {
  const { user, isAdmin } = useAuth()
  return useQuery({
    queryKey: queryKeys.gallery.reportCount(),
    queryFn: async () => {
      const res = await fetch(
        `/v1/admin/gallery-reports/count?userId=${encodeURIComponent(user!.id)}`,
        { headers: await getAuthHeaders() },
      )
      if (!res.ok) return 0
      const json = await res.json()
      return (json.data?.count ?? json.count ?? 0) as number
    },
    enabled: !!user?.id && isAdmin && hasAdmin(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
}

export function useReportGalleryItemMutation() {
  return useMutation({
    mutationFn: async ({ jobId, reason, details }: { jobId: string; reason: string; details?: string }) => {
      const res = await fetch(`/v1/gallery/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
        body: JSON.stringify({ jobId, reason, details: details || undefined }),
      })
      if (res.status === 429) throw new Error("You already reported this item recently")
      if (!res.ok) throw new Error("Failed to submit report")
      return res.json()
    },
  })
}

export function useDeleteGalleryItemMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ itemId, userId }: { itemId: string; userId: string }) => {
      const res = await fetch(`/v1/gallery/${itemId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
        body: JSON.stringify({ userId }),
      })
      if (!res.ok) throw new Error("Failed to remove item")
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.gallery.all })
    },
  })
}
