import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { httpLink } from "@/lib/post-site"
import { momentText } from "./format"
import { useIndexStatus } from "./use-site-analytics"

/** Google's verdict on a page, as an admin reads it. The coverage sentence under it says why. */
const VERDICT: Record<string, { label: string; className: string }> = {
  PASS: { label: "Indexed", className: "bg-green-500/15 text-green-700 dark:text-green-400" },
  PARTIAL: { label: "Partly indexed", className: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  NEUTRAL: { label: "Not indexed", className: "bg-muted text-muted-foreground" },
  FAIL: { label: "Not indexed", className: "bg-destructive/15 text-destructive" },
}
const UNKNOWN = { label: "Unknown", className: "bg-muted text-muted-foreground" }

/** Whether Google indexed this page — asked on demand (a daily budget of page checks), kept a day, and dated. */
export function IndexStatusCell({ url }: { url: string }) {
  const { status, checking, error, check } = useIndexStatus(url)

  if (checking) return <Loader2 className="h-4 w-4 animate-spin ms-auto" aria-label="Checking with Google" />

  if (status) {
    const verdict = VERDICT[status.verdict] ?? UNKNOWN
    const details = httpLink(status.inspectionLink)
    return (
      <div className="flex flex-col items-end gap-0.5">
        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${verdict.className}`}>{verdict.label}</span>
        {status.coverageState && <span className="text-[11px] text-muted-foreground text-end">{status.coverageState}</span>}
        {status.lastCrawlTime && <span className="text-[11px] text-muted-foreground">Crawled {momentText(status.lastCrawlTime)}</span>}
        <span className="text-[11px] text-muted-foreground">Checked {momentText(status.checkedAt)}</span>
        <span className="flex gap-2 text-[11px]">
          {details && (
            <a href={details} target="_blank" rel="noopener noreferrer" className="underline">
              Details
            </a>
          )}
          <button type="button" className="underline" onClick={() => check(true)}>
            Check again
          </button>
        </span>
        {error && <span className="text-[11px] text-destructive text-end max-w-64">{error.message}</span>}
      </div>
    )
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => check(false)}>
        Check
      </Button>
      {error && <span className="text-[11px] text-destructive text-end max-w-64">{error.message}</span>}
    </div>
  )
}
