/**
 * True iff `rawUrl` is an https URL whose host is our own CDN — the ORIGIN
 * derived from R2_PUBLIC_URL, or the EXACT R2_PUBLIC_FALLBACK_DOMAIN host.
 * Pure (config passed in) so it is trivially unit-testable. Exact-origin /
 * exact-host equality (not suffix, not substring) defeats the
 * prefix/subdomain/userinfo/IP-literal spoofs. Mirrors the allowlist in
 * routes/download.ts + routes/image-proxy.ts (which are route-private).
 */
export function isOurCdnUrl(rawUrl: string, publicUrl: string, fallbackDomain: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return false
  }
  if (parsed.protocol !== "https:") return false
  if (fallbackDomain !== "" && parsed.hostname === fallbackDomain) return true
  if (publicUrl !== "") {
    try {
      if (parsed.origin === new URL(publicUrl).origin) return true
    } catch {
      /* invalid config URL → not a match */
    }
  }
  return false
}

/**
 * The storage origin the deployment publishes to the browser (`/config.js`
 * `storageOrigins`, print-surface-profile.ts `--storage-origins`, and the
 * widget pages): the https origin of `publicUrl`, one `isOurCdnUrl` accepts.
 * The app's video Download asks the server only about an address on it. The
 * fallback host is deliberately not published (it stays accepted by the
 * server, as before): an address on it keeps its old download.
 */
export function publishedStorageOrigins(publicUrl: string): string[] {
  if (publicUrl === "") return []
  try {
    const parsed = new URL(publicUrl)
    return parsed.protocol === "https:" ? [parsed.origin] : []
  } catch {
    return []
  }
}
