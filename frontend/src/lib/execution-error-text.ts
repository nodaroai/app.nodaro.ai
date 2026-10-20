/**
 * An execution's `error_message`, as a person reads it.
 *
 * A refusal the server records with a STABLE CODE as its message (clients
 * branch on the code, never on text) is shown in the reader's language; any
 * other message passes through unchanged.
 */
import {
  RENDER_FINAL_ALREADY_RENDERED,
  USE_CASE_NOTHING_KEPT,
  REVIEW_HOLDING_USE_CASE_TYPES,
  CONTINUATION_NOT_COMPLETED,
  CONTINUATION_SETTLING,
  CONTINUATION_NOT_FAILED,
  CONTINUATION_NOT_FOUND,
  CONTINUATION_PREVIEW_PENDING,
  CONTINUATION_SUBSET_REQUIRED,
  CONTINUATION_SUPERSEDED,
  CONTINUATION_VERSION_MISMATCH,
  CONTINUATION_WORKFLOW_MISMATCH,
  PREVIEW_RENDER_NESTED,
  PREVIEW_REVIEW_REQUIRED,
} from "@nodaro/shared/nodes"
import {
  UGC_PICK_FIRST_MESSAGE,
} from "@nodaro/shared/ugc"
import {
  USE_CASE_LIST_DRIVEN,
  USE_CASE_NODE_TYPES,
  USE_CASE_REVIEW_LIST_DRIVEN,
  USE_CASE_REVIEW_LIST_DRIVEN_MESSAGE,
  isUseCaseNodeType,
  parseClipPackNoneRendered,
  previewRefusalOfCode,
  usecaseCancelledMessage,
  usecaseDescriptor,
  usecaseListDrivenMessage,
  usecaseListDrivenMessageOf,
  usecaseListsItsResult,
  type UseCaseNodeType,
} from "@nodaro/render-rules"
import { usecaseLabelVars, usecaseListDrivenKey } from "@/lib/use-case-request-body"
import { tx, type MessageKey } from "@/lib/i18n"
import { USE_CASE_RECORDINGS_REASON_KEYS } from "@/lib/use-case-recordings-copy"
import { previewRefusalText } from "@/lib/preview-refusal-text"

/** The continue route's code for a Render final of a run that made no Preview (backend render-final-run.ts). */
const RENDER_FINAL_NOT_PREVIEW = "render_final_not_preview"
/** The continue route's code for a continuation (here: a Render final) already under way. */
const RENDER_FINAL_ALREADY_RUNNING = "already_running"

const CODE_TEXT: Readonly<Record<string, MessageKey>> = {
  // (A preview refusal's codes are read by `previewRefusalOfCode` below:
  // they carry what held the run.)
  // A run continued from an earlier execution (`continueFromExecutionId`)
  // that the server refused before any node ran.
  [CONTINUATION_SUBSET_REQUIRED]: "runContinuation.subsetRequired",
  [CONTINUATION_NOT_FOUND]: "runContinuation.notFound",
  [CONTINUATION_WORKFLOW_MISMATCH]: "runContinuation.workflowMismatch",
  [CONTINUATION_VERSION_MISMATCH]: "runContinuation.versionMismatch",
  [CONTINUATION_NOT_COMPLETED]: "runContinuation.notCompleted",
  [CONTINUATION_NOT_FAILED]: "runContinuation.notFailed",
  [CONTINUATION_SUPERSEDED]: "runContinuation.superseded",
  [CONTINUATION_PREVIEW_PENDING]: "runContinuation.previewPending",
  // A use-case continue (Tighten Episode) asked too soon after its run failed,
  // and a Render final of a run whose render made no Preview.
  [CONTINUATION_SETTLING]: "runContinuation.settling",
  [RENDER_FINAL_NOT_PREVIEW]: "apiErr.reason.renderFinalNotPreview",
  // A Render final of the very edit a completed final of the same preview
  // already rendered, and one asked while another of it is under way.
  [RENDER_FINAL_ALREADY_RENDERED]: "runContinuation.alreadyRendered",
  [RENDER_FINAL_ALREADY_RUNNING]: "runContinuation.finalInProgress",
  // A Render final of a clip set whose review dropped every clip: nothing to render.
  [USE_CASE_NOTHING_KEPT]: "runContinuation.nothingKept",
  // Not a code: the server refuses an editor run that would execute a UGC Creator still waiting
  // for a pick with this English sentence, word for word the editor's own refusal
  // (`run.ugcPickFirst`, pinned equal in ugc-nodes-locales.test.ts), so both read alike.
  [UGC_PICK_FIRST_MESSAGE]: "run.ugcPickFirst",
  // A review-on use-case node about to run once per list item, refused before
  // anything ran — as a run's or an app run's error (its code, and the
  // server's English sentence for it, word for word the editor's own).
  [USE_CASE_REVIEW_LIST_DRIVEN]: "nodeRun.tightenReviewListDriven",
  [USE_CASE_REVIEW_LIST_DRIVEN_MESSAGE]: "nodeRun.tightenReviewListDriven",
}

/**
 * A use-case node whose own result is a list (Trailer), fed by a list: the
 * server's English sentence names the node type, so each type's sentence is
 * known here and shown with the localized label.
 */
const LIST_DRIVEN_TYPE_BY_MESSAGE: ReadonlyMap<string, UseCaseNodeType> = new Map(
  USE_CASE_NODE_TYPES.filter((t) => usecaseListsItsResult(t)).flatMap((t) => [
    [usecaseListDrivenMessageOf(t), t] as const,
    // A refusal stored before the type took several recordings, in its words then.
    [usecaseListDrivenMessage(usecaseDescriptor(t).label), t] as const,
  ]),
)

/**
 * A use-case node whose run was cancelled, as the server's engine words it
 * (`usecaseCancelledMessage`, naming the node type): shown with the localized label.
 */
const CANCELLED_TYPE_BY_MESSAGE: ReadonlyMap<string, UseCaseNodeType> = new Map(
  USE_CASE_NODE_TYPES.map((t) => [usecaseCancelledMessage(usecaseDescriptor(t).label), t] as const),
)

/** A known code or sentence, in the reader's language; null for any other text. */
function knownText(message: string): string | null {
  const key = CODE_TEXT[message]
  if (key) return tx(key)
  const listDriven = LIST_DRIVEN_TYPE_BY_MESSAGE.get(message)
  if (listDriven) return tx(usecaseListDrivenKey(listDriven), usecaseLabelVars(listDriven))
  const cancelled = CANCELLED_TYPE_BY_MESSAGE.get(message)
  if (cancelled) return tx("nodeRun.usecaseCancelled", usecaseLabelVars(cancelled))
  // A clip set none of whose clips rendered: the count, and the render's own reason (itself localized when known).
  const noneRendered = parseClipPackNoneRendered(message)
  if (!noneRendered) return null
  const reason = knownText(noneRendered.reason) ?? noneRendered.reason
  return noneRendered.count === 1
    ? tx("nodeRun.clipPackOneNotRendered", { reason })
    : tx("nodeRun.clipPackNoneRendered", { count: noneRendered.count, reason })
}

export function executionErrorText(message: string | null | undefined): string | null {
  if (!message) return null
  // A preview refusal (decided 2026-10-04): a run nobody can review, or a
  // nested graph, held by a render at Preview, a review-on use-case node, or
  // both — its code says which, and the copy names that remedy. A render's
  // code (and every older row's) reads as it always has.
  const refusal = previewRefusalOfCode(message)
  if (refusal) return previewRefusalText(refusal.family, refusal.kind)
  return knownText(message) ?? nodeFailuresText(message) ?? message
}

/** How the server's engine words a run that stopped on failed nodes: `Node execution failed: <id>: <error>; …`. */
const NODE_FAILURES_PREFIX = "Node execution failed: "

/**
 * A run stopped by failed nodes, with each node's error that is a known code
 * or sentence (a list-driven review-on node's refusal) in the reader's
 * language; null when none is known, so every other run's text is untouched.
 */
function nodeFailuresText(message: string): string | null {
  if (!message.startsWith(NODE_FAILURES_PREFIX)) return null
  let known = false
  const parts = message.slice(NODE_FAILURES_PREFIX.length).split("; ").map((part) => {
    const at = part.indexOf(": ")
    const text = at > 0 ? knownText(part.slice(at + 2)) : null
    if (text === null) return part
    known = true
    return `${part.slice(0, at)}: ${text}`
  })
  return known ? `${NODE_FAILURES_PREFIX}${parts.join("; ")}` : null
}

/** Node refusals the server records with a stable `errorCode`, shown in the reader's language. */
const NODE_CODE_TEXT: Readonly<Record<string, MessageKey>> = {
  // A review-on use-case node about to run once per list item.
  [USE_CASE_REVIEW_LIST_DRIVEN]: "nodeRun.tightenReviewListDriven",
  // A use-case run's recordings that cannot run (usecaseRecordingsProblem, and a Master audio that is not audio).
  ...USE_CASE_RECORDINGS_REASON_KEYS,
}

/**
 * A node's refusal code, in the reader's language, or null for a code it does
 * not know. A preview refusal on a use-case node is its own run held by its
 * review: it is told to turn that review off. On any other node (a component,
 * a sub-workflow) the server's text already names what held it and is kept.
 */
export function nodeErrorCodeText(code: string, nodeType?: string | null): string | null {
  const known = NODE_CODE_TEXT[code]
  if (known) return tx(known)
  // A use-case node whose own result is a list, about to run once per list item: named by its type.
  if (code === USE_CASE_LIST_DRIVEN && isUseCaseNodeType(nodeType)) return tx(usecaseListDrivenKey(nodeType), usecaseLabelVars(nodeType))
  if (!REVIEW_HOLDING_USE_CASE_TYPES.has(nodeType ?? "")) return null
  const refusal = previewRefusalOfCode(code)
  return refusal ? previewRefusalText(refusal.family, "review") : null
}

/**
 * A failed node state's error, as a person reads it: a known code localized,
 * a known sentence (a use-case node's run cancelled) localized, any other
 * error as sent.
 */
export function nodeStateErrorText(
  state: { readonly error?: string | null; readonly errorCode?: string | null },
  nodeType?: string | null,
): string {
  return (state.errorCode ? nodeErrorCodeText(state.errorCode, nodeType) : null) ?? (state.error ? knownText(state.error) : null) ?? state.error ?? "Node failed"
}
