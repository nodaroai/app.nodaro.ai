/** Distinguishes a successful read with no policy from temporary defaults after a failed read. */
const failedReads = new WeakSet<object>()

export function markSettingsReadFailed(settings: object): void {
  failedReads.add(settings)
}

export function settingsReadFailed(settings: object): boolean {
  return failedReads.has(settings)
}
