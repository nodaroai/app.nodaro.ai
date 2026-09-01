import { getAuthHeaders } from "@/lib/api"
import { computeDeviceKey, sha256Hex } from "./device-key"

/**
 * Claims the free signup grant, once, on the boot path.
 *
 * It runs from the session rather than from /signup because a Google OAuth
 * signup never renders that page — the profile read every entry point already
 * shares is the only place the decision can be made exactly once per account.
 * The server owns the decision entirely: this module reports two fingerprints
 * and asks, and an unclaimed row is what makes the request happen at all.
 *
 * Everything here fails open, on purpose. A fingerprint is a SIGNAL, never a
 * precondition — a browser that refuses to be measured still gets its credits,
 * and its silence is itself what the server scores. So the fingerprint runs
 * under a deadline and the claim is sent with whatever finished in time, or
 * with nothing at all. Every error is swallowed: no toast, no rethrow, no
 * retry. The next page load asks again, which is the whole recovery story.
 */

const CLAIM_PATH = "/v1/credits/claim-signup-grant"

/** FingerprintJS probes canvas/audio/WebGL; first paint must not wait on it. */
const FINGERPRINT_TIMEOUT_MS = 3000

/**
 * loadRoleAndTier runs from the initial load AND from the INITIAL_SESSION
 * event within the same tick, so the latch is set before the first await —
 * an after-await check lets both callers through.
 */
let claimAttempted = false

interface SignupKeys {
  browserKey?: string
  deviceKey?: string
}

/**
 * The browser-level key. FingerprintJS contributes software entropy the
 * hardware-only device key cannot see (fonts, codecs, engine quirks), which is
 * what makes two keys worth having.
 *
 * Its `visitorId` is a 128-bit murmur hash — 32 hex characters — and the
 * server stores a key only when it is a SHA-256 hex, so it is re-hashed here.
 * Passing the raw id through would be silently dropped to NULL server-side.
 */
async function computeBrowserKey(): Promise<string | null> {
  // Dynamic so the ~37 KB agent is a chunk nobody downloads on a boot that
  // has nothing to claim.
  const { load } = await import("@fingerprintjs/fingerprintjs")
  // `monitoring: false` is mandatory: it disables FingerprintJS's own
  // install-stats beacon to m1.openfpcdn.io. We serve no CSP, so nothing at
  // the edge would catch the omission — this argument is the only guard.
  const agent = await load({ monitoring: false })
  const { visitorId } = await agent.get()
  return visitorId ? await sha256Hex(visitorId) : null
}

/**
 * Both keys, concurrently, under one deadline. Each writes itself on success,
 * so a deadline reached while one is still running still sends the other.
 */
async function collectKeys(timeoutMs: number): Promise<SignupKeys> {
  const keys: SignupKeys = {}
  let timer: ReturnType<typeof setTimeout> | undefined
  const settled = Promise.allSettled([
    computeBrowserKey().then((key) => {
      if (key) keys.browserKey = key
    }),
    computeDeviceKey().then((key) => {
      if (key) keys.deviceKey = key
    }),
  ])
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs)
  })
  try {
    await Promise.race([settled, deadline])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
  return keys
}

export async function ensureSignupGrant(
  options: { fingerprintTimeoutMs?: number } = {},
): Promise<void> {
  if (claimAttempted) return
  claimAttempted = true
  try {
    const keys = await collectKeys(options.fingerprintTimeoutMs ?? FINGERPRINT_TIMEOUT_MS)
    await fetch(CLAIM_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
      body: JSON.stringify(keys),
    })
  } catch {
    // Deliberately silent. A failed claim costs the user nothing now — the
    // grant is still unclaimed, and the next boot asks again.
  }
}
