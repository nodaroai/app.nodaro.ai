/**
 * The two browser signals a Nodaro app reports when it claims the free
 * signup grant (`client.credits.claimSignupGrant`) — a browser-level key
 * and a device-level key. This is the ONE implementation every Nodaro
 * surface uses, so a browser seen on one of them is recognised on all: the
 * keys are compared server-side, and two surfaces computing them differently
 * would silently stop matching each other.
 *
 * Browser-only (`document`, `screen`, `crypto.subtle`), hence its own
 * subpath (`@nodaro/sdk/signup-signals`) beside `@nodaro/sdk/supabase` —
 * the package's main entry stays Node-safe.
 *
 * Everything here fails open, on purpose. A key is a SIGNAL the server
 * scores, never a precondition: a browser that refuses to be measured must
 * still reach the claim. So nothing throws, nothing blocks past its
 * deadline, nothing is stored locally, no cookie is read, and no raw
 * component ever leaves the browser — only the digests.
 *
 * The browser key needs `@fingerprintjs/fingerprintjs` (an optional peer
 * dependency, loaded on demand); without it only the device key is sent.
 */

/** Bump when the canonical shape changes — old and new keys must not collide. */
const DEVICE_KEY_VERSION = "v1"

/** FingerprintJS probes canvas/audio/WebGL; first paint must not wait on it. */
export const SIGNUP_SIGNALS_TIMEOUT_MS = 3000

/** What a claim carries. Each key is a SHA-256 hex digest, absent when it could not be computed. */
export interface SignupKeys {
  browserKey?: string
  deviceKey?: string
}

/** SHA-256 as lowercase hex, or null where SubtleCrypto is unavailable. */
export async function sha256Hex(value: string): Promise<string | null> {
  try {
    const subtle = globalThis.crypto?.subtle
    if (!subtle) return null
    const digest = await subtle.digest("SHA-256", new TextEncoder().encode(value))
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
  } catch {
    return null
  }
}

/**
 * The GPU string, which is the highest-entropy hardware attribute available.
 * Guarded on its own rather than with the rest: a null context is the NORMAL
 * case on a hardened browser, and it must cost only this one field instead of
 * the whole key. `WEBGL_debug_renderer_info` is being retired, so the masked
 * RENDERER is the fallback.
 */
function webglRenderer(): string {
  try {
    const canvas = document.createElement("canvas")
    const gl = (canvas.getContext("webgl") ??
      canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null
    if (!gl) return ""
    const debugInfo = gl.getExtension("WEBGL_debug_renderer_info")
    const renderer = debugInfo
      ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER)
    return typeof renderer === "string" ? renderer : ""
  } catch {
    return ""
  }
}

/**
 * Fixed order, one labelled field each, empty where an attribute is absent —
 * so a browser that hides two of them still produces a stable key, and adding
 * a field later cannot silently re-map an existing one.
 */
function canonicalDeviceString(): string {
  const nav = navigator as Navigator & { deviceMemory?: number }
  return [
    DEVICE_KEY_VERSION,
    `gl=${webglRenderer()}`,
    `hc=${nav.hardwareConcurrency ?? ""}`,
    `dm=${nav.deviceMemory ?? ""}`,
    `sw=${screen.width ?? ""}`,
    `sh=${screen.height ?? ""}`,
    `cd=${screen.colorDepth ?? ""}`,
    `dpr=${window.devicePixelRatio ?? ""}`,
    `pf=${nav.platform ?? ""}`,
    `tz=${Intl.DateTimeFormat().resolvedOptions().timeZone ?? ""}`,
  ].join("|")
}

/**
 * The per-DEVICE key: a SHA-256 over hardware-shaped attributes that survive
 * a new browser profile, an incognito window, or a cleared origin. It is
 * deliberately coarse and deliberately NOT unique — a whole model line of
 * laptop shares one. Null when it cannot be computed for any reason.
 */
export async function computeDeviceKey(): Promise<string | null> {
  try {
    return await sha256Hex(canonicalDeviceString())
  } catch {
    return null
  }
}

/**
 * The browser-level key. FingerprintJS contributes software entropy the
 * hardware-only device key cannot see (fonts, codecs, engine quirks), which
 * is what makes two keys worth having.
 *
 * Its `visitorId` is a 128-bit murmur hash — 32 hex characters — and the
 * server stores a key only when it is a SHA-256 hex, so it is re-hashed
 * here. Null when the agent is not installed, cannot load, or yields nothing.
 */
export async function computeBrowserKey(): Promise<string | null> {
  try {
    // Dynamic so the ~37 KB agent is a chunk nobody downloads on a boot that
    // has nothing to claim — and so a consumer without it still builds.
    const { load } = await import("@fingerprintjs/fingerprintjs")
    // `monitoring: false` is mandatory: it disables FingerprintJS's own
    // install-stats beacon to m1.openfpcdn.io.
    const agent = await load({ monitoring: false })
    const { visitorId } = await agent.get()
    return visitorId ? await sha256Hex(visitorId) : null
  } catch {
    return null
  }
}

/**
 * Both keys, concurrently, under one deadline. Each writes itself on
 * success, so a deadline reached while one is still running still sends the
 * other — and a browser that yields neither sends `{}`.
 */
export async function collectSignupKeys(timeoutMs: number = SIGNUP_SIGNALS_TIMEOUT_MS): Promise<SignupKeys> {
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
  return { ...keys }
}
