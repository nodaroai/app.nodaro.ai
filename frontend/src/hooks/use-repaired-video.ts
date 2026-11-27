import { useEffect, useMemo } from "react"
import { useQueries, useQuery } from "@tanstack/react-query"
import { getJobStatusBatch } from "@/lib/api"
import { queryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import { deliveredVideoClips, repairedCanvasTake, replacementVideoUrl, videoRepairSource, type VideoRepair, type VideoRepairSource } from "@nodaro/render-rules"
import { getCachedUserId, useCachedUserId } from "./use-auth"
import { useWorkflowStore } from "./use-workflow-store"
import type { GeneratedResult } from "@/types/nodes"

type Fields = Record<string, unknown>
type States = Record<string, { output?: Fields }>

/** A missing batch row means this viewer cannot read it; even an admin's batch
 * contains only their own jobs. Keep only the public delivery fields in cache. */
function deliveryQuery(userId: string | undefined, jobId: string) {
  return {
    queryKey: [...queryKeys.jobs.detail(jobId), "clip-delivery", userId ?? null],
    enabled: Boolean(userId && jobId),
    queryFn: async () => {
      if (!userId || getCachedUserId() !== userId) return null
      const { jobs } = await getJobStatusBatch([jobId])
      if (getCachedUserId() !== userId) return null
      const raw = jobs.find(job => job.id === jobId && job.status === "completed")?.output_data
      if (!raw || typeof raw !== "object") return null
      const out = raw as Fields
      const clips = deliveredVideoClips(out)
      const first = clips[0]?.url
      const url = out.videoUrl
      if (!first || typeof url !== "string") return null
      const repair = out.deliveryMode === "simple_cuts" && first !== url ? { jobId, first, url } : undefined
      return { videoUrl: url, unassembledClips: clips, repair,
        pending: out.deliveryMode === "separate_clips" && out.assemblyRetryFinished !== true }
    },
    retry: 2,
    refetchOnWindowFocus: true,
    refetchInterval: (query: { state: { data?: { pending: boolean } | null; status: string } }): number | false =>
      query.state.status === "error" || query.state.data?.pending ? 60_000 : false,
  }
}

export function useOwnedClipDelivery(jobId?: string) {
  const userId = useCachedUserId(Boolean(jobId))
  const { data } = useQuery(deliveryQuery(userId, jobId ?? ""), queryClient)
  return userId && jobId ? data : undefined
}

function useRepairs(sources: readonly VideoRepairSource[]) {
  const userId = useCachedUserId(sources.length > 0)
  const ids = userId ? [...new Set(sources.map(source => source.jobId))] : []
  return useQueries({
    queries: ids.map(jobId => deliveryQuery(userId, jobId)),
    combine: results => results.flatMap(result => result.data?.repair ? [result.data.repair] : []),
  }, queryClient)
}

export function useRepairedCanvasVideo(nodeId: string, results: readonly GeneratedResult[]) {
  const sources = results.flatMap(take => videoRepairSource(take.jobId, take.url, take) ?? [])
  const repairs = useRepairs(sources)
  useEffect(() => {
    if (!repairs.length) return
    const store = useWorkflowStore.getState()
    const data = store.nodes.find(node => node.id === nodeId)?.data
    const patch = data && repairedCanvasTake(data as Fields, repairs)
    if (patch) store.updateNodeData(nodeId, patch)
  }, [nodeId, repairs])
}

function rowStamps(out: Fields): Fields[] {
  return Array.isArray(out.listResultStamps) ? out.listResultStamps : []
}

function stateSources(states: States): VideoRepairSource[] {
  return Object.values(states).flatMap(({ output: out }) => {
    if (!out) return []
    const primary = videoRepairSource(out.clipJobId, out.videoUrl, out)
    const urls = Array.isArray(out.listResults) ? out.listResults : []
    return [...(primary ? [primary] : []), ...rowStamps(out).flatMap((row, i) => videoRepairSource(row?.clipJobId, urls[i], row) ?? [])]
  })
}

export function repairedVideoStates<T extends States>(states: T, repairs: readonly VideoRepair[]): T {
  if (!repairs.length) return states
  let result = states
  for (const [id, state] of Object.entries(states)) {
    const out = state.output
    if (!out) continue
    const videoUrl = replacementVideoUrl(out.clipJobId, out.videoUrl, repairs)
    const stamps = rowStamps(out)
    const list = Array.isArray(out.listResults) ? out.listResults : undefined
    const updated = list?.map((url, i) => replacementVideoUrl(stamps[i]?.clipJobId, url, repairs) ?? url)
    if (!videoUrl && !updated?.some((url, i) => url !== list?.[i])) continue
    result = { ...result, [id]: { ...state, output: { ...out, ...(videoUrl ? { videoUrl } : {}), ...(updated ? { listResults: updated } : {}) } } }
  }
  return result
}

export function useRepairedVideoStates<T extends States>(states: T): T {
  const sources = useMemo(() => stateSources(states), [states])
  const repairs = useRepairs(sources)
  return useMemo(() => repairedVideoStates(states, repairs), [states, repairs])
}

export function useRepairedVideoSlots<T extends {nodeStates: States}>(slots: T[]): T[] {
  const sources = useMemo(() => slots.flatMap(slot => stateSources(slot.nodeStates)), [slots])
  const repairs = useRepairs(sources)
  return useMemo(() => !repairs.length ? slots : slots.map(slot => {
    const nodeStates = repairedVideoStates(slot.nodeStates, repairs)
    return nodeStates === slot.nodeStates ? slot : { ...slot, nodeStates }
  }), [slots, repairs])
}
