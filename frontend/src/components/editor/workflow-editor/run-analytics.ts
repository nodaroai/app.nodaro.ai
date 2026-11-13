import { useWorkflowStore } from "@/hooks/use-workflow-store";
import { trackEvent } from "@/lib/analytics/site-analytics";

/**
 * A node's own ▶ runs in the browser, not through runWorkflow (which reports a
 * server run once the server accepted it). The same rule here: the click's run
 * is reported once the server has accepted it — the node shows a new job
 * (`currentJobId`, which every executor that starts a job writes), or the run
 * completes (a node that runs without one). A click a server gate refuses
 * (credits, plan, storage, a validation) never gets that far and is not
 * counted. Once per click, a List-driven fan-out included. Never throws.
 *
 * Start the watch BEFORE the run starts (a job can be written before the
 * caller gets the run's promise back), then hand it the run.
 */
export function watchNodeRunAcceptance(nodeId: string): (execution: Promise<unknown>) => void {
  let reported = false;
  let stopWatching: (() => void) | undefined;
  const report = () => {
    stopWatching?.();
    if (reported) return;
    reported = true;
    trackEvent("workflow_run", { run_scope: "node" });
  };
  const jobOf = (nodes: ReadonlyArray<{ id: string; data?: unknown }>): unknown =>
    (nodes.find((n) => n.id === nodeId)?.data as { currentJobId?: unknown } | undefined)?.currentJobId;

  try {
    const before = jobOf(useWorkflowStore.getState().nodes);
    stopWatching = useWorkflowStore.subscribe((state) => {
      const job = jobOf(state.nodes);
      if (job && job !== before) report();
    });
  } catch {
    // Analytics never breaks a run: without the watch, a completed run still counts.
  }
  return (execution) => {
    void execution.then(report, () => {}).finally(() => stopWatching?.());
  };
}
