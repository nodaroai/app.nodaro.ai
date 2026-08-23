/**
 * The run half of a turn: propose it, follow it, report how it ended.
 *
 * The copilot never starts a run itself — `run_workflow` is a proposal, and the
 * actual execution goes through the editor's own `handleRun` so trigger type,
 * progress streaming and reload-restore all behave exactly as a manual run.
 * This component is the bridge between the two, and the only place that reads
 * the execution's live status.
 *
 * It is rendered at PANEL level, not inside the live-turn block: the server
 * persists a turn's messages before it emits `done`, so the live block is
 * deduped away against history within a second or two — and a run outcome
 * outlives the turn that proposed it by design.
 */
import { useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import { getWorkflowExecution } from "@/lib/api"
import { executionStatusRefetchInterval } from "@/components/editor/execution-status-bar"
import { isNotFound } from "@/lib/api-errors"
import { COPILOT_STRINGS as S } from "@/ee/lib/copilot/strings"
import { useUserCredits } from "@/ee/hooks/queries/use-credits-queries"
import {
  abandonRunFollow,
  askForFix,
  clearRunFollow,
  noteExecutionStarted,
  reportRunOutcome,
  skipProposedRun,
  startProposedRun,
} from "@/ee/lib/copilot/turn-engine"
import { useCopilotStore } from "@/ee/lib/copilot/turn-store"
import { AutoRunNotice, RunFailedCard, RunProposalCard, RunSucceededCard, RunningCard } from "./copilot-cards"

const TERMINAL = new Set(["completed", "failed", "cancelled", "timed_out", "discarded"])
/** A run the user stopped is not an outcome to report or to fix. */
const USER_ENDED = new Set(["cancelled", "discarded"])

interface CopilotRunSectionProps {
  userId: string | undefined
  nodeCount: number
  onStopRun: () => void
}

export function CopilotRunSection({ userId, nodeCount, onStopRun }: CopilotRunSectionProps) {
  const runPhase = useCopilotStore((s) => s.runPhase)
  const proposalDismissed = useCopilotStore((s) => s.proposalDismissed)
  const proposal = useCopilotStore((s) => s.turn.proposal)
  const runMode = useCopilotStore((s) => s.runMode)
  const autoRunLimit = useCopilotStore((s) => s.autoRunLimit)
  const estimate = useCopilotStore((s) => s.bridge.creditEstimate)
  const estimateStale = useCopilotStore((s) => s.bridge.estimateStale)
  const isRunning = useCopilotStore((s) => s.bridge.isRunning)
  const activeExecutionId = useCopilotStore((s) => s.bridge.activeExecutionId)
  const executionId = useCopilotStore((s) => s.executionId)
  const streaming = useCopilotStore((s) => s.streaming)
  const { data: balance } = useUserCredits(userId)

  // Adopt whichever execution the editor started for us.
  useEffect(() => {
    if (activeExecutionId) noteExecutionStarted(activeExecutionId)
  }, [activeExecutionId])

  const { data: execution, error: executionError } = useQuery({
    // Shared with ExecutionStatusBar — one poll drives both. The retry policy
    // must match that observer's, or this one flips the shared query back to
    // three blind retries on a 404.
    queryKey: ["workflow-execution", executionId],
    queryFn: () => getWorkflowExecution(executionId!),
    refetchInterval: (query) => executionStatusRefetchInterval(query.state.data, query.state.error),
    retry: (failureCount, error) => !isNotFound(error) && failureCount < 3,
    enabled: Boolean(executionId),
  })

  // Polling gave up: the execution is gone. Saying so beats sitting on
  // "Running" forever — in Auto mode nobody is watching that card.
  useEffect(() => {
    if (executionId && isNotFound(executionError)) abandonRunFollow(S.runVanished)
  }, [executionId, executionError])

  useEffect(() => {
    if (!executionId || !execution || !TERMINAL.has(execution.status)) return
    // The user pressing Stop is not a failure to fix — and in Auto mode
    // treating it as one would start another paid turn they did not ask for.
    if (USER_ENDED.has(execution.status)) {
      clearRunFollow()
      return
    }
    reportRunOutcome(executionId, execution.status === "completed" ? "succeeded" : "failed")
  }, [execution, executionId])

  const stop = () => {
    clearRunFollow()
    onStopRun()
  }

  if (runPhase === "proposed" && proposal && !proposalDismissed) {
    return (
      <RunProposalCard
        estimate={estimate}
        estimateStale={estimateStale}
        nodeCount={nodeCount}
        balance={balance?.total ?? null}
        overLimit={runMode === "auto" && !estimateStale && estimate > autoRunLimit}
        ceiling={autoRunLimit}
        onRun={startProposedRun}
        onSkip={skipProposedRun}
        disabled={isRunning}
      />
    )
  }

  if (runPhase === "running") {
    if (!executionId) return <AutoRunNotice estimate={estimate} ceiling={autoRunLimit} stale={estimateStale} />
    return (
      <RunningCard
        completed={execution?.completedNodes ?? 0}
        total={execution?.totalNodes ?? 0}
        credits={execution?.totalCreditsUsed ?? 0}
        onStop={stop}
      />
    )
  }

  if (runPhase === "succeeded") {
    return <RunSucceededCard credits={execution?.totalCreditsUsed ?? 0} />
  }

  if (runPhase === "failed") {
    return (
      <RunFailedCard
        credits={execution?.totalCreditsUsed ?? 0}
        failedStep={execution?.completedNodes != null ? execution.completedNodes + 1 : null}
        message={execution?.errorMessage ?? null}
        onFix={askForFix}
        disabled={streaming}
      />
    )
  }

  return null
}
