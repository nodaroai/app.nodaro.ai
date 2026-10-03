import { useWorkflowStore } from "@/hooks/use-workflow-store";
import { tx } from "@/lib/i18n";
import { shouldAbandonNode } from "./abandon-guard";
import { MAX_CONSECUTIVE_POLL_FAILURES } from "./types";

/**
 * When a job-status poll loop may stop watching its job — the ONE rule every
 * loop's give-up branch goes through.
 *
 * A status check that cannot reach the server says nothing about the job. The
 * job keeps running (and billing) while the browser is offline, asleep, or in a
 * throttled background tab. The loops used to count 20 failed checks and then
 * mark the NODE failed: no message, the job id dropped, nobody left watching. A
 * job that finished a minute later reached My Library but never the canvas
 * (prod 2026-09-27: a GPT Image job completed and was billed while its node read
 * "Failed"; a reload recovered it).
 *
 * Only a DEFINITIVE answer now ends the watch: the server responded, and the
 * job cannot be read (403/404/410 — deleted, or not ours), MAX times in a row.
 * Any other failure — network, timeout, 5xx, 429, 401 — keeps the loop polling.
 * From the MAXth one on, the node shows it is reconnecting (`jobConnectionLost`,
 * rendered once by BaseNode), and the next check that gets through clears it
 * (`getJobStatusLeanForNode`).
 *
 * `__tests__/poll-connection-guard.test.ts` fails the build when any other file
 * compares a failure count against MAX_CONSECUTIVE_POLL_FAILURES itself.
 */

/** The statuses that mean the job itself is unreadable, not the connection. */
const JOB_GONE_STATUSES: ReadonlySet<number> = new Set([403, 404, 410]);

/** True when the server answered that this job cannot be read: it was deleted,
 *  or it belongs to someone else. SDK errors carry the HTTP status. */
export function isJobGoneError(err: unknown): boolean {
  const status = (err as { status?: unknown } | null | undefined)?.status;
  return typeof status === "number" && JOB_GONE_STATUSES.has(status);
}

/** The canvas node a loop paints, and the job it is watching for it. */
export interface PollOwner {
  readonly nodeId: string;
  readonly jobId: string;
}

/**
 * Called by every poll loop after it counts a failed check. True only when the
 * loop must stop: the job is gone. Otherwise the loop keeps polling, and from
 * the MAXth failure on the owner node shows it is reconnecting — unless the
 * node has moved on to another run, whose card this job must not paint.
 */
export function shouldStopPolling(
  err: unknown,
  consecutiveFailures: number,
  owner?: PollOwner,
): boolean {
  if (consecutiveFailures < MAX_CONSECUTIVE_POLL_FAILURES) return false;
  if (isJobGoneError(err)) return true;
  if (owner && !shouldAbandonNode(owner.nodeId, owner.jobId)) {
    setJobConnectionLost(owner.nodeId, true);
  }
  return false;
}

/** True exactly once per outage: on the failure that crosses the threshold.
 *  For a loop with no node card to mark, which says it once instead. */
export function connectionJustLost(consecutiveFailures: number): boolean {
  return consecutiveFailures === MAX_CONSECUTIVE_POLL_FAILURES;
}

/** Called by a loop after a check that got through: the node is no longer
 *  reconnecting. Only for the run the node is showing — a loop still watching
 *  an older job must not clear the badge of a newer run that is still cut off
 *  (the two would otherwise flicker it on a partial outage). */
export function clearJobConnectionLost(owner: PollOwner): void {
  if (shouldAbandonNode(owner.nodeId, owner.jobId)) return;
  setJobConnectionLost(owner.nodeId, false);
}

/** The node's message when its watch ended because the job is gone. */
export function jobGoneMessage(): string {
  return tx("nodeRun.jobUnavailable");
}

/** Writes `jobConnectionLost` only on a real transition, so a failing 2s poll
 *  neither re-renders the node nor churns the store on every tick. */
export function setJobConnectionLost(nodeId: string, lost: boolean): void {
  const { nodes, updateNodeData } = useWorkflowStore.getState();
  const data = nodes.find((n) => n.id === nodeId)?.data as Record<string, unknown> | undefined;
  if (!data || lost === (data.jobConnectionLost === true)) return;
  updateNodeData(nodeId, { jobConnectionLost: lost ? true : undefined });
}
