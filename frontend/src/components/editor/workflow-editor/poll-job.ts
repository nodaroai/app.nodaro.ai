import { toast } from "sonner";
import { useWorkflowStore } from "@/hooks/use-workflow-store";
import { getJobStatus } from "@/lib/api";
import type { GeneratedResult } from "@/types/nodes";
import {
  WorkflowStaleError,
  MAX_CONSECUTIVE_POLL_FAILURES,
  checkStorageError,
  type ExecutionContext,
} from "./types";

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
          const job = await getJobStatus(jobId);
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
              const job = await getJobStatus(jobId);
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
 * Generic poll-based node executor. Starts an API call, polls until
 * completed/failed, and updates the node in the store.
 */
export function pollJobWithNodeUpdate(
  nodeId: string,
  apiCall: () => Promise<{ jobId: string }>,
  outputKey: "generatedVideoUrl" | "generatedAudioUrl",
  label: string,
  ctx: ExecutionContext,
  extraOutputFields?: (
    outputData: Record<string, unknown>,
  ) => Record<string, unknown>,
): Promise<void> {
  const { updateNodeData } = useWorkflowStore.getState();
  updateNodeData(nodeId, {
    executionStatus: "running",
    [outputKey]: undefined,
    currentJobId: undefined,
    currentJobProgress: 0,
  });

  return new Promise((resolve, reject) => {
    apiCall()
      .then(({ jobId }) => {
        toast.info(`${label} started`, { description: `Job ID: ${jobId}` });
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
              const job = await getJobStatus(jobId);
              pollFailures = 0;

              if (job.status === "processing" && job.progress != null) {
                updateNodeData(nodeId, { currentJobProgress: job.progress });
              }

              if (job.status === "completed") {
                ctx.untrackInterval(poll);
                const url =
                  outputKey === "generatedVideoUrl"
                    ? job.output_data?.videoUrl
                    : job.output_data?.audioUrl;

                if (!url) {
                  const errMsg = "No output URL returned from job";
                  updateNodeData(nodeId, {
                    executionStatus: "failed",
                    errorMessage: errMsg,
                    currentJobId: undefined,
                    currentJobProgress: undefined,
                  });
                  toast.error(`${label} failed`, { description: errMsg });
                  reject(new Error(errMsg));
                  return;
                }

                const thumbnailUrl =
                  outputKey === "generatedVideoUrl"
                    ? (job.output_data?.thumbnailUrl as string | undefined)
                    : undefined;

                const existingResults =
                  ((
                    useWorkflowStore
                      .getState()
                      .nodes.find((n) => n.id === nodeId)?.data as Record<
                      string,
                      unknown
                    >
                  )?.generatedResults as
                    | readonly GeneratedResult[]
                    | undefined) ?? [];
                const newResult: GeneratedResult = {
                  url: url as string,
                  thumbnailUrl,
                  timestamp: new Date().toISOString(),
                  jobId,
                };
                const extraFields =
                  extraOutputFields && job.output_data
                    ? extraOutputFields(
                        job.output_data as Record<string, unknown>,
                      )
                    : {};
                updateNodeData(nodeId, {
                  executionStatus: "completed",
                  [outputKey]: url,
                  generatedResults: [newResult, ...existingResults],
                  activeResultIndex: 0,
                  currentJobId: undefined,
                  currentJobProgress: undefined,
                  ...extraFields,
                });
                toast.success(`${label} complete`);
                resolve();
              } else if (job.status === "failed") {
                ctx.untrackInterval(poll);
                const errMsg = job.error_message ?? "Unknown error";
                updateNodeData(nodeId, {
                  executionStatus: "failed",
                  errorMessage: errMsg,
                  currentJobId: undefined,
                  currentJobProgress: undefined,
                });
                toast.error(`${label} failed`, { description: errMsg });
                reject(new Error(errMsg));
              }
            } catch (err) {
              pollFailures++;
              if (pollFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
                ctx.untrackInterval(poll);
                // Final verification: the job may have completed while polling was failing
                try {
                  const job = await getJobStatus(jobId);
                  if (job.status === "completed") {
                    const url =
                      outputKey === "generatedVideoUrl"
                        ? job.output_data?.videoUrl
                        : job.output_data?.audioUrl;
                    if (url) {
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
                      const newResult: GeneratedResult = {
                        url: url as string,
                        thumbnailUrl,
                        timestamp: new Date().toISOString(),
                        jobId,
                      };
                      const extraFields =
                        extraOutputFields && job.output_data
                          ? extraOutputFields(job.output_data as Record<string, unknown>)
                          : {};
                      updateNodeData(nodeId, {
                        executionStatus: "completed",
                        [outputKey]: url,
                        generatedResults: [newResult, ...existingResults],
                        activeResultIndex: 0,
                        currentJobId: undefined,
                        currentJobProgress: undefined,
                        ...extraFields,
                      });
                      toast.success(`${label} complete`);
                      resolve();
                      return;
                    }
                  }
                } catch { /* final check also failed */ }
                updateNodeData(nodeId, {
                  executionStatus: "failed",
                  currentJobId: undefined,
                  currentJobProgress: undefined,
                });
                toast.error(`Failed to check ${label} status`);
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
          toast.error(`Failed to start ${label}`, {
            description: err instanceof Error ? err.message : "Unknown error",
          });
        }
        reject(err);
      });
  });
}
