/**
 * Thread + history for the open workflow.
 *
 * Server state stays in React Query; the live turn lives in the module store
 * (`ee/lib/copilot/turn-store.ts`). The two meet in the message list: history
 * renders everything the server has persisted, and the live turn is drawn on
 * top until the refetch that follows `done` contains it.
 */
import { useEffect } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { findCopilotThread, getCopilotThread, updateCopilotThread } from "@/ee/lib/copilot/api"
import { copilotState, setCopilotState, useCopilotStore } from "@/ee/lib/copilot/turn-store"
import type { CopilotRunMode, CopilotThread, DisplayMessage } from "@/ee/lib/copilot/types"

/**
 * Resolve (but never create) the thread for this workflow. Creation happens on
 * the first send — opening the panel must not leave a thread behind.
 */
export function useCopilotThreadForWorkflow(): { thread: CopilotThread | null; loading: boolean } {
  const workflowId = useWorkflowStore((s) => s.workflowId)
  const storedThreadId = useCopilotStore((s) => s.threadId)

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.copilot.forWorkflow(workflowId ?? "none"),
    queryFn: () => findCopilotThread(workflowId!),
    enabled: Boolean(workflowId),
    staleTime: 30_000,
  })

  const resolved = data?.thread ?? null

  useEffect(() => {
    if (resolved && resolved.id !== storedThreadId) {
      setCopilotState({ threadId: resolved.id, workflowId: resolved.workflowId })
      copilotState().setRunSettings(resolved.runMode, resolved.autoRunLimitCredits, resolved.allowPublishing ?? false)
    }
  }, [resolved, storedThreadId])

  return { thread: resolved, loading: isLoading }
}

/** Persisted messages for a thread. Empty (and idle) until a thread exists. */
export function useCopilotHistory(threadId: string | null): {
  thread: CopilotThread | null
  messages: DisplayMessage[]
  /** Someone is mid-turn on the server: this tab, or another one. */
  busy: { kind: "ours" | "other-tab" } | null
} {
  const streaming = useCopilotStore((s) => s.streaming)
  const lastTurnId = useCopilotStore((s) => s.lastTurnId)

  const { data } = useQuery({
    queryKey: queryKeys.copilot.thread(threadId ?? "none"),
    queryFn: () => getCopilotThread(threadId!),
    enabled: Boolean(threadId),
    // While a turn streams, the live state is authoritative and refetching only
    // costs a request; the engine invalidates once the turn settles.
    staleTime: streaming ? Infinity : 5_000,
    // A server-side turn ends on its own schedule. Poll while one is live so
    // the composer unlocks by itself instead of stranding the user behind a
    // notice that never clears.
    refetchInterval: (query) => (query.state.data?.thread.status === "running" && !streaming ? 5_000 : false),
  })

  const thread = data?.thread ?? null
  const busy =
    thread?.status === "running" && !streaming
      ? // Our own turn survived its stream — the browser lost the connection,
        // the server kept working. Saying "another tab" here was the reported
        // bug, and it is the more alarming of the two messages.
        { kind: thread.activeTurnId && thread.activeTurnId === lastTurnId ? ("ours" as const) : ("other-tab" as const) }
      : null

  return { thread, messages: data?.messages ?? [], busy }
}

/** Ask/Auto, the auto-run credit ceiling, and permission to publish. */
export function useCopilotSettings(threadId: string | null) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (patch: { runMode?: CopilotRunMode; autoRunLimitCredits?: number; allowPublishing?: boolean }) => {
      if (!threadId) throw new Error("no thread")
      return updateCopilotThread(threadId, patch)
    },
    onSuccess: ({ thread }) => {
      copilotState().setRunSettings(thread.runMode, thread.autoRunLimitCredits, thread.allowPublishing ?? false)
      queryClient.setQueryData(queryKeys.copilot.forWorkflow(thread.workflowId), { thread })
      queryClient.invalidateQueries({ queryKey: queryKeys.copilot.thread(thread.id) })
    },
  })
}
