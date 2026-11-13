/**
 * The visitor's Google Analytics ids, read from the cookies the GA4 tag sets.
 *
 * A checkout carries them to the server, which stores them on the payment so
 * its completion can be reported against the visit that started it (the
 * server reports the purchase; the browser is long gone by then).
 *
 * `_ga` holds the client id: `GA1.<domain level>.<random>.<first visit, seconds>`
 * — the id is the last two fields. `_ga_<measurement id without "G-">` holds
 * the session: `GS1.<level>.<session start>.<count>.…` (older) or
 * `GS2.<level>.s<session start>$o<count>$g…$t…` (current), the session id
 * being its start in seconds. A name can appear twice (a stale cookie on a
 * parent domain, e.g. one holding "deleted"), so the first value that parses
 * wins and anything else is ignored. Nothing here throws.
 */

export interface GaVisitIds {
  readonly gaClientId?: string
  readonly gaSessionId?: string
}

/** The client id the server accepts: two runs of digits joined by a dot. */
export const GA_CLIENT_ID = /^\d{1,20}\.\d{1,20}$/
/** The session id the server accepts: a run of digits. */
export const GA_SESSION_ID = /^\d{1,20}$/

const MEASUREMENT_ID = /^G-[A-Z0-9]{4,20}$/

/** The GA ids in a `document.cookie` string, for the GA4 property `measurementId`. */
export function gaVisitIdsFromCookies(cookieHeader: string, measurementId: string): GaVisitIds {
  if (!MEASUREMENT_ID.test(measurementId)) return {}
  const pairs = cookiePairs(cookieHeader)
  const gaClientId = firstParsed(pairs, "_ga", clientIdOf)
  const gaSessionId = firstParsed(pairs, `_ga_${measurementId.slice(2)}`, sessionIdOf)
  return {
    ...(gaClientId ? { gaClientId } : {}),
    ...(gaSessionId ? { gaSessionId } : {}),
  }
}

function cookiePairs(cookieHeader: string): ReadonlyArray<readonly [string, string]> {
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.includes("="))
    .map((part) => {
      const eq = part.indexOf("=")
      return [part.slice(0, eq).trim(), decoded(part.slice(eq + 1).trim())] as const
    })
}

function decoded(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function firstParsed(
  pairs: ReadonlyArray<readonly [string, string]>,
  name: string,
  parse: (value: string) => string | null,
): string | null {
  for (const [key, value] of pairs) {
    if (key !== name) continue
    const parsed = parse(value)
    if (parsed) return parsed
  }
  return null
}

function clientIdOf(value: string): string | null {
  const fields = value.split(".")
  if (fields.length !== 4 || !/^GA\d+$/.test(fields[0] ?? "")) return null
  const id = `${fields[2]}.${fields[3]}`
  return GA_CLIENT_ID.test(id) ? id : null
}

function sessionIdOf(value: string): string | null {
  const fields = value.split(".")
  if (fields.length < 3) return null
  if (fields[0] === "GS1") {
    const id = fields[2] ?? ""
    return GA_SESSION_ID.test(id) ? id : null
  }
  if (fields[0] === "GS2") {
    const start = fields.slice(2).join(".").split("$").find((field) => field.startsWith("s"))
    const id = start?.slice(1) ?? ""
    return GA_SESSION_ID.test(id) ? id : null
  }
  return null
}
