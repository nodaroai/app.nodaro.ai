/**
 * What to do with an answer from POST /v1/nodaro-connect/start.
 *
 * Exactly two outcomes: leave for the nodaro.ai consent screen, or show a
 * message where the user clicked. The setup screen used to turn every non-OK
 * answer into a silent hop to /integrations — the button said "opens
 * nodaro.ai" and a different local page appeared, with the actual reason
 * (production had the feature switched off) visible to nobody. Kept out of
 * the page so the rule is testable without rendering 1,300 lines of setup UI.
 */

export type ConnectStartOutcome =
  | { kind: "redirect"; url: string }
  | { kind: "error"; message: string; code?: string }

/** Shown when the request itself never reached the instance. */
export const CONNECT_START_NETWORK_MESSAGE =
  "Could not reach this server to start the nodaro.ai connection. Check that it is running, or use your own provider keys."

const FALLBACK_MESSAGE =
  "Could not start the nodaro.ai connection. Use your own provider keys, or try again in a moment."

export function interpretConnectStart(status: number, body: unknown): ConnectStartOutcome {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : null
  const authorizeUrl = typeof record?.authorizeUrl === "string" ? record.authorizeUrl : null
  if (status >= 200 && status < 300 && authorizeUrl && /^https?:\/\//i.test(authorizeUrl)) {
    return { kind: "redirect", url: authorizeUrl }
  }
  const error = record?.error && typeof record.error === "object" ? (record.error as Record<string, unknown>) : null
  const message = typeof error?.message === "string" && error.message.trim() ? error.message.trim() : FALLBACK_MESSAGE
  const code = typeof error?.code === "string" ? error.code : undefined
  return { kind: "error", message, ...(code ? { code } : {}) }
}
