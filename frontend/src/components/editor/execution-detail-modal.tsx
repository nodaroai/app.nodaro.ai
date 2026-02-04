"use client"

import { useState } from "react"
import { X, Download, ExternalLink, Copy, Check, ChevronDown, ChevronRight, Loader2, Clock, Zap, Share2, Trash2, Sliders, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { ReplicatePrediction } from "@/lib/api"

interface ExecutionDetailModalProps {
  readonly prediction: ReplicatePrediction | null
  readonly open: boolean
  readonly onClose: () => void
}

type InputTabType = "form" | "json"
type OutputTabType = "preview" | "json"

function getOutputUrl(output: unknown): string | null {
  if (!output) return null
  if (typeof output === "string") return output
  if (Array.isArray(output) && output.length > 0) {
    if (typeof output[0] === "string") return output[0]
  }
  if (typeof output === "object" && output !== null) {
    const obj = output as Record<string, unknown>
    if (typeof obj.url === "string") return obj.url
    if (typeof obj.output === "string") return obj.output
    if (Array.isArray(obj.output) && obj.output.length > 0 && typeof obj.output[0] === "string") {
      return obj.output[0]
    }
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

function formatDuration(seconds: number | undefined): string {
  if (!seconds) return "-"
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
    <div className="border-b border-[#2D2D2D] last:border-b-0 py-3">
      <div className="flex items-start gap-3">
        <span className="text-sm font-medium text-[#E2E8F0] shrink-0 w-32">{name}</span>
        <div className="flex-1 min-w-0">
          {/* Image thumbnails for URL arrays */}
          {isImageList && (
            <div className="flex flex-wrap gap-2 mb-2">
              {(value as string[]).map((url, idx) => (
                <a key={idx} href={url} target="_blank" rel="noopener noreferrer">
                  <img
                    src={url}
                    alt={`Input ${idx + 1}`}
                    className="w-10 h-10 rounded object-cover border border-[#2D2D2D] hover:border-[#ff0073] transition-colors"
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
                className="w-10 h-10 rounded object-cover border border-[#2D2D2D] hover:border-[#ff0073] transition-colors"
              />
            </a>
          )}

          {/* Value display */}
          <div className="text-sm text-[#94A3B8] font-mono break-all">
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
            className="flex items-center gap-1 mt-2 text-xs text-[#64748B] hover:text-[#94A3B8] transition-colors"
          >
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            More details
          </button>

          {expanded && (
            <div className="mt-2 p-2 rounded bg-[#0D0D0D] text-xs text-[#64748B] font-mono">
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

export function ExecutionDetailModal({ prediction, open, onClose }: ExecutionDetailModalProps) {
  const [inputTab, setInputTab] = useState<InputTabType>("form")
  const [outputTab, setOutputTab] = useState<OutputTabType>("preview")
  const [copiedId, setCopiedId] = useState(false)
  const [copiedJson, setCopiedJson] = useState(false)

  if (!open || !prediction) return null

  const outputUrl = getOutputUrl(prediction.output)
  const isVideo = outputUrl ? isVideoUrl(outputUrl) : false

  const handleCopyId = () => {
    navigator.clipboard.writeText(prediction.id)
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
      a.download = `prediction-${prediction.id}${isVideo ? ".mp4" : ".png"}`
      a.target = "_blank"
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    }
  }

  const statusColors: Record<string, string> = {
    succeeded: "bg-green-500/20 text-green-400",
    failed: "bg-red-500/20 text-red-400",
    processing: "bg-yellow-500/20 text-yellow-400",
    starting: "bg-blue-500/20 text-blue-400",
    canceled: "bg-gray-500/20 text-gray-400",
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-6xl max-h-[90vh] bg-[#121212] rounded-xl border border-[#2D2D2D] shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2D2D2D] bg-[#1E1E1E]">
          <div className="flex items-center gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h2 className="text-lg font-semibold text-white">Prediction</h2>
                <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusColors[prediction.status] || "bg-gray-500/20 text-gray-400"}`}>
                  {prediction.status}
                </span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <button
                  type="button"
                  onClick={handleCopyId}
                  className="flex items-center gap-1.5 text-[#94A3B8] hover:text-white transition-colors font-mono"
                >
                  {prediction.id}
                  {copiedId ? (
                    <Check className="w-3.5 h-3.5 text-green-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-6">
            {/* Model */}
            <a
              href={`https://replicate.com/${prediction.model}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-[#ff0073] hover:underline font-mono"
            >
              {prediction.model}
            </a>

            {/* Duration */}
            <div className="flex items-center gap-1.5 text-sm text-[#94A3B8]">
              <Zap className="w-4 h-4" />
              {formatDuration(prediction.metrics?.total_time)}
            </div>

            {/* Created */}
            <div className="flex items-center gap-1.5 text-sm text-[#94A3B8]">
              <Clock className="w-4 h-4" />
              {formatRelativeTime(prediction.created_at)}
            </div>

            {/* Close button */}
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="text-[#94A3B8] hover:text-white hover:bg-[#2D2D2D]"
            >
              <X className="w-5 h-5" />
            </Button>
          </div>
        </div>

        {/* Content - Two Columns */}
        <div className="flex-1 overflow-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6">
            {/* Left Column - Input */}
            <div className="bg-[#1E1E1E] rounded-xl border border-[#2D2D2D] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[#2D2D2D]">
                <h3 className="text-sm font-semibold text-white">Input</h3>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setInputTab("form")}
                    className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                      inputTab === "form"
                        ? "text-white border-b-2 border-[#ff0073]"
                        : "text-[#94A3B8] hover:text-white"
                    }`}
                  >
                    Form
                  </button>
                  <button
                    type="button"
                    onClick={() => setInputTab("json")}
                    className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                      inputTab === "json"
                        ? "text-white border-b-2 border-[#ff0073]"
                        : "text-[#94A3B8] hover:text-white"
                    }`}
                  >
                    JSON
                  </button>
                </div>
              </div>

              <div className="p-4 max-h-[500px] overflow-auto">
                {inputTab === "form" ? (
                  <div>
                    {prediction.input && Object.keys(prediction.input).length > 0 ? (
                      Object.entries(prediction.input).map(([key, value]) => (
                        <InputField key={key} name={key} value={value} />
                      ))
                    ) : (
                      <p className="text-sm text-[#64748B]">No input parameters</p>
                    )}
                  </div>
                ) : (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => handleCopyJson(JSON.stringify(prediction.input, null, 2))}
                      className="absolute top-2 right-2 p-1.5 rounded bg-[#2D2D2D] hover:bg-[#3D3D3D] transition-colors"
                    >
                      {copiedJson ? (
                        <Check className="w-4 h-4 text-green-400" />
                      ) : (
                        <Copy className="w-4 h-4 text-[#94A3B8]" />
                      )}
                    </button>
                    <pre className="p-4 rounded-lg bg-[#0D0D0D] text-[#E2E8F0] font-mono text-sm overflow-auto">
                      {JSON.stringify(prediction.input, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>

            {/* Right Column - Output */}
            <div className="bg-[#1E1E1E] rounded-xl border border-[#2D2D2D] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[#2D2D2D]">
                <h3 className="text-sm font-semibold text-white">Output</h3>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setOutputTab("preview")}
                    className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                      outputTab === "preview"
                        ? "text-white border-b-2 border-[#ff0073]"
                        : "text-[#94A3B8] hover:text-white"
                    }`}
                  >
                    Preview
                  </button>
                  <button
                    type="button"
                    onClick={() => setOutputTab("json")}
                    className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                      outputTab === "json"
                        ? "text-white border-b-2 border-[#ff0073]"
                        : "text-[#94A3B8] hover:text-white"
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
                      <div className="rounded-lg overflow-hidden bg-[#0D0D0D] border border-[#2D2D2D]">
                        {isVideo ? (
                          <video
                            src={outputUrl}
                            controls
                            className="w-full max-h-[400px] object-contain"
                          />
                        ) : (
                          <img
                            src={outputUrl}
                            alt="Output"
                            className="w-full max-h-[400px] object-contain"
                          />
                        )}
                      </div>
                    ) : prediction.status === "processing" || prediction.status === "starting" ? (
                      <div className="flex flex-col items-center justify-center h-64 rounded-lg bg-[#0D0D0D] border border-[#2D2D2D]">
                        <Loader2 className="w-8 h-8 animate-spin text-[#ff0073] mb-3" />
                        <p className="text-sm text-[#94A3B8]">Processing...</p>
                      </div>
                    ) : prediction.status === "failed" ? (
                      <div className="flex flex-col items-center justify-center h-64 rounded-lg bg-red-500/10 border border-red-500/30 p-4">
                        <p className="text-sm text-red-400 mb-2 font-medium">Prediction failed</p>
                        {prediction.error && (
                          <p className="text-xs text-red-300/70 text-center">{prediction.error}</p>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center justify-center h-64 rounded-lg bg-[#0D0D0D] border border-[#2D2D2D]">
                        <p className="text-sm text-[#64748B]">No output available</p>
                      </div>
                    )}

                    {/* Output URL display */}
                    {outputUrl && (
                      <div className="mt-3 p-2 rounded bg-[#0D0D0D] border border-[#2D2D2D]">
                        <p className="text-xs text-[#64748B] mb-1">Output URL</p>
                        <p className="text-xs text-[#94A3B8] font-mono break-all">{outputUrl}</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => handleCopyJson(JSON.stringify(prediction, null, 2))}
                      className="absolute top-2 right-2 p-1.5 rounded bg-[#2D2D2D] hover:bg-[#3D3D3D] transition-colors"
                    >
                      {copiedJson ? (
                        <Check className="w-4 h-4 text-green-400" />
                      ) : (
                        <Copy className="w-4 h-4 text-[#94A3B8]" />
                      )}
                    </button>
                    <pre className="p-4 rounded-lg bg-[#0D0D0D] text-[#E2E8F0] font-mono text-sm overflow-auto max-h-[450px]">
                      {JSON.stringify(prediction, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[#2D2D2D] bg-[#1E1E1E]">
          <div className="flex items-center gap-2 text-sm text-[#64748B]">
            {prediction.status === "succeeded" && prediction.metrics?.predict_time && (
              <span>Generated in {formatDuration(prediction.metrics.predict_time)}</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="border-[#2D2D2D] text-[#94A3B8] hover:text-white hover:bg-[#2D2D2D]"
            >
              <Trash2 className="w-4 h-4 mr-1.5" />
              Delete
            </Button>

            {outputUrl && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownload}
                className="border-[#2D2D2D] text-[#94A3B8] hover:text-white hover:bg-[#2D2D2D]"
              >
                <Download className="w-4 h-4 mr-1.5" />
                Download
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              className="border-[#2D2D2D] text-[#94A3B8] hover:text-white hover:bg-[#2D2D2D]"
            >
              <Share2 className="w-4 h-4 mr-1.5" />
              Share
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="border-[#2D2D2D] text-[#94A3B8] hover:text-white hover:bg-[#2D2D2D]"
            >
              <Sliders className="w-4 h-4 mr-1.5" />
              Tweak it
            </Button>

            <a
              href={`https://replicate.com/p/${prediction.id}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button
                variant="outline"
                size="sm"
                className="border-[#2D2D2D] text-[#94A3B8] hover:text-white hover:bg-[#2D2D2D]"
              >
                <Play className="w-4 h-4 mr-1.5" />
                Iterate in playground
              </Button>
            </a>

            <a
              href={`https://replicate.com/p/${prediction.id}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button
                variant="outline"
                size="sm"
                className="border-[#2D2D2D] text-[#94A3B8] hover:text-white hover:bg-[#2D2D2D]"
              >
                <ExternalLink className="w-4 h-4 mr-1.5" />
                View on Replicate
              </Button>
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
