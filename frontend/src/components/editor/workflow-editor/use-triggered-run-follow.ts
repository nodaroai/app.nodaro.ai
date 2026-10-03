import { useCallback, useEffect, useRef } from "react"
import { useQuery } from "@tanstack/react-query"
import { executionsPageQuery } from "../executions-query"
import { activeFollowedIds, endedRunToShow, runToFollow, type FollowRun } from "./triggered-run-follow"

/** How often the open editor looks for a run a Telegram message started — the Executions tab's own pace. */
const POLL_MS = 10_000

export interface TriggeredRunFollowActions {
  /** A run that is still going: follow it live. */
  readonly follow: (run: FollowRun) => void
  /** A run that ended before the editor looked: paint it at once. */
  readonly paintEnded: (run: FollowRun) => void
}

/**
 * While the workflow has a Telegram trigger, watch the Executions tab's first
 * page (one shared cache entry) for the runs it starts. When the editor is not
 * already following a run, follow the newest one still going; failing that,
 * paint the newest one that ended, unless the editor ran something since.
 * Only pages fetched since this editor opened count (a page cached before
 * could show a run as going that has long ended); the first one is how a run
 * that happened while the flow was closed reaches the canvas.
 *
 * Returns `markHandled`: a run the editor streams by another way (its own
 * Run, the "already running" answer) is never followed again here.
 */
export function useTriggeredRunFollow(
  workflowId: string | null | undefined,
  listening: boolean,
  busy: boolean,
  actions: TriggeredRunFollowActions,
): { markHandled: (executionId: string) => void } {
  const handledRef = useRef<ReadonlySet<string>>(new Set())
  /** When this workflow was opened here: a page fetched before it is not a look. */
  const openedAtRef = useRef(Date.now())
  const actionsRef = useRef(actions)

  useEffect(() => {
    actionsRef.current = actions
  }, [actions])

  useEffect(() => {
    handledRef.current = new Set()
    openedAtRef.current = Date.now()
  }, [workflowId])

  const markHandled = useCallback((executionId: string) => {
    handledRef.current = new Set([...handledRef.current, executionId])
  }, [])

  const { data, dataUpdatedAt, isFetchedAfterMount } = useQuery({
    ...executionsPageQuery(workflowId ?? ""),
    enabled: Boolean(workflowId) && listening,
    refetchInterval: POLL_MS,
  })

  useEffect(() => {
    // While a run is followed (or the person's own Run is going) nothing else
    // touches the canvas; the next look after it ends picks up what is left.
    // Not before this editor fetched it (a failed first fetch also counts as
    // "fetched", so the page must be newer than the opening too).
    if (!data || !isFetchedAfterMount || dataUpdatedAt < openedAtRef.current || !listening || busy) return
    const handled = handledRef.current
    const live = runToFollow(data.data, handled)
    if (live) {
      // The older ones still going are done with too: followed after it, they
      // would paint over the newest run's results.
      handledRef.current = new Set([...handled, ...activeFollowedIds(data.data)])
      actionsRef.current.follow(live)
      return
    }
    const ended = endedRunToShow(data.data)
    if (ended && !handled.has(ended.id)) {
      handledRef.current = new Set([...handled, ended.id])
      actionsRef.current.paintEnded(ended)
    }
    // A fetch is a look even when the page did not change: key on its time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataUpdatedAt, isFetchedAfterMount, busy, listening])

  return { markHandled }
}
