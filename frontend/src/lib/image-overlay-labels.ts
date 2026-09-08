/**
 * Short, human labels for what a layer carries — the layer list and the
 * canvas chip show these so nobody has to click a layer to learn what it is.
 */

/** The host of a URL ("nodaro.ai"), or the text itself trimmed to `max`. */
export function qrLinkLabel(text: string | undefined, max = 32): string {
  const raw = (text ?? "").trim()
  if (!raw) return ""
  try {
    const url = new URL(raw)
    if (url.protocol === "http:" || url.protocol === "https:") {
      const path = url.pathname !== "/" ? url.pathname : ""
      return truncate(`${url.hostname}${path}`, max)
    }
  } catch {
    // plain text
  }
  return truncate(raw, max)
}

/** True when the QR payload is something a browser can open. */
export function isOpenableLink(text: string | undefined): boolean {
  try {
    const url = new URL((text ?? "").trim())
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

/** First line of a text layer, trimmed to `max`. */
export function textLayerLabel(text: string | undefined, max = 32): string {
  return truncate((text ?? "").split(/\r?\n/)[0].trim(), max)
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}
