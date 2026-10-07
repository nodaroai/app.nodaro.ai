import { useQuery } from "@tanstack/react-query"
import { queryClient } from "@/lib/query-client"
import { hasCredits } from "@/lib/edition"
import { supportsExtendRender, resolveGvpAnchorWire } from "@nodaro/shared"
import { estimateVideoProCredits, type VideoProEstimateInput } from "@/lib/api"
import type { GenerateVideoProNodeData } from "@/types/nodes"
import { useModelCreditCost } from "./queries/use-credits-queries"

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
    renderMethod:data.renderMethod==="keyframes"||!supportsExtendRender(provider)?"keyframes":"extend",anchorMode:resolveGvpAnchorWire(data.anchorMode),
    contextTailSec:data.contextTailSec,planOnly:data.planOnly,
  }
}
const videoProEstimateKey=(data:GenerateVideoProNodeData)=>["credits","video-pro",videoProEstimateInput(data)] as const
export function useVideoProCredits(data:GenerateVideoProNodeData) {
  return useQuery({queryKey:videoProEstimateKey(data),queryFn:()=>estimateVideoProCredits(videoProEstimateInput(data)),enabled:hasCredits()&&data.segmentMode!==undefined,staleTime:30_000})
}
export function getCachedVideoProCredits(data:GenerateVideoProNodeData):number|undefined {
  return queryClient.getQueryData<{credits:number}>(videoProEstimateKey(data))?.credits
}
