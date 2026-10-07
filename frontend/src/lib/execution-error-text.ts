/**
 * An execution's `error_message`, as a person reads it.
 *
 * A refusal the server records with a STABLE CODE as its message (clients
 * branch on the code, never on text) is shown in the reader's language; any
 * other message passes through unchanged.
 */
import {
  CONTINUATION_NOT_COMPLETED,
  CONTINUATION_NOT_FOUND,
  CONTINUATION_SUBSET_REQUIRED,
  CONTINUATION_VERSION_MISMATCH,
  CONTINUATION_WORKFLOW_MISMATCH,
  PREVIEW_RENDER_NESTED,
  PREVIEW_REVIEW_REQUIRED,
} from "@nodaro/shared"
import { tx, type MessageKey } from "@/lib/i18n"

const CODE_TEXT: Readonly<Record<string, MessageKey>> = {
  // A run nobody can review holds a Preview render (decided 2026-10-04).
  [PREVIEW_REVIEW_REQUIRED]: "previewGate.headlessRefusal",
  // A sub-workflow or component holds one.
  [PREVIEW_RENDER_NESTED]: "previewGate.nestedRefusal",
  // A run continued from an earlier execution (`continueFromExecutionId`)
  // that the server refused before any node ran.
  [CONTINUATION_SUBSET_REQUIRED]: "runContinuation.subsetRequired",
  [CONTINUATION_NOT_FOUND]: "runContinuation.notFound",
  [CONTINUATION_WORKFLOW_MISMATCH]: "runContinuation.workflowMismatch",
  [CONTINUATION_VERSION_MISMATCH]: "runContinuation.versionMismatch",
  [CONTINUATION_NOT_COMPLETED]: "runContinuation.notCompleted",
}

export function executionErrorText(message: string | null | undefined): string | null {
  if (!message) return null
  const key = CODE_TEXT[message]
  return key ? tx(key) : message
}
