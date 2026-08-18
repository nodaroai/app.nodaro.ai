/**
 * Last KNOWN nodaro.ai connection state, synchronously — its own module so
 * consumers that cannot await (MissingProviderKeyError's message wording)
 * can read it WITHOUT importing nodaro-connect.js, whose partial vi.mocks
 * in a dozen test files would otherwise have to re-export this too.
 *
 * null until any async read has resolved it this process. A stale value
 * only ever softens phrasing, never gates behavior. Written exclusively by
 * readNodaroConnectionState() (the single funnel every isNodaroConnected /
 * getNodaroCredential call goes through).
 */
let lastKnownConnected: boolean | null = null

export function rememberNodaroConnected(connected: boolean): void {
  lastKnownConnected = connected
}

export function isNodaroConnectedCached(): boolean | null {
  return lastKnownConnected
}

/** Test seam — reset between tests. */
export function _resetNodaroConnectedCacheForTests(): void {
  lastKnownConnected = null
}
