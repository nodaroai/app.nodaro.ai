import type { UnitJsonLanding } from "@/lib/unit-compose";
import { tx } from "@/lib/i18n";
import { localizeJobLabel } from "./job-label";

/**
 * The JSON completion of `pollJobWithNodeUpdate` (poll-job.ts): a job whose
 * result is JSON (a worker node unit's look outputs, `runJsonNode`) lands its
 * landing's patch on the node, never a media take.
 */

/** The message a JSON job that wrote no result fails its node with. */
export const JSON_JOB_NO_RESULT = "The job returned no result";

/** Every field a JSON landing writes, emptied when a run starts (none without a landing). */
export function jsonLandingReset(landing: UnitJsonLanding | undefined): Record<string, undefined> {
  return Object.fromEntries((landing?.fields ?? []).map((k) => [k, undefined]));
}

/** What the JSON completion writes through: the store's node update, the run's promise, the (suppressible) success toast. */
export interface JsonCompletionSink {
  readonly nodeId: string;
  readonly label: string;
  readonly updateNodeData: (nodeId: string, patch: Record<string, unknown>) => void;
  readonly resolve: (result: string) => void;
  readonly success: (message: string) => void;
}

/**
 * A completed job's JSON result on its node: the landing's patch with the run
 * finished, the success toast, and the run resolved with the first output as
 * a wire carries it. False when the job wrote no result (the caller fails the node).
 */
export function handleJsonJobCompleted(
  outputData: Record<string, unknown> | null | undefined,
  landing: UnitJsonLanding,
  sink: JsonCompletionSink,
): boolean {
  const landed = landing.land(outputData ?? {});
  if (!landed) return false;
  sink.updateNodeData(sink.nodeId, {
    executionStatus: "completed",
    ...landed.patch,
    currentJobId: undefined,
    currentJobProgress: undefined,
    jobAwaitingReview: undefined,
  });
  sink.success(tx("nodeRun.complete", { label: localizeJobLabel(sink.label) }));
  sink.resolve(landed.result);
  return true;
}
