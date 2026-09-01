/**
 * A per-DEVICE key: a SHA-256 over hardware-shaped attributes that survive a
 * new browser profile, an incognito window, or a cleared origin — the things a
 * second free account is made with. It is deliberately coarse and deliberately
 * NOT unique: a whole model line of laptop shares one, which is why it is a
 * signal the server scores rather than an identity it acts on.
 *
 * What this does NOT do: it stores nothing locally, reads no cookie, and never
 * transmits a raw component — only the digest leaves the browser. It also
 * never throws and never blocks: every input here is missing or zeroed on some
 * real browser (WebGL behind a privacy extension, `deviceMemory` outside
 * Chromium, `crypto.subtle` on an insecure origin), and a browser that refuses
 * to be measured must still reach the claim. A null return is the honest
 * answer, and the absence of a key is itself what the server scores.
 */

/** Bump when the canonical shape changes — old and new keys must not collide. */
const DEVICE_KEY_VERSION = "v1"

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

/** The device key, or null when it cannot be computed for any reason. */
export async function computeDeviceKey(): Promise<string | null> {
  try {
    return await sha256Hex(canonicalDeviceString())
  } catch {
    return null
  }
}
