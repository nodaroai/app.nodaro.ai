/**
 * Retry for boot-time tasks that reach Supabase through the container's OWN
 * proxy.
 *
 * On the community stack SUPABASE_URL is localhost:3000/supabase — this
 * container's Caddy — and start.sh starts Caddy only after the API answers
 * /health. Anything fired at process init therefore makes its first network
 * call into a closed port and fails deterministically ("fetch failed",
 * AuthRetryableFetchError, ECONNREFUSED). Two boot tasks lost that race on
 * every boot before this existed: nodaro.ai provider registration (see
 * providers/nodaro/index.ts, which keeps its own tri-state loop) and the
 * tutorial seed (2026-08-16 live swap: categories 3, flows 0).
 *
 * Only TRANSPORT failures are retried. An application error (constraint
 * violation, RLS, bad input) is rethrown at once — retrying it would only hide
 * a real bug behind a minute of silence.
 */

/** Same schedule as the provider registration: ~1 minute, six attempts. */
export const BOOT_RETRY_DELAYS_MS: readonly number[] = [2_000, 4_000, 8_000, 16_000, 30_000]

const TRANSPORT_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "EPIPE", "UND_ERR_SOCKET"])
const TRANSPORT_MESSAGE = /fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|socket hang up|network error|other side closed/i

/** True when `err` looks like "the other end is not there", not "it said no". */
export function isTransportError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false
  const record = err as { name?: unknown; message?: unknown; code?: unknown; cause?: unknown }
  if (record.name === "AuthRetryableFetchError") return true
  if (typeof record.code === "string" && TRANSPORT_CODES.has(record.code)) return true
  if (typeof record.message === "string" && TRANSPORT_MESSAGE.test(record.message)) return true
  return record.cause !== undefined && record.cause !== err && isTransportError(record.cause)
}

export interface TransportRetryOptions {
  delaysMs?: readonly number[]
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Run `task`; on a transport failure wait and run it again, walking
 * `delaysMs`. Rethrows a non-transport error immediately and the last
 * transport error once the schedule is exhausted. `task` must be idempotent.
 */
export async function withTransportRetry<T>(
  label: string,
  task: () => Promise<T>,
  { delaysMs = BOOT_RETRY_DELAYS_MS, sleep = defaultSleep }: TransportRetryOptions = {},
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await task()
    } catch (err) {
      if (!isTransportError(err) || attempt >= delaysMs.length) throw err
      const delay = delaysMs[attempt]
      console.warn(
        `[${label}] store not reachable yet (${describe(err)}) — retry ${attempt + 1}/${delaysMs.length} in ${delay}ms`,
      )
      await sleep(delay)
    }
  }
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === "object" && typeof (err as { message?: unknown }).message === "string") {
    return (err as { message: string }).message
  }
  return String(err)
}
