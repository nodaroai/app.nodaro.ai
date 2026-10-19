/**
 * What a use-case node's engine run says when it stops, in English, naming
 * the node by its type's English label (decided 2026-10-18: every use-case
 * node is named by its own label, never Tighten Episode's). The editor shows
 * a known sentence in the reader's language, with the localized label
 * (frontend lib/execution-error-text.ts), so the two must stay word for word.
 */

/** The node's run was cancelled. */
export function usecaseCancelledMessage(label: string): string {
  return `${label} was cancelled`
}
