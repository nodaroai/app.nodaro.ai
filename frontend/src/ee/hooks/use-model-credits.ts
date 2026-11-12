import { useQuery } from "@tanstack/react-query"
import { queryClient } from "@/lib/query-client"
import { hasCredits } from "@/lib/edition"
import { supportsExtendRender, resolveGvpAnchorWire } from "@nodaro/shared/models"
import { estimateSeedanceHdCredits, estimateVideoProCredits, type VideoProEstimateInput } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"
import type { GenerateVideoProNodeData } from "@/types/nodes"
import { useModelCreditCost } from "./queries/use-credits-queries"
import { seedanceHdDraftQuery } from "@/hooks/use-model-credit-cost"

export { getCachedCredits, prefetchModelCredits, isModelUnpriced } from "./queries/use-credits-queries"
export { useModelCreditCost } from "./queries/use-credits-queries"

/**
 * Backward-compatible wrapper: returns a plain number (matching old signature).
 * Prefer `useModelCreditCost(model)` in new code for full React Query state.
 */
export function useModelCredits(modelIdentifier: string | undefined, fallback: number = 0): number {
  const { data } = useModelCreditCost(modelIdentifier)
  return data ?? fallback
}

function videoProEstimateInput(data:GenerateVideoProNodeData):VideoProEstimateInput {
  const provider=data.provider||"seedance-2"
  return {provider,resolution:data.resolution||"720p",duration:data.duration??8,aspectRatio:data.aspectRatio,
    segmentMode:data.segmentMode,preferredSegmentSec:data.preferredSegmentSec,segmentDurations:data.segmentDurations,sourceSegmentDurations:data.sourceSegmentDurations,
    renderMethod:data.renderMethod==="keyframes"||!supportsExtendRender(provider)?"keyframes":"extend",anchorMode:resolveGvpAnchorWire(data.anchorMode,provider),
    contextTailSec:data.contextTailSec,planOnly:data.planOnly,generateAudio:data.generateAudio,
  }
}
const videoProEstimateKey=(data:GenerateVideoProNodeData)=>["credits","video-pro",videoProEstimateInput(data)] as const
export function useVideoProCredits(data:GenerateVideoProNodeData) {
  return useQuery({queryKey:videoProEstimateKey(data),queryFn:()=>estimateVideoProCredits(videoProEstimateInput(data)),enabled:hasCredits()&&data.segmentMode!==undefined,staleTime:30_000})
}
export function getCachedVideoProCredits(data:GenerateVideoProNodeData):number|undefined {
  return queryClient.getQueryData<{credits:number}>(videoProEstimateKey(data))?.credits
}

/**
 * Seedance 2.5 HD (from draft): the credits a finalize of `draftTaskId` will
 * reserve, from the server (the run's own gate and pricing), fetched ONCE per
 * draft — the key is the task id the run sends, so every node wired to the
 * same draft shares one request. `undefined` while loading, when the draft is
 * refused (not a draft, not finished, …), or with no draft wired.
 */
export function useSeedanceHdDraftCredits(draftTaskId: string | undefined, enabled: boolean): number | undefined {
  // The query a run estimate that only finalizes this draft reads too (`seedanceHdDraftQuery`).
  const { data } = useQuery({
    ...seedanceHdDraftQuery(draftTaskId ?? ""),
    enabled: enabled && hasCredits() && !!draftTaskId,
    gcTime: 30 * 60_000,
  })
  return data?.credits
}

/**
 * The lowest price any Seedance 2.5 draft can finalize for — the "from N"
 * quoted before a draft is wired. Server-computed: it depends on admin-edited
 * rows and the markup, which only the server knows.
 */
export function useSeedanceHdMinimumCredits(enabled: boolean = true): number | undefined {
  const { data } = useQuery({
    queryKey: queryKeys.credits.seedanceHdMinimum(),
    queryFn: () => estimateSeedanceHdCredits(),
    enabled: enabled && hasCredits(),
    staleTime: Infinity,
    gcTime: 30 * 60_000,
  })
  return data?.credits
}
