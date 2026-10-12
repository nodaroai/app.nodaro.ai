/**
 * The server's clock, as this browser reads it. A time the editor stamps beside
 * a result it lands (when the run that made it ended) is later compared with run
 * and job times the server wrote — which result is the newer one — so both must
 * be read on one clock. Each API answer's `Date` header sets how far this
 * browser's clock is off; until one has been read the browser's own clock stands
 * in. A job's own end (`completed_at`) is better still where there is one.
 */

/** Server time minus browser time, from the last answer read. */
let offsetMs = 0

/** The header names whole seconds: its time is taken at the middle of the second. */
const HALF_SECOND_MS = 500

/** Record the server's clock from an answer's `Date` header, received at `receivedAtMs` (this browser's clock). */
export function noteServerDate(date: string | null | undefined, receivedAtMs: number = Date.now()): void {
  const serverMs = typeof date === "string" ? Date.parse(date) : Number.NaN
  if (Number.isFinite(serverMs)) offsetMs = serverMs + HALF_SECOND_MS - receivedAtMs
}

/** Now, on the server's clock as last read. */
export function serverNowIso(nowMs: number = Date.now()): string {
  return new Date(nowMs + offsetMs).toISOString()
}

/** Tests: back to the browser's own clock. */
export function resetServerClock(): void {
  offsetMs = 0
}
