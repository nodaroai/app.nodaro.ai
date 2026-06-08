import { useState } from "react"
import { Loader2, Square, ChevronDown, StopCircle, SkipForward, Trash2, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { discardWorkflowExecution, stopWorkflowExecution, getWorkflowExecution } from "@/lib/api"
import { hasCredits } from "@/lib/edition"
import { toast } from "sonner"
import { useQuery } from "@tanstack/react-query"
import { isNotFound } from "@/lib/api-errors"

interface ExecutionStatusBarProps {
  readonly executionId: string
  readonly onStopped: () => void
  readonly onRunInstead?: () => void
}

const TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "timed_out",
  "discarded",
])

/**
 * `refetchInterval` policy for the execution poll. Stop (return false) when the
 * run reaches a terminal status OR when the execution 404s — the row is gone, so
 * continued polling is just the "404 storm". Any other (transient) error keeps
 * the 3s cadence so a live run recovers from a network blip.
 */
export function executionStatusRefetchInterval(
  data: { status?: string } | undefined,
  error: unknown,
): number | false {
  if (data?.status && TERMINAL_STATUSES.has(data.status)) return false
  if (isNotFound(error)) return false
  return 3000
}

export function ExecutionStatusBar({ executionId, onStopped, onRunInstead }: ExecutionStatusBarProps) {
  const [stopping, setStopping] = useState(false)

  const { data: exec } = useQuery({
    queryKey: ["workflow-execution", executionId],
    queryFn: () => getWorkflowExecution(executionId),
    // Stop polling on a terminal status or a definitive 404 (execution gone);
    // keep the 3s cadence otherwise. Don't retry a 404 — it won't come back.
    refetchInterval: (query) => executionStatusRefetchInterval(query.state.data, query.state.error),
    retry: (failureCount, error) => !isNotFound(error) && failureCount < 3,
    enabled: !!executionId,
  })

  const status = exec?.status ?? "pending"
  const completed = exec?.completedNodes ?? 0
  const total = exec?.totalNodes ?? 0
  const credits = exec?.totalCreditsUsed ?? 0
  const isStopping = status === "stopping"
  const isDiscarded = status === "discarded"

  // Discard is non-destructive: it tells the backend to stop scheduling and
  // detaches the canvas, but it does NOT kill in-flight external-AI jobs — they
  // finish and land in My Library. The owner's onStopped + the stream's
  // onDiscarded handle node revert / UI cleanup (single source), so we do NOT
  // revert nodes here.
  const handleDiscard = async () => {
    setStopping(true)
    try {
      await discardWorkflowExecution(executionId)
      onStopped()
      toast.info("Run discarded — in-flight results will be saved to My Library")
    } catch {
      toast.error("Failed to discard execution")
    } finally {
      setStopping(false)
    }
  }

  const handleStopAfterCurrent = async () => {
    try {
      await stopWorkflowExecution(executionId)
      toast.info("Will stop after current node finishes")
    } catch {
      toast.error("Failed to stop execution")
    }
  }

  return (
    <div className="flex items-center gap-2 max-w-[90vw]">
      {/* Status pill */}
      <div
        className="flex items-center gap-2 rounded-full px-4 py-2 text-white text-sm font-medium whitespace-nowrap"
        style={{ backgroundColor: isDiscarded ? "#6b7280" : "#ff0073" }}
      >
        {isDiscarded ? (
          <StopCircle className="w-4 h-4" />
        ) : (
          <Loader2 className="w-4 h-4 animate-spin" />
        )}
        <span>
          {isDiscarded
            ? "Discarded"
            : isStopping
              ? "Stopping..."
              : status === "running"
                ? "Running"
                : "Pending"}
        </span>
        <span className="opacity-80">
          {completed}/{total} done
        </span>
        {hasCredits() && credits > 0 && (
          <span className="opacity-70">{credits} CR</span>
        )}
      </div>

      {/* Stop dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className="rounded-lg bg-background h-9 px-2 gap-1"
            disabled={stopping || isStopping || isDiscarded}
          >
            <Square className="w-3.5 h-3.5" />
            <ChevronDown className="w-3 h-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuItem onClick={handleDiscard}>
            <Trash2 className="w-4 h-4 mr-2" />
            Discard (save to Library, off canvas)
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleStopAfterCurrent}>
            <SkipForward className="w-4 h-4 mr-2" />
            Stop after current node
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onRunInstead?.()}>
            <RotateCcw className="w-4 h-4 mr-2" />
            Run instead
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
