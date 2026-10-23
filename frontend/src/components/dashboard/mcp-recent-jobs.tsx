// @registry-lookup labels each listed job by its own type, one label at a time (formatNodeType)
import { useMemo } from "react"
import { AudioWaveform, Loader2, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useT } from "@/lib/i18n"
import { formatDate } from "@/lib/i18n/format"
import { useLocalizeNodeLabel } from "@/lib/i18n/labels"
import { formatNodeType } from "@/components/editor/execution-utils"
import { jobPreview, type JobPreview } from "@/lib/job-preview"
import { useMcpRecentJobs } from "@/hooks/queries/use-mcp-recent-jobs"
import type { Job } from "@/lib/api"

interface McpRecentJobsProps {
  /** The home screen's Jump back in search text: matches the job's kind and client. */
  readonly search?: string
}

function PreviewMedia({ preview }: { readonly preview: JobPreview }) {
  if (preview.kind === "image") {
    return <img src={preview.url} alt="" loading="lazy" className="h-full w-full object-cover" />
  }
  if (preview.kind === "video") {
    return (
      <video
        src={preview.url}
        poster={preview.posterUrl}
        muted
        playsInline
        preload="metadata"
        className="h-full w-full object-cover"
      />
    )
  }
  const Icon = preview.kind === "audio" ? AudioWaveform : Sparkles
  return <Icon className="h-6 w-6 text-muted-foreground" aria-hidden />
}

/**
 * The single generations an MCP client made (Claude, ChatGPT, …), under the
 * MCP Workflows grid: they belong to no workflow, so the grid cannot show them.
 */
export function McpRecentJobs({ search = "" }: McpRecentJobsProps) {
  const t = useT()
  const localizeNodeLabel = useLocalizeNodeLabel()
  const { data, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage } = useMcpRecentJobs()
  const jobs = useMemo(() => data?.pages.flatMap((page) => page.data) ?? [], [data])

  const rows = useMemo(
    () =>
      jobs.map((job: Job) => ({
        job,
        kind: (() => {
          const type = job.input_data?.type ?? job.job_type ?? ""
          return type ? localizeNodeLabel(formatNodeType(type)) : t("exec.job")
        })(),
        client: job.source_detail ?? "",
        preview: jobPreview(job),
      })),
    [jobs, localizeNodeLabel, t],
  )

  const needle = search.trim().toLowerCase()
  const shown = needle
    ? rows.filter((r) => r.kind.toLowerCase().includes(needle) || r.client.toLowerCase().includes(needle))
    : rows

  return (
    <section className="mt-8" aria-labelledby="mcp-recent-jobs-heading">
      <h2 id="mcp-recent-jobs-heading" className="mb-3 text-sm font-medium text-muted-foreground">
        {t("dash.mcpRecentActivity")}
      </h2>
      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label={t("common.loading")} />
        </div>
      ) : shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {needle ? t("dash.noWorkflowsMatch") : t("dash.noMcpActivityYet")}
        </p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
          {shown.map(({ job, kind, client, preview }) => {
            const card = (
              <>
                <div className="flex aspect-video items-center justify-center overflow-hidden bg-muted">
                  <PreviewMedia preview={preview} />
                </div>
                <div className="px-2.5 py-2">
                  <p className="truncate text-[12px] font-semibold">{kind}</p>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {client ? `${t("lib.triggerViaClient", { client })}${t("common.listComma")}` : ""}
                    {formatDate(job.created_at)}
                  </p>
                </div>
              </>
            )
            const className = "block overflow-hidden rounded-xl border bg-card transition-colors hover:bg-accent/30"
            return preview.kind === "none" ? (
              <div key={job.id} className={className}>
                {card}
              </div>
            ) : (
              <a key={job.id} href={preview.url} target="_blank" rel="noopener noreferrer" className={className}>
                {card}
              </a>
            )
          })}
        </div>
      )}
      {hasNextPage && !isLoading && (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" size="sm" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
            {isFetchingNextPage && <Loader2 className="me-1 h-4 w-4 animate-spin" aria-hidden />}
            {t("exec.showMore")}
          </Button>
        </div>
      )}
    </section>
  )
}
