import React, { useState, useCallback } from "react"
import { Link } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronRight as ChevronRightIcon,
  Loader2,
  AlertCircle,
  Coins,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useAuth } from "@/hooks/use-auth"
import { hasCredits } from "@/lib/edition"
import { queryKeys } from "@/lib/query-keys"
import { useGlobalExecutions } from "@/hooks/queries/use-execution-queries"
import {
  STATUS_COLORS,
  NODE_STATUS_DOT,
  formatRelativeTime,
  formatDuration,
  formatNodeType,
  type NodeState,
} from "@/components/editor/execution-utils"
import { TriggerBadge } from "@/components/library/triggers/TriggerBadge"
import { ExecutionDetailModal } from "@/components/editor/execution-detail-modal"
import { useBackToClose } from "@/hooks/use-back-to-close"
import { getJobStatus, type GlobalExecution } from "@/lib/api"

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "running", label: "Running" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
  { value: "pending", label: "Pending" },
  { value: "cancelled", label: "Cancelled" },
]

export default function ExecutionsPage() {
  const { isAdmin } = useAuth()
  const qc = useQueryClient()

  const [viewAll, setViewAll] = useState(() => {
    if (!isAdmin) return false
    return localStorage.getItem("nodaro-admin-view-all-executions") === "true"
  })
  const [statusFilter, setStatusFilter] = useState("all")
  const [cursor, setCursor] = useState<string | undefined>()
  const [prevCursors, setPrevCursors] = useState<string[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [selectedNodeInfo, setSelectedNodeInfo] = useState<{ nodeId: string; state: NodeState } | null>(null)

  const handleNodeClick = useCallback((nodeId: string, state: NodeState) => {
    if (state.jobId) {
      setSelectedJobId(state.jobId)
      setSelectedNodeInfo(null)
    } else {
      setSelectedNodeInfo({ nodeId, state })
      setSelectedJobId(null)
    }
  }, [])

  const isModalOpen = selectedJobId !== null || selectedNodeInfo !== null
  const closeModal = useCallback(() => {
    setSelectedJobId(null)
    setSelectedNodeInfo(null)
  }, [])
  useBackToClose(isModalOpen, closeModal)

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

  const handleViewAllChange = (checked: boolean) => {
    setViewAll(checked)
    localStorage.setItem("nodaro-admin-view-all-executions", String(checked))
    setCursor(undefined)
    setPrevCursors([])
  }

  const handleStatusChange = (value: string) => {
    setStatusFilter(value)
    setCursor(undefined)
    setPrevCursors([])
  }

  const showAll = isAdmin && viewAll

  const { data, isLoading, error } = useGlobalExecutions({
    cursor,
    status: statusFilter === "all" ? undefined : statusFilter,
    viewAll: showAll,
  })

  const executions = data?.data ?? []
  const nextCursor = data?.nextCursor ?? undefined

  const handleRefresh = () => {
    setCursor(undefined)
    setPrevCursors([])
    qc.invalidateQueries({ queryKey: queryKeys.executions.all })
  }

  const handleNext = () => {
    if (nextCursor) {
      setPrevCursors((prev) => [...prev, cursor ?? ""])
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

  // +1 for expand chevron column
  const colCount = 7 + (showAll ? 1 : 0) + (hasCredits() ? 1 : 0)

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 sm:mb-6">
        <h1 className="text-xl sm:text-2xl font-bold">Executions</h1>
        <div className="flex items-center gap-3">
          {isAdmin && (
            <div className="flex items-center gap-2">
              <Switch
                id="view-all-executions"
                checked={viewAll}
                onCheckedChange={handleViewAllChange}
              />
              <Label htmlFor="view-all-executions" className="text-sm text-muted-foreground cursor-pointer whitespace-nowrap">
                All users
              </Label>
            </div>
          )}
          <Select value={statusFilter} onValueChange={handleStatusChange}>
            <SelectTrigger className="w-[150px] h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isLoading}
          >
            <RefreshCw className={`w-4 h-4 mr-1.5 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              onClick={handlePrev}
              disabled={prevCursors.length === 0 || isLoading}
              aria-label="Previous page"
              className="h-8 w-8"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={handleNext}
              disabled={!nextCursor || isLoading}
              aria-label="Next page"
              className="h-8 w-8"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      {isLoading && executions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24">
          <Loader2 className="w-8 h-8 animate-spin text-[#ff0073] mb-4" />
          <p className="text-sm text-muted-foreground">Loading executions...</p>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-24">
          <AlertCircle className="w-12 h-12 text-red-400 mb-4" />
          <h3 className="text-lg font-semibold mb-2">Failed to load executions</h3>
          <p className="text-sm text-muted-foreground mb-4">{error.message}</p>
          <Button onClick={handleRefresh} variant="outline">
            <RefreshCw className="w-4 h-4 mr-2" />
            Retry
          </Button>
        </div>
      ) : (
        <div className="bg-white dark:bg-[#1E1E1E] rounded-xl border border-gray-200 dark:border-[#2D2D2D] overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 dark:bg-[#121212]">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-[#94A3B8] uppercase tracking-wider w-8" />
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-[#94A3B8] uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-[#94A3B8] uppercase tracking-wider">
                  Workflow
                </th>
                {showAll && (
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-[#94A3B8] uppercase tracking-wider">
                    Owner
                  </th>
                )}
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
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-[#2D2D2D]">
              {executions.length === 0 ? (
                <tr>
                  <td colSpan={colCount} className="px-4 py-12 text-center text-gray-500 dark:text-[#94A3B8]">
                    No workflow executions yet.
                  </td>
                </tr>
              ) : (
                executions.map((exec) => {
                  const nodeStates = (exec.nodeStates ?? {}) as Record<string, NodeState>
                  const nodeEntries = Object.entries(nodeStates).filter(
                    ([, s]) => s.status !== "skipped" && !(s.status === "completed" && !s.startedAt),
                  )
                  return (
                    <GlobalExecutionRow
                      key={exec.id}
                      exec={exec}
                      showOwner={showAll}
                      isExpanded={expandedId === exec.id}
                      nodeEntries={nodeEntries}
                      colCount={colCount}
                      onToggle={() => setExpandedId(expandedId === exec.id ? null : exec.id)}
                      onNodeClick={handleNodeClick}
                    />
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      <ExecutionDetailModal
        job={selectedJob ?? null}
        open={!!selectedJobId && !!selectedJob}
        onClose={() => { setSelectedJobId(null); setSelectedNodeInfo(null) }}
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

function GlobalExecutionRow({
  exec,
  showOwner,
  isExpanded,
  nodeEntries,
  colCount,
  onToggle,
  onNodeClick,
}: {
  exec: GlobalExecution
  showOwner: boolean
  isExpanded: boolean
  nodeEntries: [string, NodeState][]
  colCount: number
  onToggle: () => void
  onNodeClick: (nodeId: string, state: NodeState) => void
}) {
  const completed = exec.completedNodes ?? 0
  const failed = exec.failedNodes ?? 0
  const total = exec.totalNodes ?? 0

  const workflowLink = exec.projectId && exec.workflowId
    ? `/projects/${exec.projectId}/workflows/${exec.workflowId}`
    : null

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
          <span
            className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${
              STATUS_COLORS[exec.status] || "bg-gray-100 text-gray-700 dark:bg-gray-500/20 dark:text-gray-400"
            }`}
          >
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
          {workflowLink ? (
            <Link
              to={workflowLink}
              className="text-sm text-[#ff0073] hover:underline truncate max-w-[200px] block"
              onClick={(e) => e.stopPropagation()}
            >
              {exec.workflowName ?? "Untitled"}
            </Link>
          ) : (
            <span className="text-sm text-gray-400 dark:text-[#64748B] italic">
              Deleted workflow
            </span>
          )}
        </td>
        {showOwner && (
          <td className="px-4 py-3">
            <span className="text-sm text-gray-500 dark:text-[#94A3B8] truncate max-w-[180px] block">
              {exec.ownerEmail ?? "-"}
            </span>
          </td>
        )}
        <td className="px-4 py-3">
          <TriggerBadge triggerType={exec.triggerType} mcpClient={exec.mcpClient} />
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
              ) : (
                "-"
              )}
            </span>
          </td>
        )}
        <td className="px-4 py-3">
          <span className="text-sm text-gray-500 dark:text-[#94A3B8]">
            {formatRelativeTime(exec.createdAt)}
          </span>
        </td>
      </tr>
      {isExpanded && nodeEntries.length > 0 && (
        <tr>
          <td colSpan={colCount} className="px-0 py-0">
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
                        {/* Main node row */}
                        <tr
                          className={!hasFanOut ? "hover:bg-gray-100/50 dark:hover:bg-[#1E1E1E] cursor-pointer transition-colors" : ""}
                          onClick={!hasFanOut ? () => onNodeClick(nodeId, state) : undefined}
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
                            {!hasFanOut && (
                              <ChevronRightIcon className="w-3.5 h-3.5 text-gray-300 dark:text-[#64748B]" />
                            )}
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
                              <span className="text-[11px] text-gray-400">Iteration {idx + 1}</span>
                            </td>
                            <td className="px-3 py-1">
                              <span className="inline-flex px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400">
                                completed
                              </span>
                            </td>
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
