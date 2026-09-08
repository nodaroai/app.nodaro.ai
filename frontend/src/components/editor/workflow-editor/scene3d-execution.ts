/**
 * Job-running for the two 3D-scene nodes.
 *
 * `POST /v1/3d-scene/generate` and `/edit` both answer with a job id only —
 * the scene arrives in the job's `output_data.scenePlan`. That is the same
 * plan-only shape the generate-video-pro planning path uses, so this mirrors
 * that inline poll rather than `pollJobWithNodeUpdate` (whose completion
 * contract is a media URL).
 *
 * Two things this does that a plain poll must not:
 *
 *  - it re-reads the node's CURRENT scene at completion time and compares it
 *    against the base revision CAPTURED for this job (never the node's mutable
 *    `sceneJobBaseRevisionId`, which a second run overwrites) — see
 *    `resolveSceneCompletion`;
 *  - when the node has moved on to another run, it still files the arriving
 *    revision in history (it was paid for) but writes none of the run-state
 *    keys that now belong to the newer run.
 */
import { useWorkflowStore } from "@/hooks/use-workflow-store";
import { guardedToast, getJobStatusLeanForNode, RUN_START_RESET } from "./poll-job";
import { shouldAbandonNode } from "./abandon-guard";
import {
  WorkflowStaleError,
  MAX_CONSECUTIVE_POLL_FAILURES,
  checkStorageError,
  updateProgressIfChanged,
  type ExecutionContext,
} from "./types";
import { archiveSupersededResult, resolveSceneCompletion } from "@/lib/scene3d/revisions";
import { planRevisionId } from "@/lib/scene3d/plan-view";
import type { Scene3DRevisionContext, Scene3DRevisionEntry } from "@/types/nodes";

const POLL_INTERVAL_MS = 2000;

/** A job is over — in any of these three ways — and the poll must stop. */
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

export type Scene3DJobParams = {
  nodeId: string;
  /** Fires the route call. Resolves with the queued job id. */
  start: () => Promise<{ jobId: string }>;
  /** Which revision stack entry this job's result is recorded as. */
  source: Extract<Scene3DRevisionEntry["source"], "generate" | "edit">;
  ctx: ExecutionContext;
  /** Toast noun: "Scene generation" / "Scene edit". */
  label: string;
  /** The inputs this run was launched with, stored with the revision it
   *  produces so restoring it restores what was asked for. */
  context?: Scene3DRevisionContext;
  /**
   * Extra node-data written when the job completes, read from the job's
   * `output_data`.
   *
   * 3D Render Pro settles with a scene AND a video, and the video half has no
   * place in the revision stack — it is an ordinary media result. Rather than
   * fork the poll (and with it the stale-completion guard, the archive path
   * and the cancel handling, which is where the subtle bugs live), the one
   * node that produces more than a revision says so here.
   *
   * Applied on the ADOPT path only, enforced HERE rather than left to each
   * caller: a superseded result is archived into history and must not overwrite
   * the live node's media, exactly as it must not overwrite its live plan.
   *
   * The second argument is the completion context the callback cannot obtain
   * for itself: the job that actually settled (a job's `output_data` does not
   * carry its own id) and the node's data as of COMPLETION time — never the
   * snapshot captured at run start, which a second run finishing in between
   * would have made stale.
   */
  extraCompletionPatch?: (
    output: Record<string, unknown>,
    completion: Scene3DCompletionContext,
  ) => Record<string, unknown>;
};

/** What `extraCompletionPatch` is told about the settlement it is patching. */
export type Scene3DCompletionContext = {
  /** The job that settled — the id its result must be correlated with. */
  jobId: string;
  /** The node's data re-read after the status await, i.e. what it holds NOW. */
  liveNode: Record<string, unknown>;
};

/**
 * Run one 3D-scene authoring job to completion.
 *
 * Resolves with `"plan-ready"` when the node ends up holding a scene (the
 * marker every composer node's `composition` output carries), or `""` when the
 * node was abandoned mid-flight or the job was cancelled.
 */
export function runScene3DJob({ nodeId, start, source, ctx, label, context, extraCompletionPatch }: Scene3DJobParams): Promise<string> {
  const { updateNodeData } = useWorkflowStore.getState();

  // The revision the job is being launched AGAINST, captured HERE — every
  // completion decision below reads this constant, never the node field. Two
  // runs on one node have two different bases; the node has only one slot.
  const nodeAtStart = useWorkflowStore.getState().nodes.find((n) => n.id === nodeId);
  const baseRevisionId = planRevisionId(
    (nodeAtStart?.data as Record<string, unknown> | undefined)?.scenePlan as
      | Record<string, unknown>
      | undefined,
  );

  /** The node's live data, or `{}` when it has been deleted. */
  const readLive = (): Record<string, unknown> =>
    (useWorkflowStore.getState().nodes.find((n) => n.id === nodeId)?.data ?? {}) as Record<string, unknown>;

  /**
   * File a result that arrived for a run this node no longer points at: keep
   * the revision (it was billed) and touch nothing else.
   */
  const archive = (incoming: Record<string, unknown>, changeSummary?: string, jobId?: string) => {
    if (!useWorkflowStore.getState().nodes.some((n) => n.id === nodeId)) return;
    const live = readLive();
    const patch = archiveSupersededResult(
      live.sceneHistory as Scene3DRevisionEntry[] | undefined,
      incoming,
      source,
      { changeSummary, context, jobId },
    );
    if (patch) updateNodeData(nodeId, patch);
  };

  // NOTE: `scenePlan` is deliberately NOT cleared — the spec requires the
  // current scene to stay on screen and scrubbable while the LLM works.
  updateNodeData(nodeId, {
    ...RUN_START_RESET,
    scenePendingPlan: undefined,
    sceneJobBaseRevisionId: baseRevisionId,
  });

  return new Promise<string>((resolve, reject) => {
    start()
      .then(({ jobId }) => {
        guardedToast.info(`${label} started`, { description: `Job ID: ${jobId}` });
        updateNodeData(nodeId, { currentJobId: jobId });

        let pollFailures = 0;
        const poll = ctx.trackInterval(
          setInterval(async () => {
            if (ctx.isWorkflowStale()) {
              ctx.untrackInterval(poll);
              reject(new WorkflowStaleError());
              return;
            }
            try {
              const job = await getJobStatusLeanForNode(jobId, nodeId);
              pollFailures = 0;
              if (job.status === "processing" && job.progress != null) {
                updateProgressIfChanged(nodeId, job.progress, updateNodeData);
              }

              // `pending_review` is intentionally NOT terminal: the hold is
              // painted by `getJobStatusLeanForNode`'s overlay and the job
              // still resolves to completed/failed afterwards.
              if (!TERMINAL_STATUSES.has(job.status)) return;

              const out = (job.output_data ?? {}) as Record<string, unknown>;
              const incoming = out.scenePlan as Record<string, unknown> | undefined;
              const changeSummary = typeof out.changeSummary === "string" ? out.changeSummary : undefined;

              // Re-check after the await: a discard or a newer run may have
              // landed while the status request was in flight. Never write
              // terminal state for a job the node no longer points at — but
              // DO keep a scene it produced, in history only.
              if (shouldAbandonNode(nodeId, jobId)) {
                ctx.untrackInterval(poll);
                if (job.status === "completed" && incoming) archive(incoming, changeSummary, jobId);
                resolve("");
                return;
              }

              if (job.status === "cancelled") {
                ctx.untrackInterval(poll);
                updateNodeData(nodeId, {
                  executionStatus: "idle",
                  currentJobId: undefined,
                  currentJobProgress: undefined,
                  jobAwaitingReview: undefined,
                  sceneJobBaseRevisionId: undefined,
                });
                resolve("");
                return;
              }

              if (job.status === "completed") {
                ctx.untrackInterval(poll);
                if (!incoming) {
                  const msg = `${label} returned no scene`;
                  updateNodeData(nodeId, {
                    executionStatus: "failed",
                    errorMessage: msg,
                    currentJobId: undefined,
                    currentJobProgress: undefined,
                    sceneJobBaseRevisionId: undefined,
                  });
                  guardedToast.error(msg);
                  reject(new Error(msg));
                  return;
                }

                // Re-read the node NOW — this is the whole point of the guard.
                const liveData = readLive();
                const result = resolveSceneCompletion({
                  current: liveData.scenePlan as Record<string, unknown> | undefined,
                  baseRevisionId,
                  incoming,
                  changeSummary,
                  history: liveData.sceneHistory as Scene3DRevisionEntry[] | undefined,
                  source,
                  context,
                  // Recorded ON the revision: a later 3D Render Pro `scene`
                  // source names both the revision and the run that made it.
                  jobId,
                });

                updateNodeData(nodeId, {
                  ...result.patch,
                  // ADOPT ONLY. On the park path the arriving plan is kept
                  // aside and the live scene stays put — writing the other half
                  // (3D Render Pro's MP4) would leave the node showing a video
                  // that does not match its composition, and feed that stale
                  // MP4 downstream from the `video` handle. The reload path
                  // (`buildScene3DRecoveryPatch`) applies the same rule.
                  ...(result.outcome === "adopt"
                    ? (extraCompletionPatch?.(out, { jobId, liveNode: liveData }) ?? {})
                    : {}),
                  executionStatus: "completed",
                  currentJobId: undefined,
                  currentJobProgress: undefined,
                });

                if (result.outcome === "park") {
                  guardedToast.warning(`${label} finished on an older revision`, {
                    description: "Your later edits were kept. Open the panel to review the new revision.",
                  });
                } else {
                  guardedToast.success(`${label} complete`);
                }
                const active = result.patch.scenePlan ?? (liveData.scenePlan as Record<string, unknown> | undefined);
                resolve(active ? "plan-ready" : "");
              } else {
                ctx.untrackInterval(poll);
                const errMsg = job.error_message ?? `${label} failed`;
                updateNodeData(nodeId, {
                  executionStatus: "failed",
                  errorMessage: errMsg,
                  currentJobId: undefined,
                  currentJobProgress: undefined,
                  sceneJobBaseRevisionId: undefined,
                });
                guardedToast.error(`${label} failed`, { description: errMsg });
                reject(new Error(errMsg));
              }
            } catch (err) {
              pollFailures++;
              if (pollFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
                ctx.untrackInterval(poll);
                if (shouldAbandonNode(nodeId, jobId)) {
                  resolve("");
                  return;
                }
                updateNodeData(nodeId, {
                  executionStatus: "failed",
                  currentJobId: undefined,
                  currentJobProgress: undefined,
                  sceneJobBaseRevisionId: undefined,
                });
                guardedToast.error(`Failed to check ${label.toLowerCase()} status`);
                reject(err);
              }
            }
          }, POLL_INTERVAL_MS),
        );
      })
      .catch((err) => {
        // A start failure is this run's failure only if the node still points
        // at this run — it has no job id yet, so re-check the base instead.
        updateNodeData(nodeId, {
          executionStatus: "failed",
          errorMessage: err instanceof Error ? err.message : String(err),
          currentJobId: undefined,
          currentJobProgress: undefined,
          sceneJobBaseRevisionId: undefined,
        });
        if (!checkStorageError(err, ctx)) {
          guardedToast.error(`Failed to start ${label.toLowerCase()}`, {
            description: err instanceof Error ? err.message : String(err),
          });
        }
        reject(err);
      });
  });
}
