"use client"

import { useState, useEffect, useCallback } from "react"
import { RefreshCw, ChevronLeft, ChevronRight, Loader2, AlertCircle, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { getPredictions, type ReplicatePrediction } from "@/lib/api"
import { ExecutionDetailModal } from "./execution-detail-modal"

// Cost per second for Replicate predictions (approximate)
const COST_PER_SECOND = 0.000225

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSecs = Math.floor(diffMs / 1000)
  const diffMins = Math.floor(diffSecs / 60)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffSecs < 60) return "just now"
  if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? "s" : ""} ago`
  if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? "s" : ""} ago`
  if (diffDays < 7) return `${diffDays} day${diffDays !== 1 ? "s" : ""} ago`
  return date.toLocaleDateString()
}

function formatDuration(seconds: number | undefined): string {
  if (!seconds) return "-"
  if (seconds < 1) return `${(seconds * 1000).toFixed(0)}ms`
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}m ${secs.toFixed(0)}s`
}

function calculateCost(totalTime: number | undefined): string {
  if (!totalTime) return "-"
  const cost = totalTime * COST_PER_SECOND
  if (cost < 0.01) return `$${cost.toFixed(4)}`
  return `$${cost.toFixed(3)}`
}

function getQueueTime(prediction: ReplicatePrediction): string {
  if (!prediction.started_at) return "-"
  const created = new Date(prediction.created_at).getTime()
  const started = new Date(prediction.started_at).getTime()
  const queueMs = started - created
  if (queueMs < 1000) return `${queueMs}ms`
  return `${(queueMs / 1000).toFixed(1)}s`
}

function extractModelName(model: string): string {
  // model format: "owner/model-name" or "owner/model-name:version"
  const parts = model.split("/")
  if (parts.length > 1) {
    const modelPart = parts[1].split(":")[0]
    return modelPart
  }
  return model
}

interface ExecutionsTabProps {
  readonly className?: string
}

export function ExecutionsTab({ className = "" }: ExecutionsTabProps) {
  const [predictions, setPredictions] = useState<ReplicatePrediction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [prevCursor, setPrevCursor] = useState<string | null>(null)
  const [selectedPrediction, setSelectedPrediction] = useState<ReplicatePrediction | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const fetchData = useCallback(async (cursor?: string) => {
    try {
      setLoading(true)
      setError(null)
      const result = await getPredictions(cursor)
      setPredictions(result.data)
      setNextCursor(result.next)
      setPrevCursor(result.previous)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load predictions")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleRefresh = () => {
    setRefreshing(true)
    fetchData()
  }

  const handleNext = () => {
    if (nextCursor) {
      fetchData(nextCursor)
    }
  }

  const handlePrev = () => {
    if (prevCursor) {
      fetchData(prevCursor)
    }
  }

  const statusColors: Record<string, string> = {
    succeeded: "bg-green-500/20 text-green-400",
    failed: "bg-red-500/20 text-red-400",
    processing: "bg-yellow-500/20 text-yellow-400",
    starting: "bg-blue-500/20 text-blue-400",
    canceled: "bg-gray-500/20 text-gray-400",
  }

  if (loading && predictions.length === 0) {
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
        <p className="text-sm text-gray-500 dark:text-[#94A3B8] mb-4">{error}</p>
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
            disabled={refreshing}
            className="dark:border-[#2D2D2D] dark:hover:bg-[#2D2D2D]"
          >
            <RefreshCw className={`w-4 h-4 mr-1.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              onClick={handlePrev}
              disabled={!prevCursor || loading}
              className="h-8 w-8 dark:border-[#2D2D2D] dark:hover:bg-[#2D2D2D]"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={handleNext}
              disabled={!nextCursor || loading}
              className="h-8 w-8 dark:border-[#2D2D2D] dark:hover:bg-[#2D2D2D]"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto p-4">
        <div className="bg-white dark:bg-[#1E1E1E] rounded-xl border border-gray-200 dark:border-[#2D2D2D] overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 dark:bg-[#121212]">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-[#94A3B8] uppercase tracking-wider">
                  ID
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-[#94A3B8] uppercase tracking-wider">
                  Model
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-[#94A3B8] uppercase tracking-wider">
                  Source
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-[#94A3B8] uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-[#94A3B8] uppercase tracking-wider">
                  Queued
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-[#94A3B8] uppercase tracking-wider">
                  Running
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-[#94A3B8] uppercase tracking-wider">
                  Total
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-[#94A3B8] uppercase tracking-wider">
                  Cost
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-[#94A3B8] uppercase tracking-wider">
                  Created
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-[#94A3B8] uppercase tracking-wider">

                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-[#2D2D2D]">
              {predictions.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-gray-500 dark:text-[#94A3B8]">
                    No executions found
                  </td>
                </tr>
              ) : (
                predictions.map((prediction) => (
                  <tr
                    key={prediction.id}
                    className="hover:bg-gray-50 dark:hover:bg-[#2D2D2D] transition-colors cursor-pointer"
                    onClick={() => setSelectedPrediction(prediction)}
                  >
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelectedPrediction(prediction)
                        }}
                        className="text-sm font-mono text-[#ff0073] hover:underline"
                      >
                        {prediction.id.slice(0, 8)}...
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-gray-700 dark:text-[#E2E8F0] font-mono">
                        {extractModelName(prediction.model)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-gray-500 dark:text-[#94A3B8]">
                        {prediction.source || "API"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${statusColors[prediction.status] || "bg-gray-500/20 text-gray-400"}`}>
                        {prediction.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-gray-500 dark:text-[#94A3B8] font-mono">
                        {getQueueTime(prediction)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-gray-500 dark:text-[#94A3B8] font-mono">
                        {formatDuration(prediction.metrics?.predict_time)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-gray-500 dark:text-[#94A3B8] font-mono">
                        {formatDuration(prediction.metrics?.total_time)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-[#ff0073] font-mono">
                        {calculateCost(prediction.metrics?.total_time)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-gray-500 dark:text-[#94A3B8]">
                        {formatRelativeTime(prediction.created_at)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <a
                        href={`https://replicate.com/p/${prediction.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-gray-400 hover:text-[#ff0073] transition-colors"
                        title="View on Replicate"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail Modal */}
      <ExecutionDetailModal
        prediction={selectedPrediction}
        open={selectedPrediction !== null}
        onClose={() => setSelectedPrediction(null)}
      />
    </div>
  )
}
