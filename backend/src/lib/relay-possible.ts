import { config } from "./config.js"
import { isNodaroConnectedCached } from "./nodaro-connect-cache.js"

/**
 * "Can this instance be holding an object that ANOTHER instance created?"
 *
 * THE ONE ARMING GATE for the relay delete rule (spec
 * 2026-09-04-sai-local-development §9.3, D18). Every extra query the rule
 * issues — the stem probe, the durable-marker probe, the job-row read, the
 * asset provenance fallback — sits behind this predicate, so a deployment that
 * has no relay target at all issues EXACTLY the query sequence it issued before
 * the rule existed. That byte-identity is the whole reason the rule was allowed
 * to reach the shared delete core in the first place, and it is pinned by the
 * per-path query-count tests in lib/__tests__/relay-query-pins.test.ts.
 *
 * SYNCHRONOUS AND FREE, by construction: three in-memory reads, no database
 * round trip, on a path that runs once per deleted object.
 *
 *   1. `R2_SHARED_WITH_RELAY_TARGET` — the deployment FACT that makes a far
 *      end's object reachable by our delete paths at all. Without a shared
 *      bucket `uploadToR2` copies, `r2KeyFromOurUrl(farUrl)` answers null, and
 *      no delete path in this codebase can even name a foreign object.
 *   2. A nodaro.ai API key (`config.NODARO_API_KEY` — a getter over the env and
 *      operator-pasted layers, `lib/provider-keys-runtime.ts`).
 *   3. The last-known OAuth connection state (`nodaro-connect-cache.ts`),
 *      written by every `readNodaroConnectionState()` this process performs.
 *
 * FLAG-INDEPENDENT IN THE DIRECTION THAT MATTERS. The flag is ONE ARMING TERM
 * among three, never a requirement: an instance whose operator flips
 * `R2_SHARED_WITH_RELAY_TARGET` off keeps the fence as long as it is connected
 * or holds a key, so a flipped flag cannot reclassify history and start
 * deleting objects the far end still owns. The inverse — arming on the flag
 * alone — is what keeps the fence up on an instance whose connection has since
 * been revoked but whose bucket is still shared.
 *
 * LATCHED, and only upwards. Once any term has answered true this process keeps
 * answering true: a token revoked (or a credential store that stops answering)
 * mid-process must not silently disarm a fence that is protecting objects
 * already sitting in the bucket. A restart re-evaluates from the environment.
 *
 * RESIDUAL, stated rather than engineered around: term 3 reads a cache that is
 * `null` until this process has performed its first connection read. The API
 * process warms it through `/v1/nodaro-connect/*`, `routes/nodes.ts` and the
 * exclusive routes rather than at boot, so a delete issued in the very first
 * moments of a process on an OAuth-connected instance with the flag OFF and no
 * API key would answer false. That combination cannot reach a far object
 * anyway — with the flag off the far URL is not under our `R2_PUBLIC_URL`, so
 * `r2KeyFromOurUrl` returns null and every delete path skips it as foreign.
 */
let latched = false

export function relayPossible(): boolean {
  if (latched) return true
  const armed =
    config.R2_SHARED_WITH_RELAY_TARGET === true ||
    (config.NODARO_API_KEY ?? "").trim().length > 0 ||
    isNodaroConnectedCached() === true
  if (armed) latched = true
  return armed
}

/** Test seam — the latch is process-global by design. */
export function _resetRelayPossibleForTests(): void {
  latched = false
}
