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

/** The reason as a sentence's tail: trimmed, its own closing period dropped. */
const reasonTail = (reason: string | undefined): string => {
  const r = (reason ?? "").trim().replace(/\.+$/, "")
  return r ? `: ${r}` : ""
}

/**
 * A clip set none of whose planned clips rendered (decided 2026-10-18): how
 * many, and why — the render step's own error. Without a reason, the count
 * alone.
 */
export function clipPackNoneRenderedMessage(count: number, reason?: string): string {
  return count === 1
    ? `The plan's one clip could not be rendered${reasonTail(reason)}.`
    : `None of the ${count} clips could be rendered${reasonTail(reason)}.`
}

/** The count and the reason of a `clipPackNoneRenderedMessage` sentence that names one; null for any other text. */
export function parseClipPackNoneRendered(message: string): { readonly count: number; readonly reason: string } | null {
  const one = /^The plan's one clip could not be rendered: ([\s\S]+)\.$/.exec(message)
  if (one) return { count: 1, reason: one[1]! }
  const many = /^None of the (\d+) clips could be rendered: ([\s\S]+)\.$/.exec(message)
  return many ? { count: Number(many[1]), reason: many[2]! } : null
}
