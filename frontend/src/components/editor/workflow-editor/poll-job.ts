import { toast } from "sonner";
import { useWorkflowStore } from "@/hooks/use-workflow-store";
import { getJobStatusLean, getExecutionEstimate } from "@/lib/api";
import { calculateProgress } from "@nodaro/shared";
import type { GeneratedResult } from "@/types/nodes";
import { buildVariantResults } from "./variant-results";
import { shouldAbandonNode } from "./abandon-guard";
import {
  WorkflowStaleError,
  MAX_CONSECUTIVE_POLL_FAILURES,
  checkStorageError,
  updateProgressIfChanged,
  type ExecutionContext,
} from "./types";

/** When true, toast notifications are suppressed (used during list fan-out). */
let _suppressToasts = false;
export function setSuppressToasts(suppress: boolean): void {
  _suppressToasts = suppress;
}

/** Toast wrapper that respects the suppression flag. Use instead of raw `toast.*` in execution handlers. */
export const guardedToast = {
  info: (...args: Parameters<typeof toast.info>) => { if (!_suppressToasts) toast.info(...args); },
  success: (...args: Parameters<typeof toast.success>) => { if (!_suppressToasts) toast.success(...args); },
  error: (...args: Parameters<typeof toast.error>) => { if (!_suppressToasts) toast.error(...args); },
};

export type OutputKey = "generatedVideoUrl" | "generatedAudioUrl" | "generatedImageUrl";

/** Map store output key → backend output_data field. */
const OUTPUT_URL_KEY: Record<OutputKey, string> = {
  generatedVideoUrl: "videoUrl",
  generatedImageUrl: "imageUrl",
  generatedAudioUrl: "audioUrl",
};

/** Map store output key → backend output_data array field (multi-variant).
 *  Video providers are single-result today; the key is `undefined` so the
 *  fan-out branch falls through to the single-URL path. */
const OUTPUT_URLS_KEY: Record<OutputKey, string | undefined> = {
  generatedVideoUrl: undefined,
  generatedImageUrl: "imageUrls",
  generatedAudioUrl: "audioUrls",
};

export function pollJobToCompletion(
  jobId: string,
  ctx: ExecutionContext,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let pollFailures = 0;
    const poll = ctx.trackInterval(
      setInterval(async () => {
        if (ctx.isWorkflowStale()) {
          ctx.untrackInterval(poll);
          reject(new WorkflowStaleError());
          return;
        }
        try {
          const job = await getJobStatusLean(jobId);
          pollFailures = 0;
          if (job.status === "completed") {
            ctx.untrackInterval(poll);
            resolve(job.output_data?.imageUrl ?? "");
          } else if (job.status === "failed") {
            ctx.untrackInterval(poll);
            reject(new Error(job.error_message ?? "Failed"));
          }
        } catch (err) {
          pollFailures++;
          if (pollFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
            ctx.untrackInterval(poll);
            // Final verification: the job may have completed while polling was failing
            try {
              const job = await getJobStatusLean(jobId);
              if (job.status === "completed") {
                resolve(job.output_data?.imageUrl ?? "");
                return;
              }
              if (job.status === "failed") {
                reject(new Error(job.error_message ?? "Failed"));
                return;
              }
            } catch { /* final check also failed */ }
            reject(err);
          }
        }
      }, 2000),
    );
  });
}

/**
 * Handle a completed job: extract URL, build result, update store.
 * Shared between the normal completion path and the error-recovery path.
 * Returns true if the completion was handled, false if no URL was found.
 */
function handleJobCompleted(
  job: Awaited<ReturnType<typeof getJobStatusLean>>,
  nodeId: string,
  jobId: string,
  outputKey: OutputKey,
  label: string,
  extraOutputFields: ((od: Record<string, unknown>) => Record<string, unknown>) | undefined,
  updateNodeData: ReturnType<typeof useWorkflowStore.getState>["updateNodeData"],
  resolve: (url: string) => void,
): boolean {
  const url = job.output_data?.[OUTPUT_URL_KEY[outputKey]];

  if (!url) return false;

  // Only video jobs return thumbnailUrl from the backend
  const thumbnailUrl =
    outputKey === "generatedVideoUrl"
      ? (job.output_data?.thumbnailUrl as string | undefined)
      : undefined;

  const existingResults =
    ((
      useWorkflowStore
        .getState()
        .nodes.find((n) => n.id === nodeId)?.data as Record<string, unknown>
    )?.generatedResults as readonly GeneratedResult[] | undefined) ?? [];

  const extraFields =
    extraOutputFields && job.output_data
      ? extraOutputFields(job.output_data as Record<string, unknown>)
      : {};

  const urlsKey = OUTPUT_URLS_KEY[outputKey];
  const allUrlsRaw = urlsKey ? job.output_data?.[urlsKey] : undefined;
  const variantUrls = Array.isArray(allUrlsRaw)
    ? (allUrlsRaw.filter((u) => typeof u === "string" && u.length > 0) as string[])
    : [];

  const newResults: GeneratedResult[] =
    variantUrls.length > 1
      ? buildVariantResults(variantUrls, jobId, { thumbnailUrl, extraFields })
      : [{ url: url as string, thumbnailUrl, timestamp: new Date().toISOString(), jobId, ...extraFields }];

  updateNodeData(nodeId, {
    executionStatus: "completed",
    [outputKey]: url,
    generatedResults: [...newResults, ...existingResults],
    activeResultIndex: 0,
    currentJobId: undefined,
    currentJobProgress: undefined,
    ...extraFields,
  });
  guardedToast.success(`${label} complete`);
  resolve(url as string);
  return true;
}

/**
 * Generic poll-based node executor. Starts an API call, polls until
 * completed/failed, and updates the node in the store.
 */
export function pollJobWithNodeUpdate(
  nodeId: string,
  apiCall: () => Promise<{ jobId: string }>,
  outputKey: OutputKey,
  label: string,
  ctx: ExecutionContext,
  extraOutputFields?: (
    outputData: Record<string, unknown>,
  ) => Record<string, unknown>,
  estimatedMs?: number,
): Promise<string> {
  const { updateNodeData } = useWorkflowStore.getState();
  updateNodeData(nodeId, {
    executionStatus: "running",
    [outputKey]: undefined,
    currentJobId: undefined,
    currentJobProgress: 0,
  });

  return new Promise<string>((resolve, reject) => {
    apiCall()
      .then(async ({ jobId }) => {
        guardedToast.info(`${label} started`, { description: `Job ID: ${jobId}` });
        updateNodeData(nodeId, { currentJobId: jobId });

        // Auto-fetch estimate for smooth progress if not provided
        let resolvedEstimate = estimatedMs;
        if (!resolvedEstimate) {
          try {
            const nodeData = (useWorkflowStore.getState().nodes.find(n => n.id === nodeId)?.data ?? {}) as Record<string, unknown>;
            const model = (nodeData.provider as string) ??
              (nodeData.ttsModel as string) ??
              (nodeData.llmModel as string) ??
              label.toLowerCase();
            if (model) {
              const est = await getExecutionEstimate(
                model,
                (nodeData.aspect_ratio as string) ?? (nodeData.aspectRatio as string),
                (nodeData.resolution as string) ?? (nodeData.quality as string),
                Number(nodeData.duration) || undefined,
              );
              resolvedEstimate = est.estimatedMs;
            }
          } catch { /* use raw progress if estimate fetch fails */ }
        }

        // Start timing AFTER job creation + estimate fetch, not before
        const pollStartTime = Date.now();
        let pollFailures = 0;
        const poll = ctx.trackInterval(
          setInterval(async () => {
            if (ctx.isWorkflowStale()) {
              ctx.untrackInterval(poll);
              reject(new WorkflowStaleError());
              return;
            }
            try {
              const job = await getJobStatusLean(jobId);
              pollFailures = 0;

              if (job.status === "processing") {
                if (resolvedEstimate && resolvedEstimate > 0) {
                  const elapsed = Date.now() - pollStartTime;
                  const simulated = calculateProgress(elapsed, resolvedEstimate);
                  const real = job.progress ?? 0;
                  const next = Math.max(simulated, real);
                  updateProgressIfChanged(nodeId, next, updateNodeData);
                } else if (job.progress != null) {
                  updateProgressIfChanged(nodeId, job.progress, updateNodeData);
                }
              }

              if (job.status === "completed" || job.status === "failed") {
                if (shouldAbandonNode(nodeId, jobId)) {
                  // Run was discarded or replaced — the job still lands in My
                  // Library, but we must not write its result/error onto the
                  // canvas. Stop polling and resolve so the executor unwinds.
                  ctx.untrackInterval(poll);
                  resolve("");
                  return;
                }
              }

              if (job.status === "completed") {
                ctx.untrackInterval(poll);
                if (!handleJobCompleted(job, nodeId, jobId, outputKey, label, extraOutputFields, updateNodeData, resolve)) {
                  const errMsg = "No output URL returned from job";
                  updateNodeData(nodeId, {
                    executionStatus: "failed",
                    errorMessage: errMsg,
                    currentJobId: undefined,
                    currentJobProgress: undefined,
                  });
                  guardedToast.error(`${label} failed`, { description: errMsg });
                  reject(new Error(errMsg));
                }
              } else if (job.status === "failed") {
                ctx.untrackInterval(poll);
                const errMsg = job.error_message ?? "Unknown error";
                updateNodeData(nodeId, {
                  executionStatus: "failed",
                  errorMessage: errMsg,
                  currentJobId: undefined,
                  currentJobProgress: undefined,
                });
                guardedToast.error(`${label} failed`, { description: errMsg });
                reject(new Error(errMsg));
              }
            } catch (err) {
              pollFailures++;
              if (pollFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
                ctx.untrackInterval(poll);
                if (shouldAbandonNode(nodeId, jobId)) {
                  // Run discarded/replaced — don't write a failure onto the
                  // canvas; the job still lands in My Library.
                  resolve("");
                  return;
                }
                // Final verification: the job may have completed while polling was failing
                try {
                  const job = await getJobStatusLean(jobId);
                  // Re-check after the await: a discard/replace may have landed
                  // while this final status request was in flight. Never write a
                  // terminal result for a job the node no longer points at.
                  if (shouldAbandonNode(nodeId, jobId)) {
                    resolve("");
                    return;
                  }
                  if (job.status === "completed") {
                    if (handleJobCompleted(job, nodeId, jobId, outputKey, label, extraOutputFields, updateNodeData, resolve)) {
                      return;
                    }
                  }
                } catch { /* final check also failed */ }
                updateNodeData(nodeId, {
                  executionStatus: "failed",
                  currentJobId: undefined,
                  currentJobProgress: undefined,
                });
                guardedToast.error(`Failed to check ${label} status`);
                reject(err);
              }
            }
          }, 2000),
        );
      })
      .catch((err) => {
        updateNodeData(nodeId, {
          executionStatus: "failed",
          currentJobId: undefined,
          currentJobProgress: undefined,
        });
        if (!checkStorageError(err, ctx)) {
          guardedToast.error(`Failed to start ${label}`, {
            description: err instanceof Error ? err.message : "Unknown error",
          });
        }
        reject(err);
      });
  });
}
