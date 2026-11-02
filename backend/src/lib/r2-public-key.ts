/**
 * The storage key a public address of ours names, from the public base the
 * deployment serves files on. A leaf (no config, no client): the storage
 * module's `r2KeyFromOurUrl` and the content restrictions' address decoder
 * both read through it, so a module that only has to recognise an address
 * never loads the storage client.
 */
export function r2KeyFromPublicUrl(url: string, publicUrl: string | undefined | null): string | null {
  if (!publicUrl) return null
  try {
    const base = new URL(publicUrl)
    const candidate = new URL(url)
    if (candidate.origin !== base.origin) return null
    const prefix = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`
    if (!candidate.pathname.startsWith(prefix)) return null
    const key = candidate.pathname.slice(prefix.length)
    return key || null
  } catch {
    return null
  }
}
