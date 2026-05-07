import { useState } from "react"
import { Loader2, CheckCircle, XCircle, Eye, Trash2, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { CachedImage } from "@/components/ui/cached-image"
import { useAuth } from "@/hooks/use-auth"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import { createClient } from "@/lib/supabase"
import { useAdminReports, useResolveReportMutation } from "@/ee/hooks/queries/use-admin-queries"

type ReportStatus = "pending" | "reviewed" | "dismissed"

interface GalleryReport {
  readonly id: string
  readonly job_id: string
  readonly reason: string
  readonly details: string | null
  readonly reporter_ip: string | null
  readonly status: ReportStatus
  readonly created_at: string
  readonly jobs: {
    readonly id: string
    readonly job_type: string
    readonly input_data: Record<string, unknown> | null
    readonly output_data: Record<string, unknown> | null
  } | null
}

interface ReportsResponse {
  readonly data: readonly GalleryReport[]
  readonly total: number
  readonly page: number
  readonly limit: number
}

const STATUS_FILTERS: readonly { readonly value: ReportStatus | "all"; readonly label: string }[] = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "reviewed", label: "Reviewed" },
  { value: "dismissed", label: "Dismissed" },
]

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function getOutputUrl(jobType: string, outputData: Record<string, unknown> | null): string | null {
  if (!outputData) return null
  const imageTypes = ["generate-image", "edit-image", "image-to-image", "generate-character", "generate-character-asset", "generate-object", "generate-object-asset", "generate-location", "generate-location-asset"]
  const videoTypes = ["image-to-video", "text-to-video", "video-to-video", "lip-sync", "motion-transfer", "video-upscale", "combine-videos", "suno-music-video", "merge-video-audio", "resize-video", "trim-video", "add-captions"]
  const audioTypes = ["text-to-speech", "generate-music", "text-to-audio", "suno-generate", "suno-cover", "suno-extend", "suno-separate", "trim-audio", "mix-audio", "adjust-volume"]

  if (imageTypes.includes(jobType)) return (outputData.imageUrl as string) ?? null
  if (videoTypes.includes(jobType)) return (outputData.videoUrl as string) ?? null
  if (audioTypes.includes(jobType)) return (outputData.audioUrl as string) ?? null
  return null
}

function getOutputType(jobType: string): "image" | "video" | "audio" | null {
  const imageTypes = ["generate-image", "edit-image", "image-to-image", "generate-character", "generate-character-asset", "generate-object", "generate-object-asset", "generate-location", "generate-location-asset"]
  const videoTypes = ["image-to-video", "text-to-video", "video-to-video", "lip-sync", "motion-transfer", "video-upscale", "combine-videos", "suno-music-video", "merge-video-audio", "resize-video", "trim-video", "add-captions"]
  const audioTypes = ["text-to-speech", "generate-music", "text-to-audio", "suno-generate", "suno-cover", "suno-extend", "suno-separate", "trim-audio", "mix-audio", "adjust-volume"]

  if (imageTypes.includes(jobType)) return "image"
  if (videoTypes.includes(jobType)) return "video"
  if (audioTypes.includes(jobType)) return "audio"
  return null
}

function StatusBadge({ status }: { readonly status: ReportStatus }) {
  const config = {
    pending: { label: "Pending", className: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400" },
    reviewed: { label: "Reviewed", className: "bg-green-500/10 text-green-600 dark:text-green-400" },
    dismissed: { label: "Dismissed", className: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400" },
  }
  const { label, className } = config[status]
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", className)}>
      {label}
    </span>
  )
}

function ReasonBadge({ reason }: { readonly reason: string }) {
  const config: Record<string, { label: string; className: string }> = {
    inappropriate: { label: "Inappropriate", className: "bg-red-500/10 text-red-600 dark:text-red-400" },
    copyright: { label: "Copyright", className: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
    spam: { label: "Spam", className: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
    other: { label: "Other", className: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400" },
  }
  const { label, className } = config[reason] ?? { label: reason, className: "bg-zinc-500/10 text-zinc-600" }
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", className)}>
      {label}
    </span>
  )
}

export default function AdminGalleryReportsPage() {
  const { user } = useAuth()
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<ReportStatus | "all">("pending")
  const [previewReport, setPreviewReport] = useState<GalleryReport | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const resolveReportMut = useResolveReportMutation()

  const filter = statusFilter === "all" ? undefined : statusFilter
  const { data: reportsResult, isLoading: loading, refetch: fetchReports } = useAdminReports(page, filter)
  const reports = (reportsResult?.data ?? []) as readonly GalleryReport[]
  const total = (reportsResult?.total ?? 0) as number

  async function updateReportStatus(reportId: string, action: "reviewed" | "dismissed") {
    if (!user?.id) return
    setActionLoading(reportId)
    try {
      await resolveReportMut.mutateAsync({ reportId, action })
      toast.success(`Report marked as ${action}`)
    } catch {
      toast.error("Failed to update report")
    } finally {
      setActionLoading(null)
    }
  }

  async function handleRemoveFromGallery(jobId: string, reportId: string) {
    if (!user?.id) return
    setActionLoading(jobId)
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const response = await fetch(`/v1/gallery/${jobId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ userId: user.id }),
      })

      if (!response.ok) throw new Error("Failed to remove item")

      await resolveReportMut.mutateAsync({ reportId, action: "reviewed" }).catch(() => {})

      toast.success("Item removed from gallery")
      fetchReports()
    } catch {
      toast.error("Failed to remove item")
    } finally {
      setActionLoading(null)
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Gallery Reports</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Review and manage content reports from the community gallery
          </p>
        </div>
        <span className="text-sm text-muted-foreground">
          {total} report{total !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Status filter tabs */}
      <div className="flex items-center gap-1 rounded-lg border border-zinc-200 dark:border-zinc-800 p-1 bg-card w-fit mb-6">
        {STATUS_FILTERS.map(({ value, label }) => (
          <button
            key={value}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              statusFilter === value
                ? "bg-[#ff0073] text-white"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => { setStatusFilter(value); setPage(1) }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Reports list */}
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : reports.length === 0 ? (
        <div className="text-center py-24 text-muted-foreground">
          <p className="text-lg">No reports</p>
          <p className="text-sm mt-1">
            {statusFilter === "all" ? "No reports have been submitted yet." : `No ${statusFilter} reports.`}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map((report) => {
            const jobType = report.jobs?.job_type ?? "unknown"
            const outputUrl = report.jobs ? getOutputUrl(jobType, report.jobs.output_data) : null
            const outputType = getOutputType(jobType)
            const prompt = report.jobs?.input_data
              ? ((report.jobs.input_data.prompt as string) ?? (report.jobs.input_data.text as string) ?? null)
              : null
            const isProcessing = actionLoading === report.id || actionLoading === report.job_id

            return (
              <div
                key={report.id}
                className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-card p-4"
              >
                <div className="flex gap-4">
                  {/* Thumbnail */}
                  <div
                    className="w-20 h-20 rounded-md overflow-hidden bg-zinc-100 dark:bg-zinc-900 flex-shrink-0 cursor-pointer"
                    onClick={() => setPreviewReport(report)}
                  >
                    {outputUrl && outputType === "image" ? (
                      <CachedImage src={outputUrl} alt="" className="w-full h-full object-cover" thumbnail thumbnailWidth={160} />
                    ) : outputUrl && outputType === "video" ? (
                      <video src={outputUrl} muted className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">
                        {outputType ?? "N/A"}
                      </div>
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <ReasonBadge reason={report.reason} />
                      <StatusBadge status={report.status} />
                      <span className="text-xs text-muted-foreground">{jobType}</span>
                      <span className="text-xs text-muted-foreground ml-auto">
                        {formatDate(report.created_at)}
                      </span>
                    </div>

                    {prompt && (
                      <p className="mt-1 text-sm text-foreground truncate">
                        {prompt}
                      </p>
                    )}

                    {report.details && (
                      <p className="mt-1 text-xs text-muted-foreground italic">
                        &ldquo;{report.details}&rdquo;
                      </p>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-2 mt-3">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => setPreviewReport(report)}
                      >
                        <Eye className="h-3 w-3 mr-1" />
                        Preview
                      </Button>

                      {report.status === "pending" && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs text-green-600 border-green-200 dark:border-green-800 hover:bg-green-50 dark:hover:bg-green-900/20"
                            onClick={() => updateReportStatus(report.id, "reviewed")}
                            disabled={isProcessing}
                          >
                            {isProcessing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <CheckCircle className="h-3 w-3 mr-1" />}
                            Mark Reviewed
                          </Button>

                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => updateReportStatus(report.id, "dismissed")}
                            disabled={isProcessing}
                          >
                            <XCircle className="h-3 w-3 mr-1" />
                            Dismiss
                          </Button>
                        </>
                      )}

                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs text-red-600 border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/20"
                        onClick={() => handleRemoveFromGallery(report.job_id, report.id)}
                        disabled={isProcessing}
                      >
                        <Trash2 className="h-3 w-3 mr-1" />
                        Remove from Gallery
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Pagination */}
      {total > 50 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {Math.ceil(total / 50)}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page * 50 >= total}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}

      {/* Preview Dialog */}
      <Dialog open={previewReport !== null} onOpenChange={(open) => !open && setPreviewReport(null)}>
        <DialogContent className="sm:max-w-2xl p-0 overflow-hidden">
          <DialogTitle className="sr-only">Report Preview</DialogTitle>
          {previewReport && (() => {
            const jobType = previewReport.jobs?.job_type ?? "unknown"
            const outputUrl = previewReport.jobs ? getOutputUrl(jobType, previewReport.jobs.output_data) : null
            const outputType = getOutputType(jobType)

            return (
              <div>
                {/* Media preview */}
                <div className="bg-black flex items-center justify-center min-h-[200px] max-h-[60vh]">
                  {outputUrl && outputType === "image" ? (
                    <CachedImage src={outputUrl} alt="" className="max-w-full max-h-[60vh] object-contain" />
                  ) : outputUrl && outputType === "video" ? (
                    <video src={outputUrl} controls className="max-w-full max-h-[60vh]" />
                  ) : outputUrl && outputType === "audio" ? (
                    <div className="p-8">
                      <audio src={outputUrl} controls className="w-full" />
                    </div>
                  ) : (
                    <p className="text-white/50 p-8">No preview available</p>
                  )}
                </div>

                {/* Report info */}
                <div className="p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <ReasonBadge reason={previewReport.reason} />
                    <StatusBadge status={previewReport.status} />
                    <span className="text-xs text-muted-foreground ml-auto">
                      {formatDate(previewReport.created_at)}
                    </span>
                  </div>

                  {previewReport.details && (
                    <p className="text-sm text-muted-foreground bg-zinc-50 dark:bg-zinc-900 rounded-md p-3 border border-zinc-200 dark:border-zinc-800">
                      {previewReport.details}
                    </p>
                  )}

                  {outputUrl && (
                    <a
                      href={outputUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Open original
                    </a>
                  )}
                </div>
              </div>
            )
          })()}
        </DialogContent>
      </Dialog>
    </div>
  )
}
