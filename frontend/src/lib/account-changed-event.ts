/**
 * The account's credits or storage changed by the app's own hand (a top-up, a
 * plan change, the welcome credits, a Copilot turn's spend). The hosted Nodaro
 * header keeps its own copy of the balance, so it listens for this one window
 * event instead of sharing the app's query cache. Core dispatches, the header
 * listens — the same shape as `consent-required-event.ts`; the name is held to
 * the header package's own by `ee/shell/contract/props.contract.ts`.
 *
 * It goes through `globalThis` so the callers (billing mutations, which also run
 * in tests with no DOM at all) stay DOM-free where there is no window to tell.
 */
export const ACCOUNT_CHANGED_EVENT = "nodaro:account-changed"

export function dispatchAccountChanged(): void {
  if (typeof globalThis.dispatchEvent !== "function") return
  globalThis.dispatchEvent(new CustomEvent(ACCOUNT_CHANGED_EVENT))
}
