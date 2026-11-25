/**
 * Admin → Video route: GET/PUT /v1/admin/video-route. Every save answers with
 * the whole page as saved, which replaces the cached one.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { hasAdmin } from "@/lib/edition"
import {
  fetchVideoRoute,
  revertVideoRoutePolicy,
  saveVideoRouteFactors,
  saveVideoRoutePolicy,
  type VideoRouteView,
} from "@/ee/lib/video-route-api"

export const VIDEO_ROUTE_KEY = ["admin", "video-route"] as const

export function useVideoRoute() {
  return useQuery({ queryKey: VIDEO_ROUTE_KEY, queryFn: fetchVideoRoute, enabled: hasAdmin(), staleTime: 30_000 })
}

function useVideoRouteMutation<A>(fn: (arg: A) => Promise<VideoRouteView>) {
  const qc = useQueryClient()
  return useMutation({ mutationFn: fn, onSuccess: (view) => qc.setQueryData(VIDEO_ROUTE_KEY, view) })
}

export const useSaveVideoRoutePolicy = () => useVideoRouteMutation(saveVideoRoutePolicy)
export const useRevertVideoRoutePolicy = () => useVideoRouteMutation((_: void) => revertVideoRoutePolicy())
export const useSaveVideoRouteFactors = () => useVideoRouteMutation(saveVideoRouteFactors)
