"use client"

import { useState } from "react"
import { X, Download, ExternalLink, Copy, Check, Image as ImageIcon, Video, FileJson, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { ReplicatePrediction } from "@/lib/api"

interface ExecutionDetailModalProps {
  readonly prediction: ReplicatePrediction | null
  readonly open: boolean
  readonly onClose: () => void
}

type TabType = "preview" | "json"

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

function formatDuration(seconds: number | undefined): string {
  if (!seconds) return "-"
  if (seconds < 1) return `${(seconds * 1000).toFixed(0)}ms`
  return `${seconds.toFixed(2)}s`
}

export function ExecutionDetailModal({ prediction, open, onClose }: ExecutionDetailModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>("preview")
  const [copied, setCopied] = useState(false)

  if (!open || !prediction) return null

  const outputUrl = getOutputUrl(prediction.output)
  const isVideo = outputUrl ? isVideoUrl(outputUrl) : false

  const handleCopyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(prediction, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDownload = () => {
    if (outputUrl) {
      window.open(outputUrl, "_blank")
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
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-4xl max-h-[90vh] bg-[#1E1E1E] rounded-xl border border-[#2D2D2D] shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2D2D2D]">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-semibold text-white">Prediction Details</h2>
            <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusColors[prediction.status] || "bg-gray-500/20 text-gray-400"}`}>
              {prediction.status}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {outputUrl && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownload}
                className="border-[#2D2D2D] hover:bg-[#2D2D2D]"
              >
                <Download className="w-4 h-4 mr-1.5" />
                Download
              </Button>
            )}
            <a
              href={`https://replicate.com/p/${prediction.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-[#94A3B8] hover:text-white border border-[#2D2D2D] rounded-md hover:bg-[#2D2D2D] transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              Replicate
            </a>
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

        {/* Tabs */}
        <div className="flex items-center gap-1 px-6 py-2 border-b border-[#2D2D2D] bg-[#121212]">
          <button
            type="button"
            onClick={() => setActiveTab("preview")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              activeTab === "preview"
                ? "bg-[#ff0073] text-white"
                : "text-[#94A3B8] hover:text-white hover:bg-[#2D2D2D]"
            }`}
          >
            {isVideo ? <Video className="w-4 h-4" /> : <ImageIcon className="w-4 h-4" />}
            Preview
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("json")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              activeTab === "json"
                ? "bg-[#ff0073] text-white"
                : "text-[#94A3B8] hover:text-white hover:bg-[#2D2D2D]"
            }`}
          >
            <FileJson className="w-4 h-4" />
            JSON
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {activeTab === "preview" ? (
            <div className="space-y-6">
              {/* Output Preview */}
              {outputUrl ? (
                <div className="rounded-lg overflow-hidden bg-[#121212] border border-[#2D2D2D]">
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
                <div className="flex flex-col items-center justify-center h-64 rounded-lg bg-[#121212] border border-[#2D2D2D]">
                  <Loader2 className="w-8 h-8 animate-spin text-[#ff0073] mb-3" />
                  <p className="text-sm text-[#94A3B8]">Processing...</p>
                </div>
              ) : prediction.status === "failed" ? (
                <div className="flex flex-col items-center justify-center h-64 rounded-lg bg-red-500/10 border border-red-500/30">
                  <p className="text-sm text-red-400 mb-2">Prediction failed</p>
                  {prediction.error && (
                    <p className="text-xs text-red-300/70 max-w-md text-center">{prediction.error}</p>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-center h-64 rounded-lg bg-[#121212] border border-[#2D2D2D]">
                  <p className="text-sm text-[#94A3B8]">No output available</p>
                </div>
              )}

              {/* Metadata Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 rounded-lg bg-[#121212] border border-[#2D2D2D]">
                  <p className="text-xs text-[#94A3B8] uppercase tracking-wider mb-1">Model</p>
                  <p className="text-sm text-white font-mono truncate" title={prediction.model}>
                    {prediction.model.split("/").pop() || prediction.model}
                  </p>
                </div>
                <div className="p-4 rounded-lg bg-[#121212] border border-[#2D2D2D]">
                  <p className="text-xs text-[#94A3B8] uppercase tracking-wider mb-1">Predict Time</p>
                  <p className="text-sm text-white font-mono">
                    {formatDuration(prediction.metrics?.predict_time)}
                  </p>
                </div>
                <div className="p-4 rounded-lg bg-[#121212] border border-[#2D2D2D]">
                  <p className="text-xs text-[#94A3B8] uppercase tracking-wider mb-1">Total Time</p>
                  <p className="text-sm text-white font-mono">
                    {formatDuration(prediction.metrics?.total_time)}
                  </p>
                </div>
                <div className="p-4 rounded-lg bg-[#121212] border border-[#2D2D2D]">
                  <p className="text-xs text-[#94A3B8] uppercase tracking-wider mb-1">Source</p>
                  <p className="text-sm text-white font-mono">
                    {prediction.source || "API"}
                  </p>
                </div>
              </div>

              {/* Input */}
              {prediction.input && Object.keys(prediction.input).length > 0 && (
                <div className="rounded-lg bg-[#121212] border border-[#2D2D2D] p-4">
                  <p className="text-xs text-[#94A3B8] uppercase tracking-wider mb-3">Input</p>
                  <div className="space-y-2">
                    {Object.entries(prediction.input).map(([key, value]) => (
                      <div key={key} className="flex gap-2">
                        <span className="text-sm text-[#ff0073] font-mono shrink-0">{key}:</span>
                        <span className="text-sm text-white font-mono break-all">
                          {typeof value === "string" && value.length > 200
                            ? `${value.slice(0, 200)}...`
                            : JSON.stringify(value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="relative">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyJson}
                className="absolute top-2 right-2 border-[#2D2D2D] hover:bg-[#2D2D2D]"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4 mr-1.5 text-green-400" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 mr-1.5" />
                    Copy
                  </>
                )}
              </Button>
              <pre className="p-4 rounded-lg bg-[#121212] border border-[#2D2D2D] overflow-auto max-h-[500px] text-sm text-[#E2E8F0] font-mono">
                {JSON.stringify(prediction, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
