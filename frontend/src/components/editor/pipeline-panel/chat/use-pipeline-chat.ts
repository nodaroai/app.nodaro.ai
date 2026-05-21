import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { CHAT_TURN_CAPS, type ChatEnabledStage } from "@nodaro/shared"
import type { ChatTurn } from "@nodaro/client"
import { pipelinesApi } from "@/lib/pipelines-api"

/**
 * Phase 1D.2b — Guided-mode chat hook. Owns the per-stage chat history
 * cache, the send-message mutation, and the apply-proposal mutation.
 *
 * Cache key contract: `["pipelines", pipelineId, "stages", stage, "chat"]`
 * matches the key used by `use-pipeline-events.ts` so an incoming
 * `chat:turn` SSE event lands directly into this hook's cache without a
 * refetch.
 *
 * The hook exposes `remaining` (CHAT_TURN_CAPS[stage] − userTurnCount) and
 * `isAtCap` so the input + footer can disable / message accordingly without
 * re-counting on each render.
 */
export function usePipelineChat(pipelineId: string, stage: ChatEnabledStage) {
  const queryClient = useQueryClient()

  const query = useQuery<{ turns: ChatTurn[] }>({
    queryKey: ["pipelines", pipelineId, "stages", stage, "chat"],
    queryFn: () => pipelinesApi.fetchChat(pipelineId, stage),
  })

  const sendMutation = useMutation({
    mutationFn: (message: string) =>
      pipelinesApi.postChat(pipelineId, stage, message),
  })

  const applyMutation = useMutation({
    mutationFn: (turnId: string) =>
      pipelinesApi.applyChat(pipelineId, stage, turnId),
    onSuccess: () => {
      // The applied edit creates a new pipeline_stage_attempts row and
      // flips the stage to approved — pipeline + stage queries must
      // refetch so the panel sees the new state.
      queryClient.invalidateQueries({ queryKey: ["pipeline", pipelineId] })
      queryClient.invalidateQueries({
        queryKey: ["pipeline-stage", pipelineId, stage],
      })
      queryClient.invalidateQueries({
        queryKey: ["pipelines", pipelineId, "stages", stage, "chat"],
      })
    },
  })

  const turns = query.data?.turns ?? []
  const userTurnCount = turns.filter((t) => t.role === "user").length
  const remaining = CHAT_TURN_CAPS[stage] - userTurnCount

  return {
    turns,
    remaining,
    isAtCap: remaining <= 0,
    isLoading: query.isLoading,
    queryError: query.error,
    sendMessage: sendMutation.mutate,
    applyProposal: applyMutation.mutate,
    isSending: sendMutation.isPending,
    isApplying: applyMutation.isPending,
    sendError: sendMutation.error,
    applyError: applyMutation.error,
  }
}
