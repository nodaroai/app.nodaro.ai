import { clockText } from "./format"

/** "Chrome · Windows" from a browser's user agent; a non-browser shows its own first word (curl/8.4.0, node). */
export function deviceText(userAgent: string | null): string {
  if (!userAgent) return "—"
  const ua = userAgent
  const os = /Windows/.test(ua)
    ? "Windows"
    : /iPhone|iPad|iPod/.test(ua)
      ? "iOS"
      : /Android/.test(ua)
        ? "Android"
        : /CrOS/.test(ua)
          ? "ChromeOS"
          : /Mac OS X|Macintosh/.test(ua)
            ? "macOS"
            : /Linux/.test(ua)
              ? "Linux"
              : null
  const browser = /Edg(A|iOS)?\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Firefox\/|FxiOS/.test(ua)
        ? "Firefox"
        : /Chrome\/|CriOS/.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : null
  if (!browser && !os) return ua.split(/\s+/)[0] || "—"
  return [browser, os].filter(Boolean).join(" · ")
}

const regions = (() => {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" })
  } catch {
    return null
  }
})()

/** "Israel (IL)", or the code alone where the name is unknown; "—" without one. */
export function countryText(code: string | null): string {
  if (!code) return "—"
  const name = regions?.of(code)
  return name && name !== code ? `${name} (${code})` : code
}

/** "just now", "4 min ago", or the time of day past an hour. */
export function agoText(iso: string, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (seconds < 60) return "just now"
  if (seconds < 3_600) return `${Math.floor(seconds / 60)} min ago`
  return clockText(iso)
}
