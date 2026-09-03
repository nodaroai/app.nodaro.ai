import { toast } from "sonner";
import { useWorkflowStore } from "@/hooks/use-workflow-store";
import { getJobStatusLean, getExecutionEstimate, cancelJob } from "@/lib/api";
import { calculateProgress } from "@nodaro/shared"
import type { GeneratedResult } from "@/types/nodes";
import { buildVariantResults } from "./variant-results";
import { sunoVariantFields } from "@/lib/suno-ids";
import { shouldAbandonNode } from "./abandon-guard";
import { isInputWarningCode } from "@/lib/input-warning-codes";
import { tx } from "@/lib/i18n";
import {
  WorkflowStaleError,
  MAX_CONSECUTIVE_POLL_FAILURES,
  checkStorageError,
  updateProgressIfChanged,
  updateRecoveringIfChanged,
  updateAwaitingReviewIfChanged,
  type ExecutionContext,
} from "./types";

/**
 * `getJobStatusLean` plus the ONE side effect every node-owning poll loop
 * needs: keep `data.jobAwaitingReview` in sync with the row, so a job parked in
 * `pending_review` paints BaseNode's "Awaiting review" overlay instead of a
 * bare, unexplained spinner.
 *
 * It exists because the flag is READ centrally (one `<NodePolicyOverlay>`
 * mounted by BaseNode) but must be WRITTEN by ~21 independent poll loops in six
 * files — and `jobRecovering` proved that "each loop remembers to do it" does
 * not survive contact with this codebase (1 of 98 call sites remembered).
 * `__tests__/poll-job-wrapper.test.ts` fails the build on loop #22 — and on any
 * raw read whose call site does not carry a `raw-status-ok` marker comment
 * naming the reason it owns no node.
 *
 * Clearing on a non-held tick is also half of the stale-overlay fix; the other
 * half is `jobAwaitingReview: undefined` on every terminal patch, plus the
 * overlay's own `executionStatus === "running"` gate.
 */
export async function getJobStatusLeanForNode(jobId: string, nodeId: string) {
  const job = await getJobStatusLean(jobId); // raw-status-ok: this IS the wrapper
  const { updateNodeData } = useWorkflowStore.getState();
  updateAwaitingReviewIfChanged(nodeId, job.status === "pending_review", updateNodeData);
  return job;
}

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
  warning: (...args: Parameters<typeof toast.warning>) => { if (!_suppressToasts) toast.warning(...args); },
};

export type OutputKey = "generatedVideoUrl" | "generatedAudioUrl" | "generatedImageUrl";

/**
 * A single key, or an ORDERED list of acceptable keys ("media-typed
 * completion"): the poller resets every listed key on start and, on
 * completion, writes the FIRST key the job actually produced.
 *
 * voice-changer-pro with a video input wired can legitimately deliver AUDIO —
 * the backend decides audio-vs-video from the media's real streams (an
 * audio-only .mp4 has no video to remux onto) — so it polls with
 * ["generatedVideoUrl", "generatedAudioUrl"]. With a single static key the
 * poller failed such a completed job with "No output URL returned".
 */
export type OutputKeySpec = OutputKey | readonly OutputKey[];

function outputKeyList(spec: OutputKeySpec): readonly OutputKey[] {
  return typeof spec === "string" ? [spec] : spec;
}

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

/**
 * The keys EVERY run-start patch must write, so nothing from the previous run
 * is painted over this one. `updateNodeData` is a shallow merge, so an omitted
 * key SURVIVES — and with the policy overlay in play that is not cosmetic: a
 * stale `errorHint.kind === "policy-block"` makes <NodePolicyOverlay> paint an
 * opaque "Blocked by content policy: <the OLD reason>" panel over this run's
 * real, unrelated failure, while the node cards suppress their own failed block
 * in favour of an empty amber spacer. The user then sees run 1's block text and
 * no trace of run 2's actual error.
 *
 * Exported so the other run-start patches spread ONE object instead of each
 * remembering the list. All 37 of them now do — execute-node.ts's 27 (20 of
 * which used to clear `errorMessage` and nothing else, 7 of which cleared
 * nothing at all), plus asset-executors, node-executors, component-executor,
 * list-execution and sub-workflow-executor. `__tests__/run-start-reset.test.ts`
 * fails the build on the 38th, and on any key dropped from this object.
 */
export const RUN_START_RESET = {
  executionStatus: "running",
  errorMessage: undefined,
  errorHint: undefined,
  currentJobId: undefined,
  currentJobProgress: 0,
  // Re-running after a hold must not flash the previous run's overlay.
  jobAwaitingReview: undefined,
} as const;

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
          // Owns no node: it RESOLVES a URL to a caller that paints
          // (asset-executors' sheet/reference loops), so there is no nodeId
          // here to write the hold flag onto.
          const job = await getJobStatusLean(jobId); // raw-status-ok: resolves a URL, owns no node
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
              const finalJob = await getJobStatusLean(jobId);
              if (finalJob.status === "completed") {
                resolve(finalJob.output_data?.imageUrl ?? "");
                return;
              }
              if (finalJob.status === "failed") {
                reject(new Error(finalJob.error_message ?? "Failed"));
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
 * Build the canonical single-URL `GeneratedResult` object. Extracted so the
 * DAG completion path and the in-component refine poller (`pollImageRefineToNode`)
 * produce byte-identical version objects — no drift between the two paths.
 */
function buildSingleResult(
  url: string,
  jobId: string,
  extra?: { thumbnailUrl?: string; extraFields?: Record<string, unknown> },
): GeneratedResult {
  return {
    url,
    thumbnailUrl: extra?.thumbnailUrl,
    timestamp: new Date().toISOString(),
    jobId,
    ...(extra?.extraFields ?? {}),
  };
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
  outputKeySpec: OutputKeySpec,
  label: string,
  extraOutputFields: ((od: Record<string, unknown>) => Record<string, unknown>) | undefined,
  updateNodeData: ReturnType<typeof useWorkflowStore.getState>["updateNodeData"],
  resolve: (url: string) => void,
): boolean {
  // Media-typed completion: the first listed key the job actually produced.
  const outputKey = outputKeyList(outputKeySpec).find(
    (k) => Boolean(job.output_data?.[OUTPUT_URL_KEY[k]]),
  );
  if (!outputKey) return false;
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
      ? buildVariantResults(variantUrls, jobId, {
          thumbnailUrl,
          extraFields,
          // Each Suno track carries its OWN id (#819).
          perVariantFields: sunoVariantFields(job.output_data as Record<string, unknown> | undefined),
        })
      : [buildSingleResult(url as string, jobId, { thumbnailUrl, extraFields })];

  updateNodeData(nodeId, {
    executionStatus: "completed",
    [outputKey]: url,
    generatedResults: [...newResults, ...existingResults],
    activeResultIndex: 0,
    currentJobId: undefined,
    currentJobProgress: undefined,
    // An APPROVE goes pending_review -> completed with no intervening poll
    // tick, so this is the only place the hold flag gets cleared on the happy
    // path. Without it the overlay would paint over the delivered result.
    jobAwaitingReview: undefined,
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
  outputKey: OutputKeySpec,
  label: string,
  ctx: ExecutionContext,
  extraOutputFields?: (
    outputData: Record<string, unknown>,
  ) => Record<string, unknown>,
  estimatedMs?: number,
): Promise<string> {
  const { updateNodeData } = useWorkflowStore.getState();
  updateNodeData(nodeId, {
    ...RUN_START_RESET,
    // Every listed key is reset — a stale video result must not survive into
    // a run that ends up delivering audio (or vice versa).
    ...Object.fromEntries(outputKeyList(outputKey).map((k) => [k, undefined])),
  });

  return new Promise<string>((resolve, reject) => {
    apiCall()
      .then(async ({ jobId }) => {
        if (ctx.signal?.aborted) {
          // Run was discarded/aborted while the create-job request was in
          // flight. Don't re-attach currentJobId or start polling — that would
          // defeat the discard and paint the result over the existing one.
          // Cancel phase-aware (pre-call cancels+refunds; in-flight finishes →
          // My Library), then bail. This is a `new Promise`, so unwind by
          // resolving "" — mirroring the shouldAbandonNode abandon-branch below.
          cancelJob(jobId).catch(() => {});
          resolve("");
          return;
        }
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
              // The wrapper keeps `jobAwaitingReview` in sync on every tick —
              // one mechanism for this loop and the other 18. `pending_review`
              // is IN-FLIGHT, so the loop keeps polling and the job completes
              // normally the moment a reviewer approves it.
              const job = await getJobStatusLeanForNode(jobId, nodeId);
              pollFailures = 0;

              if (job.status === "processing") {
                // Self-heal visibility: surface "Recovering" instead of a
                // silently stuck bar (node components pass data.jobRecovering
                // into <NodeJobProgress recovering>).
                updateRecoveringIfChanged(nodeId, job.recovering === true, updateNodeData);
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
                    // Defensive: this is a different failure than any prior
                    // safety-block, so a stale hint must not survive onto it.
                    errorHint: undefined,
                    currentJobId: undefined,
                    currentJobProgress: undefined,
                    jobAwaitingReview: undefined,
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
                  // Structured safety-block detail (kind/class/retried/suggestedProvider),
                  // when the backend attached one — the editor's one-click fallback
                  // (e.g. "Try on Nano Banana Pro") reads this. `?? undefined` clears
                  // any hint left over from a previous, unrelated failure.
                  errorHint: job.error_hint ?? undefined,
                  currentJobId: undefined,
                  currentJobProgress: undefined,
                  // A REJECTED hold arrives here: pending_review -> failed. The
                  // hold flag must go with it, or the amber "awaiting review"
                  // chrome would sit on top of the block explanation.
                  jobAwaitingReview: undefined,
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
                  const finalJob = await getJobStatusLean(jobId);
                  // Re-check after the await: a discard/replace may have landed
                  // while this final status request was in flight. Never write a
                  // terminal result for a job the node no longer points at.
                  if (shouldAbandonNode(nodeId, jobId)) {
                    resolve("");
                    return;
                  }
                  if (finalJob.status === "completed") {
                    if (handleJobCompleted(finalJob, nodeId, jobId, outputKey, label, extraOutputFields, updateNodeData, resolve)) {
                      return;
                    }
                  }
                } catch { /* final check also failed */ }
                updateNodeData(nodeId, {
                  executionStatus: "failed",
                  // Defence in depth beside the run-start reset: giving up is a
                  // different failure than any earlier policy block.
                  errorHint: undefined,
                  currentJobId: undefined,
                  currentJobProgress: undefined,
                  jobAwaitingReview: undefined,
                });
                guardedToast.error(`Failed to check ${label} status`);
                reject(err);
              }
            }
          }, 2000),
        );
      })
      .catch((err) => {
        // A user-fixable input problem (source too long / too large) is a WARNING,
        // not a system error: surface it in orange + keep the message on the node,
        // so "trim your clip and retry" reads as guidance rather than a crash.
        const code = (err as { code?: unknown })?.code;
        const isWarning = isInputWarningCode(code);
        // A REQUEST-gate policy block never creates a job, so there is no row
        // and no `jobs.error_hint` — the API rejects with 422 `job_blocked`.
        // Synthesize the SAME hint shape the result gate writes, so ONE overlay
        // renders both hook points. `err.code` is verified to survive on both
        // transports (packages/client/src/errors.ts, lib/api.ts's
        // `Object.assign(new Error(msg), { code })`), so no plumbing is needed.
        //
        // Deliberately NOT added to INPUT_WARNING_CODES: that set means "the
        // user can fix their input", it drives a SwitchX preflight, and it is
        // pinned by its route's own test. A policy block is a different thing.
        const isPolicyBlock = code === "job_blocked";
        const msg = err instanceof Error ? err.message : "Unknown error";
        updateNodeData(nodeId, {
          executionStatus: "failed",
          currentJobId: undefined,
          currentJobProgress: undefined,
          jobAwaitingReview: undefined,
          // Written on EVERY arm, not just the policy one: a start failure that
          // carries no hint of its own must CLEAR the last run's, or the
          // overlay paints that block over this unrelated error.
          errorHint: isPolicyBlock
            ? { kind: "policy-block", policyId: "", reason: msg, hookPoint: "request" }
            : undefined,
          ...(isPolicyBlock
            ? { errorMessage: msg }
            : isWarning
              ? { errorMessage: msg, errorCode: code }
              : {}),
        });
        if (!checkStorageError(err, ctx)) {
          if (isPolicyBlock) {
            guardedToast.warning(tx("run.jobBlocked", { label }));
          } else if (isWarning) {
            guardedToast.warning(msg);
          } else {
            guardedToast.error(`Failed to start ${label}`, { description: msg });
          }
        }
        reject(err);
      });
  });
}

/**
 * Self-contained image-job poller for in-component "refine" actions (the
 * reference-board refine bar: global / masked edits + re-roll).
 *
 * Unlike `pollJobWithNodeUpdate`, this does NOT need an `ExecutionContext` —
 * it owns a plain `setInterval` and writes directly to the workflow store. It
 * starts an image API call (image-to-image or reference-board generation),
 * polls to completion, and **prepends** a new version to `generatedResults`
 * with `activeResultIndex: 0`, exactly like the DAG completion path
 * (`handleJobCompleted` → `buildSingleResult`), so refined versions land in the
 * board's version strip identically.
 *
 * Resolves with the new image URL on success, or "" if it was abandoned;
 * rejects on failure (the node already shows the failed state via the store).
 */
export function pollImageRefineToNode(
  nodeId: string,
  apiCall: () => Promise<{ jobId: string }>,
  label: string,
): Promise<string> {
  const { updateNodeData } = useWorkflowStore.getState();
  updateNodeData(nodeId, { ...RUN_START_RESET });

  return new Promise<string>((resolve, reject) => {
    apiCall()
      .then(({ jobId }) => {
        guardedToast.info(`${label} started`, { description: `Job ID: ${jobId}` });
        updateNodeData(nodeId, { currentJobId: jobId });

        let pollFailures = 0;

        const poll = setInterval(async () => {
          try {
            // Through the wrapper like every other node-owning loop: a refine
            // job is single-node + finalize-funnel, so it IS hold-eligible, and
            // without this a held refine spins with no explanation for hours
            // (`pending_review` matches none of the branches below).
            const job = await getJobStatusLeanForNode(jobId, nodeId);
            pollFailures = 0;

            if (job.status === "processing" && job.progress != null) {
              updateProgressIfChanged(nodeId, job.progress, updateNodeData);
              return;
            }

            if (job.status === "completed") {
              clearInterval(poll);
              const url = job.output_data?.imageUrl as string | undefined;
              if (!url) {
                const errMsg = "No output URL returned from job";
                updateNodeData(nodeId, {
                  executionStatus: "failed",
                  errorMessage: errMsg,
                  errorHint: undefined,
                  currentJobId: undefined,
                  currentJobProgress: undefined,
                  jobAwaitingReview: undefined,
                });
                guardedToast.error(`${label} failed`, { description: errMsg });
                reject(new Error(errMsg));
                return;
              }
              const existing =
                ((useWorkflowStore.getState().nodes.find((n) => n.id === nodeId)?.data as
                  Record<string, unknown>)?.generatedResults as
                  readonly GeneratedResult[] | undefined) ?? [];
              // Carry the provider task id per-result (and node-level) so
              // grok task-chained ops can keep chaining off a refined result.
              const kieTaskId =
                typeof job.output_data?.kieTaskId === "string"
                  ? job.output_data.kieTaskId
                  : undefined;
              updateNodeData(nodeId, {
                executionStatus: "completed",
                generatedImageUrl: url,
                generatedResults: [
                  buildSingleResult(url, jobId, kieTaskId ? { extraFields: { kieTaskId } } : undefined),
                  ...existing,
                ],
                activeResultIndex: 0,
                currentJobId: undefined,
                currentJobProgress: undefined,
                // An APPROVE goes pending_review -> completed with no
                // intervening tick, so this is the only place the hold flag
                // gets cleared on the happy path.
                jobAwaitingReview: undefined,
                ...(kieTaskId ? { kieTaskId } : {}),
              });
              guardedToast.success(`${label} complete`);
              resolve(url);
              return;
            }

            if (job.status === "failed") {
              clearInterval(poll);
              const errMsg = job.error_message ?? "Unknown error";
              updateNodeData(nodeId, {
                executionStatus: "failed",
                errorMessage: errMsg,
                // A result-gate BLOCK or a reviewer REJECT arrives here with the
                // row's own hint; carrying it renders the policy overlay instead
                // of a generic red failure. `?? undefined` clears a stale one.
                errorHint: job.error_hint ?? undefined,
                currentJobId: undefined,
                currentJobProgress: undefined,
                // A REJECTED hold is pending_review -> failed: the amber chrome
                // must not sit on top of the block explanation.
                jobAwaitingReview: undefined,
              });
              guardedToast.error(`${label} failed`, { description: errMsg });
              reject(new Error(errMsg));
            }
          } catch (err) {
            pollFailures++;
            if (pollFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
              clearInterval(poll);
              updateNodeData(nodeId, {
                executionStatus: "failed",
                errorHint: undefined,
                currentJobId: undefined,
                currentJobProgress: undefined,
                jobAwaitingReview: undefined,
              });
              guardedToast.error(`Failed to check ${label} status`);
              reject(err);
            }
          }
        }, 2000);
      })
      .catch((err) => {
        // Same branch as pollJobWithNodeUpdate: a REQUEST-gate block answers 422
        // `job_blocked` and creates no job row, so there is no `jobs.error_hint`
        // to read — synthesize the same shape, and warn rather than shouting a
        // red "Failed to start" at the user for OUR policy decision.
        const isPolicyBlock = (err as { code?: unknown })?.code === "job_blocked";
        const msg = err instanceof Error ? err.message : "Unknown error";
        updateNodeData(nodeId, {
          executionStatus: "failed",
          // The message is written on BOTH arms: without it an ordinary start
          // failure leaves the card blank (or, worse, carrying the last run's).
          errorMessage: msg,
          errorHint: isPolicyBlock
            ? { kind: "policy-block", policyId: "", reason: msg, hookPoint: "request" }
            : undefined,
          currentJobId: undefined,
          currentJobProgress: undefined,
          jobAwaitingReview: undefined,
        });
        if (isPolicyBlock) {
          guardedToast.warning(tx("run.jobBlocked", { label }));
        } else {
          guardedToast.error(`Failed to start ${label}`, { description: msg });
        }
        reject(err);
      });
  });
}
