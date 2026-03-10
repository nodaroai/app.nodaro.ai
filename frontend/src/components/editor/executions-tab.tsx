import React, { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { RefreshCw, ChevronLeft, ChevronRight, Loader2, AlertCircle, XCircle, ChevronDown, ChevronRight as ChevronRightIcon, Coins, Activity } from "lucide-react"
import { Button } from "@/components/ui/button"
import { listWorkflowExecutions, cancelWorkflowExecution, stopWorkflowExecution, getJobs, getJobStatus, type WorkflowExecution, type Job } from "@/lib/api"
import { hasCredits } from "@/lib/edition"
import { toast } from "sonner"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { ExecutionDetailModal } from "./execution-detail-modal"
import {
  STATUS_COLORS,
  TRIGGER_LABELS,
  NODE_STATUS_DOT,
  JOB_TYPE_LABELS,
  formatRelativeTime,
  formatDuration,
  formatNodeType,
  type NodeState,
} from "./execution-utils"

interface ExecutionsTabProps {
  readonly className?: string
  readonly workflowId?: string | null
}

export function ExecutionsTab({ className = "", workflowId }: ExecutionsTabProps) {
  const qc = useQueryClient()
  const [cursor, setCursor] = useState<string | undefined>()
  const [prevCursors, setPrevCursors] = useState<string[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [selectedNodeInfo, setSelectedNodeInfo] = useState<{ nodeId: string; state: NodeState } | null>(null)

  // Fetch full job data when a node is clicked (auto-refresh while in-progress)
  const { data: selectedJob } = useQuery({
    queryKey: ["job-detail", selectedJobId],
    queryFn: () => getJobStatus(selectedJobId!),
    enabled: !!selectedJobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status as string | undefined
      if (status && !["completed", "failed", "cancelled"].includes(status)) {
        return 3_000
      }
      return false
    },
  })

  function handleNodeClick(nodeId: string, state: NodeState) {
    if (state.jobId) {
      setSelectedJobId(state.jobId)
      setSelectedNodeInfo(null)
    } else {
      setSelectedNodeInfo({ nodeId, state })
      setSelectedJobId(null)
    }
  }

  const { data, isLoading: loading, error } = useQuery({
    queryKey: ["workflow-executions", workflowId, cursor],
    queryFn: () => listWorkflowExecutions(workflowId!, { limit: 20, cursor }),
    enabled: !!workflowId,
    refetchInterval: 10_000,
  })
  const executions = data?.data ?? []
  const nextCursor = data?.nextCursor ?? null

  const handleRefresh = () => {
    setCursor(undefined)
    setPrevCursors([])
    qc.invalidateQueries({ queryKey: ["workflow-executions", workflowId] })
  }

  const handleNext = () => {
    if (nextCursor) {
      setPrevCursors(prev => [...prev, cursor ?? ""])
      setCursor(nextCursor)
    }
  }

  const handlePrev = () => {
    if (prevCursors.length > 0) {
      const newPrev = prevCursors.slice(0, -1)
      setPrevCursors(newPrev)
      setCursor(newPrev[newPrev.length - 1] || undefined)
    } else {
      setCursor(undefined)
      setPrevCursors([])
    }
  }

  const handleCancel = async (execId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setCancellingId(execId)
    try {
      await cancelWorkflowExecution(execId)
      qc.invalidateQueries({ queryKey: ["workflow-executions", workflowId] })
      toast.info("Execution cancelled")
    } catch {
      toast.error("Failed to cancel execution")
    } finally {
      setCancellingId(null)
    }
  }

  const handleStopAfterCurrent = async (execId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await stopWorkflowExecution(execId)
      qc.invalidateQueries({ queryKey: ["workflow-executions", workflowId] })
      toast.info("Will stop after current node finishes")
    } catch {
      toast.error("Failed to stop execution")
    }
  }

  if (!workflowId) {
    return (
      <div className={`flex-1 flex flex-col items-center justify-center bg-[#F8FAFC] dark:bg-[#121212] ${className}`}>
        <p className="text-sm text-gray-500 dark:text-[#94A3B8]">Save the workflow to see execution history.</p>
      </div>
    )
  }

  if (loading && executions.length === 0) {
    return (
      <div className={`flex-1 flex flex-col items-center justify-center bg-[#F8FAFC] dark:bg-[#121212] ${className}`}>
        <Loader2 className="w-8 h-8 animate-spin text-[#ff0073] mb-4" />
        <p className="text-sm text-gray-500 dark:text-[#94A3B8]">Loading executions...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className={`flex-1 flex flex-col items-center justify-center bg-[#F8FAFC] dark:bg-[#121212] ${className}`}>
        <AlertCircle className="w-12 h-12 text-red-400 mb-4" />
        <h3 className="text-lg font-semibold text-gray-700 dark:text-[#E2E8F0] mb-2">Failed to load executions</h3>
        <p className="text-sm text-gray-500 dark:text-[#94A3B8] mb-4">{error.message}</p>
        <Button onClick={handleRefresh} variant="outline">
          <RefreshCw className="w-4 h-4 mr-2" />
          Retry
        </Button>
      </div>
    )
  }

  return (
    <div className={`flex-1 flex flex-col bg-[#F8FAFC] dark:bg-[#121212] ${className}`}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-gray-200 dark:border-[#2D2D2D]">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-[#E2E8F0]">
          Execution History
        </h2>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={loading}
            className="dark:border-[#2D2D2D] dark:hover:bg-[#2D2D2D]"
          >
            <RefreshCw className={`w-4 h-4 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              onClick={handlePrev}
              disabled={prevCursors.length === 0 || loading}
              aria-label="Previous page"
              className="h-8 w-8 dark:border-[#2D2D2D] dark:hover:bg-[#2D2D2D]"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={handleNext}
              disabled={!nextCursor || loading}
              aria-label="Next page"
              className="h-8 w-8 dark:border-[#2D2D2D] dark:hover:bg-[#2D2D2D]"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Table + Activity */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        <div className="bg-white dark:bg-[#1E1E1E] rounded-xl border border-gray-200 dark:border-[#2D2D2D] overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 dark:bg-[#121212]">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-[#94A3B8] uppercase tracking-wider w-8" />
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-[#94A3B8] uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-[#94A3B8] uppercase tracking-wider">
                  Trigger
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-[#94A3B8] uppercase tracking-wider">
                  Progress
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-[#94A3B8] uppercase tracking-wider">
                  Duration
                </th>
                {hasCredits() && (
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-[#94A3B8] uppercase tracking-wider">
                    Credits
                  </th>
                )}
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-[#94A3B8] uppercase tracking-wider">
                  Created
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-[#94A3B8] uppercase tracking-wider w-20" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-[#2D2D2D]">
              {executions.length === 0 ? (
                <tr>
                  <td colSpan={hasCredits() ? 8 : 7} className="px-4 py-12 text-center text-gray-500 dark:text-[#94A3B8]">
                    No executions yet. Run the workflow to see history here.
                  </td>
                </tr>
              ) : (
                executions.map((exec) => {
                  const isExpanded = expandedId === exec.id
                  const nodeStates = (exec.nodeStates ?? {}) as Record<string, NodeState>
                  // Only show nodes that actually executed (not source/skipped pre-completed nodes)
                  const nodeEntries = Object.entries(nodeStates).filter(
                    ([, s]) => s.status !== "skipped" && !(s.status === "completed" && !s.startedAt),
                  )
                  const isActive = exec.status === "pending" || exec.status === "running" || exec.status === "stopping"

                  return (
                    <ExecutionRow
                      key={exec.id}
                      exec={exec}
                      isExpanded={isExpanded}
                      nodeEntries={nodeEntries}
                      isActive={isActive}
                      cancellingId={cancellingId}
                      onToggle={() => setExpandedId(isExpanded ? null : exec.id)}
                      onCancel={handleCancel}
                      onStopAfterCurrent={handleStopAfterCurrent}
                      onNodeClick={handleNodeClick}
                    />
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        <RecentActivity />
      </div>

      <ExecutionDetailModal
        job={selectedJob ?? null}
        open={!!selectedJobId && !!selectedJob}
        onClose={() => setSelectedJobId(null)}
      />
      <ExecutionDetailModal
        job={null}
        open={!!selectedNodeInfo}
        onClose={() => setSelectedNodeInfo(null)}
        nodeInfo={selectedNodeInfo ?? undefined}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Recent Activity — shows user's recent jobs (across all workflows)
// ---------------------------------------------------------------------------

const JOB_STATUS_COLORS: Record<string, string> = {
  completed: "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400",
  failed: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400",
  processing: "bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-400",
  pending: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400",
  queued: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400",
  cancelled: "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400",
}

function RecentActivity() {
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [jobCursor, setJobCursor] = useState<string | undefined>()
  const [selectedJob, setSelectedJob] = useState<Job | null>(null)

  const { data: jobsData, isLoading: jobsLoading } = useQuery({
    queryKey: ["recent-jobs", jobCursor],
    queryFn: () => getJobs(undefined, jobCursor, 20),
    enabled: expanded,
  })
  const jobs = jobsData?.data ?? []
  const nextJobCursor = jobsData?.next ?? null

  return (
    <div className="bg-white dark:bg-[#1E1E1E] rounded-xl border border-gray-200 dark:border-[#2D2D2D] overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-[#2D2D2D] transition-colors"
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-gray-400" />
        ) : (
          <ChevronRightIcon className="w-4 h-4 text-gray-400" />
        )}
        <Activity className="w-4 h-4 text-gray-400" />
        <span className="text-sm font-semibold text-gray-700 dark:text-[#E2E8F0]">
          Recent Activity
        </span>
        <span className="text-xs text-gray-400 dark:text-[#64748B]">
          All jobs across workflows
        </span>
      </button>

      {expanded && (
        <div className="border-t border-gray-100 dark:border-[#2D2D2D]">
          {jobsLoading && jobs.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-[#ff0073]" />
            </div>
          ) : jobs.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-500 dark:text-[#94A3B8]">
              No recent jobs found.
            </div>
          ) : (
            <>
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 dark:bg-[#121212]">
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-[#94A3B8] uppercase tracking-wider">
                      Type
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-[#94A3B8] uppercase tracking-wider">
                      Status
                    </th>
                    {hasCredits() && (
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-[#94A3B8] uppercase tracking-wider">
                        Credits
                      </th>
                    )}
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-[#94A3B8] uppercase tracking-wider">
                      Duration
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-[#94A3B8] uppercase tracking-wider">
                      Created
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-[#2D2D2D]">
                  {jobs.map((job) => (
                    <JobRow key={job.id} job={job} onClick={() => setSelectedJob(job)} />
                  ))}
                </tbody>
              </table>
              {nextJobCursor && (
                <div className="flex justify-center py-3 border-t border-gray-100 dark:border-[#2D2D2D]">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setJobCursor(nextJobCursor)}
                    disabled={jobsLoading}
                  >
                    {jobsLoading ? (
                      <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                    ) : null}
                    Load more
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}
      <ExecutionDetailModal
        job={selectedJob}
        open={!!selectedJob}
        onClose={() => setSelectedJob(null)}
        onDeleted={() => {
          setSelectedJob(null)
          qc.invalidateQueries({ queryKey: ["recent-jobs"] })
        }}
      />
    </div>
  )
}

function JobRow({ job, onClick }: { job: Job; onClick: () => void }) {
  const label = job.job_type ? (JOB_TYPE_LABELS[job.job_type] ?? job.job_type) : "Job"
  const credits = job.credits_estimated ?? 0

  return (
    <tr className="hover:bg-gray-50 dark:hover:bg-[#2D2D2D] transition-colors cursor-pointer" onClick={onClick}>
      <td className="px-4 py-2.5">
        <span className="text-sm text-gray-700 dark:text-[#E2E8F0]">
          {label}
        </span>
      </td>
      <td className="px-4 py-2.5">
        <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${JOB_STATUS_COLORS[job.status] || "bg-gray-100 text-gray-700 dark:bg-gray-500/20 dark:text-gray-400"}`}>
          {job.status}
        </span>
      </td>
      {hasCredits() && (
        <td className="px-4 py-2.5">
          <span className="text-sm text-[#ff0073] font-mono">
            {credits > 0 ? (
              <span className="inline-flex items-center gap-1">
                <Coins className="w-3 h-3" />
                {credits}
              </span>
            ) : "-"}
          </span>
        </td>
      )}
      <td className="px-4 py-2.5">
        <span className="text-sm text-gray-500 dark:text-[#94A3B8] font-mono">
          {formatDuration(job.started_at, job.completed_at)}
        </span>
      </td>
      <td className="px-4 py-2.5">
        <span className="text-sm text-gray-500 dark:text-[#94A3B8]">
          {formatRelativeTime(job.created_at)}
        </span>
      </td>
    </tr>
  )
}

function ExecutionRow({
  exec,
  isExpanded,
  nodeEntries,
  isActive,
  cancellingId,
  onToggle,
  onCancel,
  onStopAfterCurrent,
  onNodeClick,
}: {
  exec: WorkflowExecution
  isExpanded: boolean
  nodeEntries: [string, NodeState][]
  isActive: boolean
  cancellingId: string | null
  onToggle: () => void
  onCancel: (id: string, e: React.MouseEvent) => void
  onStopAfterCurrent: (id: string, e: React.MouseEvent) => void
  onNodeClick: (nodeId: string, state: NodeState) => void
}) {
  const completed = exec.completedNodes ?? 0
  const failed = exec.failedNodes ?? 0
  const total = exec.totalNodes ?? 0

  return (
    <>
      <tr
        className="hover:bg-gray-50 dark:hover:bg-[#2D2D2D] transition-colors cursor-pointer"
        onClick={onToggle}
      >
        <td className="px-4 py-3">
          {nodeEntries.length > 0 ? (
            isExpanded ? (
              <ChevronDown className="w-4 h-4 text-gray-400" />
            ) : (
              <ChevronRightIcon className="w-4 h-4 text-gray-400" />
            )
          ) : null}
        </td>
        <td className="px-4 py-3">
          <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_COLORS[exec.status] || "bg-gray-100 text-gray-700 dark:bg-gray-500/20 dark:text-gray-400"}`}>
            {exec.status === "stopping" ? "stopping" : exec.status}
          </span>
          {exec.errorMessage && exec.status === "failed" && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <AlertCircle className="w-3.5 h-3.5 text-red-400 ml-1.5 inline" />
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs">
                  <p className="text-xs">{exec.errorMessage}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </td>
        <td className="px-4 py-3">
          <span className="text-sm text-gray-500 dark:text-[#94A3B8]">
            {TRIGGER_LABELS[exec.triggerType] ?? exec.triggerType}
          </span>
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-700 dark:text-[#E2E8F0] font-mono">
              {completed}/{total}
            </span>
            {failed > 0 && (
              <span className="text-xs text-red-500 font-medium">
                ({failed} failed)
              </span>
            )}
            {total > 0 && (
              <div className="w-16 h-1.5 bg-gray-200 dark:bg-[#2D2D2D] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.round((completed / total) * 100)}%`,
                    backgroundColor: failed > 0 ? "#ef4444" : "#ff0073",
                  }}
                />
              </div>
            )}
          </div>
        </td>
        <td className="px-4 py-3">
          <span className="text-sm text-gray-500 dark:text-[#94A3B8] font-mono">
            {formatDuration(exec.startedAt, exec.completedAt)}
          </span>
        </td>
        {hasCredits() && (
          <td className="px-4 py-3">
            <span className="text-sm text-[#ff0073] font-mono">
              {exec.totalCreditsUsed > 0 ? (
                <span className="inline-flex items-center gap-1">
                  <Coins className="w-3 h-3" />
                  {exec.totalCreditsUsed}
                </span>
              ) : "-"}
            </span>
          </td>
        )}
        <td className="px-4 py-3">
          <span className="text-sm text-gray-500 dark:text-[#94A3B8]">
            {formatRelativeTime(exec.createdAt)}
          </span>
        </td>
        <td className="px-4 py-3">
          {isActive && (
            <div className="flex items-center gap-1">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10"
                      onClick={(e) => onCancel(exec.id, e)}
                      disabled={cancellingId === exec.id}
                      aria-label="Cancel execution"
                    >
                      {cancellingId === exec.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <XCircle className="w-4 h-4" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    <p>Cancel now</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              {exec.status === "running" && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-orange-500 hover:text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-500/10"
                        onClick={(e) => onStopAfterCurrent(exec.id, e)}
                        aria-label="Stop after current node"
                      >
                        <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
                          <rect x="2" y="3" width="4" height="10" rx="1" />
                          <rect x="8" y="3" width="4" height="10" rx="1" />
                        </svg>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="left">
                      <p>Stop after current node</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
          )}
        </td>
      </tr>
      {isExpanded && nodeEntries.length > 0 && (
        <tr>
          <td colSpan={hasCredits() ? 8 : 7} className="px-0 py-0">
            <div className="bg-gray-50/50 dark:bg-[#161616] border-t border-gray-100 dark:border-[#2D2D2D]">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="px-8 py-2 text-left text-[10px] font-semibold text-gray-400 dark:text-[#64748B] uppercase tracking-wider">Node</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-400 dark:text-[#64748B] uppercase tracking-wider">Status</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-400 dark:text-[#64748B] uppercase tracking-wider">Duration</th>
                    {hasCredits() && (
                      <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-400 dark:text-[#64748B] uppercase tracking-wider">Credits</th>
                    )}
                    <th className="px-3 py-2 w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100/50 dark:divide-[#2D2D2D]/50">
                  {nodeEntries.map(([nodeId, state]) => {
                    const hasFanOut = state.jobIds && state.jobIds.length > 1
                    const nodeName = state.nodeType ? formatNodeType(state.nodeType) : nodeId.slice(0, 12)
                    return (
                      <React.Fragment key={nodeId}>
                        {/* Main node row — for fan-out, shows aggregate; for normal, opens job */}
                        <tr
                          className="hover:bg-gray-100/50 dark:hover:bg-[#1E1E1E] cursor-pointer transition-colors"
                          onClick={() => hasFanOut ? undefined : onNodeClick(nodeId, state)}
                        >
                          <td className="px-8 py-1.5">
                            <div className="flex items-center gap-2">
                              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${NODE_STATUS_DOT[state.status] ?? "bg-gray-400"}`} />
                              <span className="text-xs text-gray-600 dark:text-[#94A3B8]">
                                {nodeName}
                              </span>
                              {hasFanOut && (
                                <span className="inline-flex px-1.5 py-0.5 text-[9px] font-medium rounded-full bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-400">
                                  &times;{state.jobIds!.length}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-1.5">
                            <span className={`inline-flex px-1.5 py-0.5 text-[10px] font-medium rounded-full ${
                              STATUS_COLORS[state.status] || "bg-gray-100 text-gray-700 dark:bg-gray-500/20 dark:text-gray-400"
                            }`}>
                              {state.status}
                            </span>
                            {state.error && (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <AlertCircle className="w-3 h-3 text-red-400 ml-1 inline" />
                                  </TooltipTrigger>
                                  <TooltipContent side="right" className="max-w-xs">
                                    <p className="text-xs">{state.error}</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            )}
                          </td>
                          <td className="px-3 py-1.5">
                            <span className="text-xs text-gray-500 dark:text-[#94A3B8] font-mono">
                              {formatDuration(state.startedAt, state.completedAt)}
                            </span>
                          </td>
                          {hasCredits() && (
                            <td className="px-3 py-1.5">
                              <span className="text-xs text-[#ff0073] font-mono">
                                {state.creditsUsed && state.creditsUsed > 0 ? (
                                  <span className="inline-flex items-center gap-0.5">
                                    <Coins className="w-3 h-3" />
                                    {state.creditsUsed}
                                  </span>
                                ) : "-"}
                              </span>
                            </td>
                          )}
                          <td className="px-3 py-1.5">
                            {!hasFanOut && <ChevronRightIcon className="w-3.5 h-3.5 text-gray-300 dark:text-[#64748B]" />}
                          </td>
                        </tr>
                        {/* Fan-out iteration sub-rows */}
                        {hasFanOut && state.jobIds!.map((jid, idx) => (
                          <tr
                            key={`${nodeId}-iter-${idx}`}
                            className="hover:bg-gray-100/50 dark:hover:bg-[#1E1E1E] cursor-pointer transition-colors"
                            onClick={() => onNodeClick(`${nodeId}-iter-${idx}`, { ...state, jobId: jid, jobIds: undefined })}
                          >
                            <td className="px-8 py-1 pl-14">
                              <span className="text-[11px] text-gray-400 dark:text-[#64748B]">
                                Iteration {idx + 1}
                              </span>
                            </td>
                            <td className="px-3 py-1" />
                            <td className="px-3 py-1" />
                            {hasCredits() && <td className="px-3 py-1" />}
                            <td className="px-3 py-1">
                              <ChevronRightIcon className="w-3.5 h-3.5 text-gray-300 dark:text-[#64748B]" />
                            </td>
                          </tr>
                        ))}
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
