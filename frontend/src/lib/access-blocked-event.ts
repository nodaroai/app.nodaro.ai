/**
 * The server refused a request because this account — or the network it is
 * on — has been blocked by an admin (`403 access_blocked`).
 *
 * Every REST call funnels through `throwApiError`, which dispatches this event
 * before throwing `AccessBlockedError`; `AccessBlockedScreen` (mounted once at
 * the app root) listens and covers the app with the notice, so a blocked
 * person sees one clear sentence instead of a cascade of failed requests.
 */
export const ACCESS_BLOCKED_EVENT = "nodaro:access-blocked"

export function dispatchAccessBlocked(): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(ACCESS_BLOCKED_EVENT))
}
