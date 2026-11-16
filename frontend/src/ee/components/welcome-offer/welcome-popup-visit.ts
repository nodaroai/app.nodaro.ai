/**
 * "The welcome popup already opened by itself in this visit" — kept per tab
 * and per account, so the popup never opens by itself twice in one visit,
 * whatever the balance says in between (a poll can still answer `popupDue:
 * true` before the server has heard the "shown", and a "shown" that never
 * arrives leaves it due). A reload in the same tab is the same visit.
 *
 * sessionStorage when the browser allows it, and a module copy always: a
 * private window or blocked storage still gets the guarantee for the life of
 * the page.
 */

const KEY_PREFIX = "nodaro.welcomePopup.autoShown:"
const shownInThisPage = new Set<string>()

export function autoShownThisVisit(userId: string): boolean {
  if (shownInThisPage.has(userId)) return true
  try {
    return window.sessionStorage.getItem(KEY_PREFIX + userId) === "1"
  } catch {
    return false
  }
}

export function markAutoShownThisVisit(userId: string): void {
  shownInThisPage.add(userId)
  try {
    window.sessionStorage.setItem(KEY_PREFIX + userId, "1")
  } catch {
    // the module copy above still holds for this page
  }
}

/** Tests only: start a new visit. */
export function __resetWelcomePopupVisitForTests(): void {
  shownInThisPage.clear()
  try {
    for (const key of Object.keys(window.sessionStorage)) {
      if (key.startsWith(KEY_PREFIX)) window.sessionStorage.removeItem(key)
    }
  } catch {
    // nothing stored
  }
}
