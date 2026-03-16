import { useState } from "react"
import { Loader2, Square, ChevronDown, StopCircle, SkipForward } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cancelWorkflowExecution, stopWorkflowExecution, getWorkflowExecution } from "@/lib/api"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { hasCredits } from "@/lib/edition"
import { toast } from "sonner"
import { useQuery } from "@tanstack/react-query"

interface ExecutionStatusBarProps {
  readonly executionId: string
  readonly onStopped: () => void
}

export function ExecutionStatusBar({ executionId, onStopped }: ExecutionStatusBarProps) {
  const [stopping, setStopping] = useState(false)

  const { data: exec } = useQuery({
    queryKey: ["workflow-execution", executionId],
    queryFn: () => getWorkflowExecution(executionId),
    refetchInterval: 3000,
    enabled: !!executionId,
  })

  const status = exec?.status ?? "pending"
  const completed = exec?.completedNodes ?? 0
  const total = exec?.totalNodes ?? 0
  const credits = exec?.totalCreditsUsed ?? 0
  const isStopping = status === "stopping"

  const handleCancelNow = async () => {
    setStopping(true)
    try {
      await cancelWorkflowExecution(executionId)
      // Clear running node states in the UI
      const { nodes, updateNodeData } = useWorkflowStore.getState()
      for (const node of nodes) {
        const s = (node.data as Record<string, unknown>).executionStatus
        if (s === "running" || s === "pending") {
          updateNodeData(node.id, { executionStatus: "idle" })
        }
      }
      onStopped()
      toast.info("Execution cancelled")
    } catch {
      toast.error("Failed to cancel execution")
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
      <div className="flex items-center gap-2 rounded-full px-4 py-2 text-white text-sm font-medium whitespace-nowrap" style={{ backgroundColor: "#ff0073" }}>
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>
          {isStopping ? "Stopping..." : status === "running" ? "Running" : "Pending"}
        </span>
        <span className="opacity-80">
          {completed}/{total} nodes
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
            size="icon"
            className="rounded-lg bg-background"
            disabled={stopping || isStopping}
          >
            <Square className="w-4 h-4" />
            <ChevronDown className="w-3 h-3 ml-0.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onClick={handleCancelNow} className="text-red-600 dark:text-red-400">
            <StopCircle className="w-4 h-4 mr-2" />
            Stop now
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleStopAfterCurrent}>
            <SkipForward className="w-4 h-4 mr-2" />
            Stop after current node
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
