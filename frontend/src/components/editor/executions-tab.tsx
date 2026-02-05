"use client"

import { useState, useEffect, useCallback } from "react"
import { RefreshCw, ChevronLeft, ChevronRight, Loader2, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { getJobs, type Job } from "@/lib/api"
import { ExecutionDetailModal } from "./execution-detail-modal"
import { useAuth } from "@/hooks/use-auth"
import { EDITION } from "@/lib/edition"

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

function formatDuration(startedAt: string | undefined, completedAt: string | undefined): string {
  if (!startedAt || !completedAt) return "-"
  const start = new Date(startedAt).getTime()
  const end = new Date(completedAt).getTime()
  const seconds = (end - start) / 1000
  if (seconds < 1) return `${(seconds * 1000).toFixed(0)}ms`
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}m ${secs.toFixed(0)}s`
}

function getCostDisplay(job: Job): string {
  // Cloud edition: API returns `cost` field (= display_cost with markup)
  // This field is sanitized at the backend to hide provider details
  if (job.cost != null) {
    const cost = job.cost
    if (cost < 0.01) return `$${cost.toFixed(4)}`
    return `$${cost.toFixed(3)}`
  }

  // Self-hosted edition or admin: API returns full cost breakdown
  // Show display_cost if available (CLOUD edition admin), otherwise provider_cost
  if (job.display_cost != null) {
    const cost = job.display_cost
    if (cost < 0.01) return `$${cost.toFixed(4)}`
    return `$${cost.toFixed(3)}`
  }

  if (job.provider_cost != null) {
    const cost = job.provider_cost
    if (cost < 0.01) return `$${cost.toFixed(4)}`
    return `$${cost.toFixed(3)}`
  }

  // No cost data available
  return "-"
}

function getQueueTime(createdAt: string, startedAt: string | undefined): string {
  if (!startedAt) return "-"
  const created = new Date(createdAt).getTime()
  const started = new Date(startedAt).getTime()
  const queueMs = started - created
  if (queueMs < 1000) return `${queueMs}ms`
  return `${(queueMs / 1000).toFixed(1)}s`
}

function extractJobType(inputData: Job["input_data"]): string {
  const type = inputData?.type ?? "unknown"
  // Convert from internal type to display name
  const typeMap: Record<string, string> = {
    "generate-image": "Image",
    "image-to-video": "Video",
    "video-to-video": "Video",
    "text-to-video": "Video",
    "text-to-speech": "TTS",
    "generate-script": "Script",
    "combine-videos": "Combine",
    "merge-video-audio": "Merge",
    "extract-audio": "Extract",
    "trim-video": "Trim",
    "resize-video": "Resize",
    "adjust-volume": "Volume",
    "add-captions": "Captions",
    "mix-audio": "Mix",
    "generate-music": "Music",
    "text-to-audio": "Audio",
    "generate-character": "Character",
    "generate-character-asset": "Asset",
    "generate-object": "Object",
    "generate-object-asset": "Asset",
    "generate-location": "Location",
    "generate-location-asset": "Asset",
    "motion-transfer": "Motion",
    "video-upscale": "Upscale",
  }
  return typeMap[type] ?? type
}

function extractProvider(inputData: Job["input_data"]): string {
  return inputData?.provider ?? "default"
}

/**
 * Get display text for the actual API provider used (KIE.ai vs Replicate)
 * This shows which backend service actually processed the job
 */
function getApiProviderDisplay(job: Job): { text: string; isFallback: boolean } {
  // job.provider field indicates which API was used: "kie" or "replicate"
  // If not set, we don't know which provider was used
  if (!job.provider) {
    return { text: "-", isFallback: false }
  }

  if (job.provider === "kie") {
    return { text: "KIE.ai", isFallback: false }
  }

  // Check if this was a fallback (in KIE.ai mode but Replicate was used)
  // We determine this by checking if the job has markup applied
  // For now, just show "Replicate" with a note if it might be a fallback
  return { text: "Replicate", isFallback: false }
}

interface ExecutionsTabProps {
  readonly className?: string
}

export function ExecutionsTab({ className = "" }: ExecutionsTabProps) {
  const { user } = useAuth()
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [prevCursors, setPrevCursors] = useState<string[]>([])
  const [selectedJob, setSelectedJob] = useState<Job | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const userId = user?.id

  const fetchData = useCallback(async (cursor?: string, direction: "next" | "prev" | "refresh" = "refresh") => {
    if (!userId) return
    try {
      setLoading(true)
      setError(null)
      const result = await getJobs(userId, cursor)
      setJobs(result.data)
      setNextCursor(result.next)

      // Track cursor history for pagination
      if (direction === "next" && cursor) {
        setPrevCursors(prev => [...prev, cursor])
      } else if (direction === "prev") {
        setPrevCursors(prev => prev.slice(0, -1))
      } else if (direction === "refresh") {
        setPrevCursors([])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load jobs")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [userId])

  useEffect(() => {
    if (userId) {
      fetchData()
    }
  }, [fetchData, userId])

  const handleRefresh = () => {
    setRefreshing(true)
    fetchData(undefined, "refresh")
  }

  const handleNext = () => {
    if (nextCursor) {
      fetchData(nextCursor, "next")
    }
  }

  const handlePrev = () => {
    if (prevCursors.length > 0) {
      const prevCursor = prevCursors[prevCursors.length - 2] // Go back one
      fetchData(prevCursor, "prev")
    } else {
      fetchData(undefined, "refresh") // Go to first page
    }
  }

  const statusColors: Record<string, string> = {
    completed: "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400",
    failed: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400",
    processing: "bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-400",
    pending: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400",
    queued: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400",
    cancelled: "bg-gray-100 text-gray-700 dark:bg-gray-500/20 dark:text-gray-400",
  }

  if (!userId || (loading && jobs.length === 0)) {
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
              disabled={prevCursors.length === 0 || loading}
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
                  Type
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-[#94A3B8] uppercase tracking-wider">
                  Model
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-[#94A3B8] uppercase tracking-wider">
                  API
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-[#94A3B8] uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-[#94A3B8] uppercase tracking-wider">
                  Queued
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-[#94A3B8] uppercase tracking-wider">
                  Duration
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-[#94A3B8] uppercase tracking-wider">
                  Cost
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-[#94A3B8] uppercase tracking-wider">
                  Created
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-[#2D2D2D]">
              {jobs.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-gray-500 dark:text-[#94A3B8]">
                    No executions found
                  </td>
                </tr>
              ) : (
                jobs.map((job) => (
                  <tr
                    key={job.id}
                    className="hover:bg-gray-50 dark:hover:bg-[#2D2D2D] transition-colors cursor-pointer"
                    onClick={() => setSelectedJob(job)}
                  >
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelectedJob(job)
                        }}
                        className="text-sm font-mono text-[#ff0073] hover:underline"
                      >
                        {job.id.slice(0, 8)}...
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-gray-700 dark:text-[#E2E8F0] font-mono">
                        {extractJobType(job.input_data)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-gray-500 dark:text-[#94A3B8]">
                        {extractProvider(job.input_data)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {(() => {
                        const apiProvider = getApiProviderDisplay(job)
                        return (
                          <span className={`text-sm font-medium ${
                            apiProvider.text === "KIE.ai"
                              ? "text-emerald-600 dark:text-emerald-400"
                              : apiProvider.text === "Replicate"
                              ? "text-blue-600 dark:text-blue-400"
                              : "text-gray-500 dark:text-[#94A3B8]"
                          }`}>
                            {apiProvider.text}
                          </span>
                        )
                      })()}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${statusColors[job.status] || "bg-gray-100 text-gray-700 dark:bg-gray-500/20 dark:text-gray-400"}`}>
                        {job.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-gray-500 dark:text-[#94A3B8] font-mono">
                        {getQueueTime(job.created_at, job.started_at)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-gray-500 dark:text-[#94A3B8] font-mono">
                        {formatDuration(job.started_at, job.completed_at)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-[#ff0073] font-mono">
                        {getCostDisplay(job)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-gray-500 dark:text-[#94A3B8]">
                        {formatRelativeTime(job.created_at)}
                      </span>
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
        job={selectedJob}
        open={selectedJob !== null}
        onClose={() => setSelectedJob(null)}
        onDeleted={(jobId) => {
          setJobs(prev => prev.filter(j => j.id !== jobId))
          setSelectedJob(null)
        }}
      />
    </div>
  )
}
