import { useEffect, useRef } from "react"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { tx } from "@/lib/i18n"
import { triggerSourceLabel } from "@/components/library/triggers/trigger-labels"
import { executionsPageQuery } from "../executions-query"
import { diffTriggeredRuns, type RunNotice, type RunNoticeKind, type SeenRuns } from "./triggered-run-notices"

/** How often the open editor looks for runs it did not start — the Executions tab's own pace. */
const POLL_MS = 10_000
/** More notices than this from one look are summed up, one notice per kind. */
const MAX_SINGLE_NOTICES = 3

/** View: the run to open (null = the list), and whether to open its result too. */
export type ViewTriggeredRun = (executionId: string | null, openResult: boolean) => void

/**
 * While the workflow has a trigger node (one that starts runs without the
 * editor), tell the person when such a run starts and how it ends, each
 * notice with a View action. It reads the Executions tab's first page (one
 * shared cache entry), and only looks it has fetched itself count: a page
 * cached before this editor opened is not "history" to compare against.
 * View-only: the run's results are never written into the workflow (see
 * `triggered-run-notices.ts`).
 */
export function useTriggeredRunNotices(workflowId: string | null | undefined, listening: boolean, onView: ViewTriggeredRun): void {
  const seenRef = useRef<SeenRuns | null>(null)
  const onViewRef = useRef(onView)

  useEffect(() => {
    onViewRef.current = onView
  }, [onView])

  // Another workflow, or a pause in listening, starts a new history.
  useEffect(() => {
    seenRef.current = null
  }, [workflowId, listening])

  const { data, dataUpdatedAt, isFetchedAfterMount } = useQuery({
    ...executionsPageQuery(workflowId ?? ""),
    enabled: Boolean(workflowId) && listening,
    refetchInterval: POLL_MS,
  })

  useEffect(() => {
    if (!data || !isFetchedAfterMount || !listening) return
    const { seen, notices } = diffTriggeredRuns(seenRef.current, data.data)
    seenRef.current = seen
    showRunNotices(notices, (executionId, openResult) => onViewRef.current(executionId, openResult))
    // A fetch is a look even when the page did not change: key on its time, not
    // its identity. Not on `listening` either: after a pause, the first look is
    // the next fetch, never the page cached before it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataUpdatedAt, isFetchedAfterMount])
}

const SUMMARY_KEYS: Readonly<Record<RunNoticeKind, "exec.noticeManyStarted" | "exec.noticeManyFinished" | "exec.noticeManyFailed">> = {
  started: "exec.noticeManyStarted",
  finished: "exec.noticeManyFinished",
  failed: "exec.noticeManyFailed",
}

function showRunNotices(notices: readonly RunNotice[], view: ViewTriggeredRun): void {
  if (notices.length > MAX_SINGLE_NOTICES) {
    for (const kind of ["started", "finished", "failed"] as const) {
      const n = notices.filter((notice) => notice.kind === kind).length
      if (n === 0) continue
      const options = { id: `run-notice-many-${kind}`, action: { label: tx("exec.noticeView"), onClick: () => view(null, false) } }
      const message = tx(SUMMARY_KEYS[kind], { n })
      if (kind === "failed") toast.error(message, options)
      else if (kind === "finished") toast.success(message, options)
      else toast(message, options)
    }
    return
  }
  for (const notice of notices) {
    const source = triggerSourceLabel(tx, notice.triggerType)
    // One id per run, so a run never shows two toasts at once.
    const options = {
      id: `run-notice-${notice.executionId}`,
      action: { label: tx("exec.noticeView"), onClick: () => view(notice.executionId, notice.kind !== "started") },
    }
    if (notice.kind === "started") toast(tx("exec.noticeStarted", { source }), options)
    else if (notice.kind === "finished") toast.success(tx("exec.noticeFinished", { source }), options)
    else toast.error(tx("exec.noticeFailed", { source }), options)
  }
}
