import { tx, type MessageKey } from "@/lib/i18n"
import type { EditPlanSourceIssue } from "@nodaro/shared"

/**
 * `Node "<label>": <message>` in the interface language — the one shape every
 * pre-run check of the node executors reports in.
 */
export function nodeRunText(label: string | undefined, message: string): string {
  return tx("nodeRun.nodeMessage", { label: label ?? "", message })
}

/** {@link nodeRunText} with the message from the dictionary. */
export function nodeRunError(
  label: string | undefined,
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  return nodeRunText(label, tx(key, vars))
}

/**
 * One edit-plan pre-run issue (B4: `resolveEditPlanSources`) in the interface
 * language. The shared `describeAudioSyncOffsetIssue` phrases the same issues
 * in English for the API, MCP and the server engine.
 */
export function editPlanIssueText(issue: EditPlanSourceIssue, labelOf: (sourceId: string) => string): string {
  switch (issue.code) {
    case "not-audio-sync":
      return tx("nodeRun.editPlanNoSyncResult")
    case "invalid-offset":
      return tx("nodeRun.editPlanInvalidOffset", { source: labelOf(issue.sourceId) })
    case "anchor-offset":
      return tx("nodeRun.editPlanMasterOffset", { source: labelOf(issue.sourceId), offset: issue.offsetMs })
    case "anchor-unmeasured":
      return tx("nodeRun.editPlanMasterUnmeasured", { source: labelOf(issue.sourceId) })
    case "weak-match":
      return issue.anchor
        ? tx("nodeRun.editPlanWeakMaster", { source: labelOf(issue.sourceId), confidence: issue.confidence })
        : tx("nodeRun.editPlanWeakMatch", { source: labelOf(issue.sourceId), confidence: issue.confidence })
    case "unmeasured":
      return tx("nodeRun.editPlanUnmeasured", { source: labelOf(issue.sourceId) })
    case "transcript-off-clock":
      return tx("nodeRun.editPlanTranscriptOffClock", { source: labelOf(issue.sourceId), master: labelOf(issue.masterId), offset: issue.offsetMs })
  }
}
