"use client"

import { useState } from "react"
import { X, Download, Copy, Check, ChevronDown, ChevronRight, Loader2, Clock, Zap, Share2, Trash2, Sliders, Coins, DollarSign } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { Job } from "@/lib/api"
import { deleteJob } from "@/lib/api"
import { isCloud } from "@/lib/edition"

function getCostDisplayForModal(job: Job, showDollars: boolean): string {
  if (showDollars) {
    const cost = job.cost ?? job.display_cost ?? job.provider_cost
    if (cost == null) return "-"
    if (cost < 0.01) return `$${cost.toFixed(4)}`
    return `$${cost.toFixed(3)}`
  }
  const credits = job.credits_used ?? job.credits_estimated
  if (credits == null) return "-"
  return `${credits} CR`
}

interface ExecutionDetailModalProps {
  readonly job: Job | null
  readonly open: boolean
  readonly onClose: () => void
  readonly onDeleted?: (jobId: string) => void
  readonly showDollars?: boolean
}

type InputTabType = "form" | "json"
type OutputTabType = "preview" | "json"

function getOutputUrl(outputData: Job["output_data"]): string | null {
  if (!outputData) return null
  // Check for direct URL fields in our output_data structure
  if (outputData.imageUrl) return outputData.imageUrl
  if (outputData.videoUrl) return outputData.videoUrl
  if (outputData.audioUrl) return outputData.audioUrl
  // Fallback: check for generic url or output field
  if (typeof outputData.url === "string") return outputData.url
  if (typeof outputData.output === "string") return outputData.output
  if (Array.isArray(outputData.output) && outputData.output.length > 0 && typeof outputData.output[0] === "string") {
    return outputData.output[0]
  }
  return null
}

function isVideoUrl(url: string): boolean {
  const lower = url.toLowerCase()
  return lower.includes(".mp4") || lower.includes(".webm") || lower.includes(".mov") || lower.includes("video")
}

function isImageUrl(url: string): boolean {
  const lower = url.toLowerCase()
  return lower.includes(".png") || lower.includes(".jpg") || lower.includes(".jpeg") || lower.includes(".webp") || lower.includes(".gif")
}

function isAudioUrl(url: string): boolean {
  const lower = url.toLowerCase()
  return lower.includes(".mp3") || lower.includes(".wav") || lower.includes(".ogg") || lower.includes(".aac") || lower.includes(".m4a") || lower.includes("audio")
}

function formatDuration(startedAt: string | undefined, completedAt: string | undefined): string {
  if (!startedAt || !completedAt) return "-"
  const start = new Date(startedAt).getTime()
  const end = new Date(completedAt).getTime()
  const seconds = (end - start) / 1000
  if (seconds < 1) return `${(seconds * 1000).toFixed(0)}ms`
  return `${seconds.toFixed(1)}s`
}

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

function getValueType(value: unknown): string {
  if (value === null) return "null"
  if (Array.isArray(value)) return "array"
  return typeof value
}

function isUrlArray(value: unknown): boolean {
  if (!Array.isArray(value)) return false
  return value.every(item => typeof item === "string" && (item.startsWith("http://") || item.startsWith("https://")))
}

function extractJobType(inputData: Job["input_data"]): string {
  if (inputData.type) return inputData.type
  if (inputData.imageUrl && inputData.prompt) return "image-to-video"
  if (inputData.videoUrl) return "video-to-video"
  if (inputData.prompt) return "generate-image"
  if (inputData.text) return "text-to-speech"
  return "unknown"
}

function extractProvider(inputData: Job["input_data"], job: Job): string | null {
  // In cloud edition, don't show provider info to regular users
  // The backend doesn't send the provider field, so we check for its existence
  if (isCloud() && !job.provider) {
    return null
  }
  // Self-hosted or admin: show provider from job record or input data
  return job.provider || inputData.provider || "replicate"
}

interface InputFieldProps {
  readonly name: string
  readonly value: unknown
}

function InputField({ name, value }: InputFieldProps) {
  const [expanded, setExpanded] = useState(false)
  const valueType = getValueType(value)
  const isUrl = typeof value === "string" && (value.startsWith("http://") || value.startsWith("https://"))
  const isUrlList = isUrlArray(value)
  const isImage = isUrl && isImageUrl(value)
  const isImageList = isUrlList && (value as string[]).some(url => isImageUrl(url))

  return (
    <div className="border-b border-gray-200 dark:border-[#2D2D2D] last:border-b-0 py-3">
      <div className="flex items-start gap-3">
        <span className="text-sm font-medium text-gray-700 dark:text-[#E2E8F0] shrink-0 w-32">{name}</span>
        <div className="flex-1 min-w-0">
          {/* Image thumbnails for URL arrays */}
          {isImageList && (
            <div className="flex flex-wrap gap-2 mb-2">
              {(value as string[]).map((url, idx) => (
                <a key={idx} href={url} target="_blank" rel="noopener noreferrer">
                  <img
                    src={url}
                    alt={`Input ${idx + 1}`}
                    className="w-10 h-10 rounded object-cover border border-gray-200 dark:border-[#2D2D2D] hover:border-[#ff0073] transition-colors"
                  />
                </a>
              ))}
            </div>
          )}

          {/* Single image thumbnail */}
          {isImage && (
            <a href={value as string} target="_blank" rel="noopener noreferrer" className="inline-block mb-2">
              <img
                src={value as string}
                alt="Input"
                className="w-10 h-10 rounded object-cover border border-gray-200 dark:border-[#2D2D2D] hover:border-[#ff0073] transition-colors"
              />
            </a>
          )}

          {/* Value display */}
          <div className="text-sm text-gray-500 dark:text-[#94A3B8] font-mono break-all">
            {typeof value === "string" ? (
              value.length > 150 ? (
                <>
                  {expanded ? value : `${value.slice(0, 150)}...`}
                  <button
                    type="button"
                    onClick={() => setExpanded(!expanded)}
                    className="ml-2 text-[#ff0073] hover:underline"
                  >
                    {expanded ? "Show less" : "Show more"}
                  </button>
                </>
              ) : (
                value
              )
            ) : Array.isArray(value) ? (
              <div className="space-y-1">
                {(value as unknown[]).map((item, idx) => (
                  <div key={idx} className="truncate">
                    {typeof item === "string" && item.length > 80 ? `${item.slice(0, 80)}...` : JSON.stringify(item)}
                  </div>
                ))}
              </div>
            ) : (
              JSON.stringify(value)
            )}
          </div>

          {/* More details */}
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 mt-2 text-xs text-gray-400 dark:text-[#64748B] hover:text-gray-600 dark:hover:text-[#94A3B8] transition-colors"
          >
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            More details
          </button>

          {expanded && (
            <div className="mt-2 p-2 rounded bg-gray-100 dark:bg-[#0D0D0D] text-xs text-gray-500 dark:text-[#64748B] font-mono">
              <div>type: {valueType}</div>
              {Array.isArray(value) && <div>length: {value.length}</div>}
              {isUrlList && <div>value type: file</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function ExecutionDetailModal({ job, open, onClose, onDeleted, showDollars = !isCloud() }: ExecutionDetailModalProps) {
  const [inputTab, setInputTab] = useState<InputTabType>("form")
  const [outputTab, setOutputTab] = useState<OutputTabType>("preview")
  const [copiedId, setCopiedId] = useState(false)
  const [copiedJson, setCopiedJson] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  if (!open || !job) return null

  const outputUrl = getOutputUrl(job.output_data)
  const isVideo = outputUrl ? isVideoUrl(outputUrl) : false
  const isAudio = outputUrl ? isAudioUrl(outputUrl) : false
  const jobType = extractJobType(job.input_data)
  const provider = extractProvider(job.input_data, job)

  const handleCopyId = () => {
    navigator.clipboard.writeText(job.id)
    setCopiedId(true)
    setTimeout(() => setCopiedId(false), 2000)
  }

  const handleCopyJson = (json: string) => {
    navigator.clipboard.writeText(json)
    setCopiedJson(true)
    setTimeout(() => setCopiedJson(false), 2000)
  }

  const handleDownload = () => {
    if (outputUrl) {
      const a = document.createElement("a")
      a.href = outputUrl
      const ext = isVideo ? ".mp4" : isAudio ? ".mp3" : ".png"
      a.download = `job-${job.id}${ext}`
      a.target = "_blank"
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    }
  }

  const handleDelete = async () => {
    if (isDeleting) return
    setIsDeleting(true)
    try {
      await deleteJob(job.id)
      onDeleted?.(job.id)
      onClose()
    } catch (error) {
      console.error("Failed to delete job:", error)
    } finally {
      setIsDeleting(false)
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

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 dark:bg-black/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-6xl max-h-[90vh] bg-white dark:bg-[#121212] rounded-xl border border-gray-200 dark:border-[#2D2D2D] shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#1E1E1E]">
          <div className="flex items-center gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Job</h2>
                <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusColors[job.status] || "bg-gray-100 text-gray-700 dark:bg-gray-500/20 dark:text-gray-400"}`}>
                  {job.status}
                </span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <button
                  type="button"
                  onClick={handleCopyId}
                  className="flex items-center gap-1.5 text-gray-500 dark:text-[#94A3B8] hover:text-gray-700 dark:hover:text-white transition-colors font-mono"
                >
                  {job.id.slice(0, 8)}...
                  {copiedId ? (
                    <Check className="w-3.5 h-3.5 text-green-500 dark:text-green-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-6">
            {/* Type & Provider (provider hidden in cloud edition for regular users) */}
            <span className="text-sm text-[#ff0073] font-mono">
              {provider ? `${jobType} (${provider})` : jobType}
            </span>

            {/* Cost */}
            <div className="flex items-center gap-1.5 text-sm text-[#ff0073] font-mono">
              {showDollars ? <DollarSign className="w-4 h-4" /> : <Coins className="w-4 h-4" />}
              {getCostDisplayForModal(job, showDollars)}
            </div>

            {/* Duration */}
            <div className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-[#94A3B8]">
              <Zap className="w-4 h-4" />
              {formatDuration(job.started_at, job.completed_at)}
            </div>

            {/* Created */}
            <div className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-[#94A3B8]">
              <Clock className="w-4 h-4" />
              {formatRelativeTime(job.created_at)}
            </div>

            {/* Close button */}
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="text-gray-500 dark:text-[#94A3B8] hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-[#2D2D2D]"
            >
              <X className="w-5 h-5" />
            </Button>
          </div>
        </div>

        {/* Content - Two Columns */}
        <div className="flex-1 overflow-auto bg-gray-50 dark:bg-[#121212]">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6">
            {/* Left Column - Input */}
            <div className="bg-white dark:bg-[#1E1E1E] rounded-xl border border-gray-200 dark:border-[#2D2D2D] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-[#2D2D2D]">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Input</h3>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setInputTab("form")}
                    className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                      inputTab === "form"
                        ? "text-gray-900 dark:text-white border-b-2 border-[#ff0073]"
                        : "text-gray-500 dark:text-[#94A3B8] hover:text-gray-700 dark:hover:text-white"
                    }`}
                  >
                    Form
                  </button>
                  <button
                    type="button"
                    onClick={() => setInputTab("json")}
                    className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                      inputTab === "json"
                        ? "text-gray-900 dark:text-white border-b-2 border-[#ff0073]"
                        : "text-gray-500 dark:text-[#94A3B8] hover:text-gray-700 dark:hover:text-white"
                    }`}
                  >
                    JSON
                  </button>
                </div>
              </div>

              <div className="p-4 max-h-[500px] overflow-auto">
                {inputTab === "form" ? (
                  <div>
                    {job.input_data && Object.keys(job.input_data).length > 0 ? (
                      Object.entries(job.input_data).map(([key, value]) => (
                        <InputField key={key} name={key} value={value} />
                      ))
                    ) : (
                      <p className="text-sm text-gray-400 dark:text-[#64748B]">No input parameters</p>
                    )}
                  </div>
                ) : (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => handleCopyJson(JSON.stringify(job.input_data, null, 2))}
                      className="absolute top-2 right-2 p-1.5 rounded bg-gray-100 dark:bg-[#2D2D2D] hover:bg-gray-200 dark:hover:bg-[#3D3D3D] transition-colors"
                    >
                      {copiedJson ? (
                        <Check className="w-4 h-4 text-green-500 dark:text-green-400" />
                      ) : (
                        <Copy className="w-4 h-4 text-gray-500 dark:text-[#94A3B8]" />
                      )}
                    </button>
                    <pre className="p-4 rounded-lg bg-gray-100 dark:bg-[#0D0D0D] text-gray-700 dark:text-[#E2E8F0] font-mono text-sm overflow-auto">
                      {JSON.stringify(job.input_data, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>

            {/* Right Column - Output */}
            <div className="bg-white dark:bg-[#1E1E1E] rounded-xl border border-gray-200 dark:border-[#2D2D2D] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-[#2D2D2D]">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Output</h3>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setOutputTab("preview")}
                    className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                      outputTab === "preview"
                        ? "text-gray-900 dark:text-white border-b-2 border-[#ff0073]"
                        : "text-gray-500 dark:text-[#94A3B8] hover:text-gray-700 dark:hover:text-white"
                    }`}
                  >
                    Preview
                  </button>
                  <button
                    type="button"
                    onClick={() => setOutputTab("json")}
                    className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                      outputTab === "json"
                        ? "text-gray-900 dark:text-white border-b-2 border-[#ff0073]"
                        : "text-gray-500 dark:text-[#94A3B8] hover:text-gray-700 dark:hover:text-white"
                    }`}
                  >
                    JSON
                  </button>
                </div>
              </div>

              <div className="p-4 max-h-[500px] overflow-auto">
                {outputTab === "preview" ? (
                  <div>
                    {outputUrl ? (
                      <div className="rounded-lg overflow-hidden bg-gray-100 dark:bg-[#0D0D0D] border border-gray-200 dark:border-[#2D2D2D]">
                        {isVideo ? (
                          <video
                            src={outputUrl}
                            controls
                            className="w-full max-h-[400px] object-contain"
                          />
                        ) : isAudio ? (
                          <div className="p-4 flex items-center justify-center">
                            <audio src={outputUrl} controls className="w-full" />
                          </div>
                        ) : (
                          <img
                            src={outputUrl}
                            alt="Output"
                            className="w-full max-h-[400px] object-contain"
                          />
                        )}
                      </div>
                    ) : job.status === "processing" || job.status === "pending" || job.status === "queued" ? (
                      <div className="flex flex-col items-center justify-center h-64 rounded-lg bg-gray-100 dark:bg-[#0D0D0D] border border-gray-200 dark:border-[#2D2D2D]">
                        <Loader2 className="w-8 h-8 animate-spin text-[#ff0073] mb-3" />
                        <p className="text-sm text-gray-500 dark:text-[#94A3B8]">Processing...</p>
                        {job.progress > 0 && (
                          <p className="text-xs text-gray-400 dark:text-[#64748B] mt-1">{job.progress}% complete</p>
                        )}
                      </div>
                    ) : job.status === "failed" ? (
                      <div className="flex flex-col items-center justify-center h-64 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 p-4">
                        <p className="text-sm text-red-600 dark:text-red-400 mb-2 font-medium">Job failed</p>
                        {job.error_message && (
                          <p className="text-xs text-red-500 dark:text-red-300/70 text-center">{job.error_message}</p>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center justify-center h-64 rounded-lg bg-gray-100 dark:bg-[#0D0D0D] border border-gray-200 dark:border-[#2D2D2D]">
                        <p className="text-sm text-gray-400 dark:text-[#64748B]">No output available</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => handleCopyJson(JSON.stringify(job, null, 2))}
                      className="absolute top-2 right-2 p-1.5 rounded bg-gray-100 dark:bg-[#2D2D2D] hover:bg-gray-200 dark:hover:bg-[#3D3D3D] transition-colors"
                    >
                      {copiedJson ? (
                        <Check className="w-4 h-4 text-green-500 dark:text-green-400" />
                      ) : (
                        <Copy className="w-4 h-4 text-gray-500 dark:text-[#94A3B8]" />
                      )}
                    </button>
                    <pre className="p-4 rounded-lg bg-gray-100 dark:bg-[#0D0D0D] text-gray-700 dark:text-[#E2E8F0] font-mono text-sm overflow-auto max-h-[450px]">
                      {JSON.stringify(job, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#1E1E1E]">
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-[#64748B]">
            {job.status === "completed" && job.started_at && job.completed_at && (
              <span>Generated in {formatDuration(job.started_at, job.completed_at)}</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleDelete}
              disabled={isDeleting}
              className="border-gray-200 dark:border-[#2D2D2D] text-gray-600 dark:text-[#94A3B8] hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 hover:border-red-200 dark:hover:border-red-500/30"
            >
              {isDeleting ? (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4 mr-1.5" />
              )}
              Delete
            </Button>

            {outputUrl && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownload}
                className="border-gray-200 dark:border-[#2D2D2D] text-gray-600 dark:text-[#94A3B8] hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-[#2D2D2D]"
              >
                <Download className="w-4 h-4 mr-1.5" />
                Download
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              className="border-gray-200 dark:border-[#2D2D2D] text-gray-600 dark:text-[#94A3B8] hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-[#2D2D2D]"
            >
              <Share2 className="w-4 h-4 mr-1.5" />
              Share
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="border-gray-200 dark:border-[#2D2D2D] text-gray-600 dark:text-[#94A3B8] hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-[#2D2D2D]"
            >
              <Sliders className="w-4 h-4 mr-1.5" />
              Tweak it
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
