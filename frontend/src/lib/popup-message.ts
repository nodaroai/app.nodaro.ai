/**
 * Messages from a window this page talks to: a pop-up it opened, a frame it
 * embeds, or the page that frames it.
 *
 * A `message` event can come from ANY window able to post to this one: a frame
 * embedded in the page, or another tab or window holding a reference to it. So
 * a message is taken only when BOTH of these hold:
 *
 * - `source` is that very window (what `window.open` returned, the frame's
 *   `contentWindow`, `window.parent`), compared by identity;
 * - `origin` is the origin that window's page is expected on.
 *
 * Either check alone has a hole. The origin alone trusts any frame served from
 * that origin, and the source alone trusts whatever page the window happens to
 * show, an identity provider's own pages included. `classifyScene3DEmbedMessage`
 * applies the same rule to its parent frame.
 *
 * DOM-free and pure, so the adversarial cases are unit-testable without a browser.
 */

/** The parts of a `MessageEvent` these checks read. A `MessageEvent` satisfies it. */
export interface PopupMessageTransport {
  readonly data: unknown
  readonly origin: string
  /** `MessageEvent.source`. Compared by identity against the expected window. */
  readonly source: unknown
}

/** Whether a message came from `expected` (a pop-up, a frame's window, the parent), on `expectedOrigin`. */
export function isFromWindow(transport: PopupMessageTransport, expected: unknown, expectedOrigin: string): boolean {
  // No window (a blocked pop-up, a frame not mounted) means there is nothing to
  // hear from, and a message with no source (a synthetic event) must not match
  // a null handle.
  if (expected === null || expected === undefined) return false
  if (transport.source !== expected) return false
  return transport.origin === expectedOrigin
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** The `type` the sign-in pop-up's `/auth/callback` page posts the new session under. */
export const LOGIN_POPUP_MESSAGE_TYPE = "nodaro:authComplete"

export interface LoginPopupSession {
  readonly accessToken: string
  readonly refreshToken: string
}

/**
 * The session the sign-in pop-up handed back, or null when this message is not
 * that. The pop-up opens `/login` on this app's own origin, so `ownOrigin` (the
 * caller's `window.location.origin`) is the only origin its result can come from.
 */
export function readLoginPopupSession(
  transport: PopupMessageTransport,
  popup: unknown,
  ownOrigin: string,
): LoginPopupSession | null {
  if (!isFromWindow(transport, popup, ownOrigin)) return null
  const data = transport.data
  if (!isRecord(data) || data.type !== LOGIN_POPUP_MESSAGE_TYPE) return null
  const { access_token: accessToken, refresh_token: refreshToken } = data
  if (typeof accessToken !== "string" || accessToken === "") return null
  if (typeof refreshToken !== "string" || refreshToken === "") return null
  return { accessToken, refreshToken }
}
