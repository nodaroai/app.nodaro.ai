import { Badge } from "@/components/ui/badge"

/**
 * Which surface created a job.
 *
 * Before `jobs.source` existed, the admin table's "Source" column could only
 * say "Workflow" or "Single" — so an MCP tool call, a CLI run, a studio session
 * and a raw API integration all rendered identically as "Single". This renders
 * the real answer.
 *
 * `source` is the coarse kind and `source_detail` the specific identity (MCP
 * client name, browser origin host, client package + version, developer-app id).
 * The detail is shown WHENEVER present, which is what makes the column
 * open-ended: a new `person.nodaro.ai` appears correctly the day it launches,
 * because the backend stores the origin host rather than mapping it to a label
 * some file has to learn about first.
 */

/** Colour by kind only. Deliberately NOT keyed on `source_detail` — that set is
 *  open, and a lookup miss should be invisible, not an unstyled badge. */
const TONE: Record<string, string> = {
  mcp: "border-violet-500/40 text-violet-600 dark:text-violet-400",
  web: "border-sky-500/40 text-sky-600 dark:text-sky-400",
  cli: "border-amber-500/40 text-amber-600 dark:text-amber-400",
  sdk: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
  app: "border-pink-500/40 text-pink-600 dark:text-pink-400",
  api: "border-slate-500/40 text-slate-600 dark:text-slate-400",
  internal: "border-slate-500/40 text-slate-500",
}

/** Human label for the coarse kind. Unknown kinds fall through to the raw
 *  value rather than "Unknown" — a source the backend emits but this file has
 *  not learned about should still be READABLE here. */
const LABEL: Record<string, string> = {
  mcp: "MCP",
  web: "Web",
  cli: "CLI",
  sdk: "SDK",
  app: "App",
  api: "API",
  internal: "Internal",
}

export interface JobSourceBadgeProps {
  source: string | null | undefined
  sourceDetail?: string | null
  /** Resolved display name when `source === "app"` — `sourceDetail` stores the
   *  developer-app's UUID (it is a query key elsewhere, so the stored value
   *  never becomes a name). When present it replaces the raw id as the visible
   *  detail; the id stays in the hover title. Null/undefined (app deleted, or
   *  name not resolved) falls back to showing the id. */
  appName?: string | null
  /** Set when the job ran inside an orchestrated workflow. Orthogonal to
   *  `source` — a workflow run still has an originating caller — so it renders
   *  as a second badge rather than replacing the first. */
  workflowExecutionId?: string | null
  className?: string
}

export function JobSourceBadge({ source, sourceDetail, appName, workflowExecutionId, className = "" }: JobSourceBadgeProps) {
  const badges = []

  if (source) {
    const label = LABEL[source] ?? source
    const visibleDetail = (source === "app" && appName) || sourceDetail
    badges.push(
      <Badge
        key="source"
        variant="outline"
        className={`text-xs ${TONE[source] ?? ""}`}
        // Full detail on hover: the visible text is truncated for table density,
        // but an operator chasing a specific integration needs the whole value —
        // for app jobs that means the app id even when the name is shown.
        title={
          source === "app" && appName && sourceDetail
            ? `${label} · ${appName} · ${sourceDetail}`
            : sourceDetail
              ? `${label} · ${sourceDetail}`
              : label
        }
      >
        {label}
        {visibleDetail && (
          <span className="ml-1 font-normal opacity-70 max-w-[14ch] truncate inline-block align-bottom">
            {visibleDetail}
          </span>
        )}
      </Badge>,
    )
  } else {
    // Origin never recorded: the row predates migration 282, or was written by
    // an internal path from before provenance stamping was enforced everywhere
    // (the no-direct-job-insert guard now covers all of src/). Shown as an
    // explicit em-dash rather than a guess — "unknown" is a usable answer,
    // a wrong label is not.
    badges.push(
      <span key="none" className="text-xs text-muted-foreground" title="No source recorded (row predates source stamping on this path)">
        —
      </span>,
    )
  }

  if (workflowExecutionId) {
    badges.push(
      <Badge key="wf" variant="outline" className="text-xs" title={`Workflow execution ${workflowExecutionId}`}>
        Workflow
      </Badge>,
    )
  }

  return <span className={`inline-flex flex-wrap items-center gap-1 ${className}`}>{badges}</span>
}
