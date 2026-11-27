/**
 * Admin → Video route: GET/PUT /v1/admin/video-route. Every save answers with
 * the whole page as saved, which replaces the cached one.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { hasAdmin } from "@/lib/edition"
import {
  decideVideoRouteHold,
  fetchVideoRoute,
  revertVideoRoutePolicy,
  saveVideoRouteFactors,
  saveVideoRoutePolicy,
  VideoRouteRefused,
  type VideoRouteView,
} from "@/ee/lib/video-route-api"

export const VIDEO_ROUTE_KEY = ["admin", "video-route"] as const

export function useVideoRoute() {
  return useQuery({ queryKey: VIDEO_ROUTE_KEY, queryFn: fetchVideoRoute, enabled: hasAdmin(), staleTime: 30_000 })
}

function useVideoRouteMutation<A>(fn: (arg: A) => Promise<VideoRouteView>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: (view) => qc.setQueryData(VIDEO_ROUTE_KEY, view),
    // A refusal shows the page as it is now: the view it carried, else a fresh read (a save refused
    // because someone else saved first must show their save).
    onError: (error) => {
      if (error instanceof VideoRouteRefused && error.view) qc.setQueryData(VIDEO_ROUTE_KEY, error.view)
      else void qc.invalidateQueries({ queryKey: VIDEO_ROUTE_KEY })
    },
  })
}

export const useSaveVideoRoutePolicy = () => useVideoRouteMutation(saveVideoRoutePolicy)
export const useRevertVideoRoutePolicy = () => useVideoRouteMutation((_: void) => revertVideoRoutePolicy())
export const useSaveVideoRouteFactors = () => useVideoRouteMutation(saveVideoRouteFactors)
export const useDecideVideoRouteHold = () => useVideoRouteMutation(decideVideoRouteHold)
