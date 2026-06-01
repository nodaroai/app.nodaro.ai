const KEY = "nodaro:discard-confirm-suppressed"
/** Whether to show the discard/run-instead confirm dialog (default: yes). */
export function shouldConfirmDiscard(): boolean {
  try { return localStorage.getItem(KEY) !== "1" } catch { return true }
}
/** Remember the user opted out of the confirm dialog. */
export function suppressDiscardConfirm(): void {
  try { localStorage.setItem(KEY, "1") } catch { /* ignore */ }
}
