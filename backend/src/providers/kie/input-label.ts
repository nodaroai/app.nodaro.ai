/**
 * Which input a failed media preparation was working on.
 *
 * A KIE run prepares its inputs in parallel (every reference image, frame and
 * reference video is downloaded, decoded, maybe re-encoded and uploaded
 * before the task is created), so a bare "terminated" or "The operation was
 * aborted due to timeout" said nothing about WHICH of them failed, or at what
 * point. This names the input (its kind and number), the URL without its
 * query, and the step, in one log line.
 *
 * The thrown error itself is never replaced or wrapped: its class, name and
 * message are what the worker reads to decide the retry, the refund and the
 * job's user-facing `error_message`, so all three stay exactly as they were.
 * The label rides on the error as `internalDetails` (only when it carries
 * none of its own) — the admin-only `error_detail`, written through
 * `providerDetailOf`, which keeps no more of a URL than its host. No URL is
 * put there; it is only in the log.
 */

/** The point in a preparation where an input failed. */
export type InputStep = "download" | "decode" | "check" | "encode" | "upload" | "probe" | "shrink"

/** Set on an error once it has been labelled, so an outer wrapper does not label it twice. */
const LABELLED = Symbol.for("nodaro.kie.inputFailureLabelled")

/** `url` without its query and fragment (they can carry signatures), for a log line. */
export function urlForLog(url: string): string {
  try {
    const u = new URL(url)
    return `${u.origin}${u.pathname}`
  } catch {
    return "<unparsable url>"
  }
}

function describe(err: unknown): string {
  if (!(err instanceof Error)) return String(err)
  const cause = err.cause instanceof Error ? ` (cause: ${err.cause.name}: ${err.cause.message})` : ""
  return `${err.name}: ${err.message}${cause}`
}

/**
 * Log which input failed, and at which step, and note it on the error. The
 * error is left otherwise untouched; the caller rethrows it as it is.
 */
export function labelInputFailure(err: unknown, label: string, url: string, step: InputStep): void {
  const target = err !== null && typeof err === "object" ? (err as Record<PropertyKey, unknown>) : null
  if (target?.[LABELLED]) return
  const what = describe(err)
  console.error(`[KIE.ai] input ${label} failed at ${step} (${urlForLog(url)}): ${what}`)
  if (!target) return
  try {
    Object.defineProperty(target, LABELLED, { value: true, enumerable: false, configurable: true })
    if (typeof target.internalDetails !== "string") {
      Object.defineProperty(target, "internalDetails", {
        value: `input ${label} failed at ${step}: ${what}`,
        enumerable: false,
        configurable: true,
        writable: true,
      })
    }
  } catch {
    /* a frozen error: the log line above is the label */
  }
}

/** Run `fn` as `step` of preparing input `label`; a failure is labelled and rethrown unchanged. */
export async function atInputStep<T>(label: string, url: string, step: InputStep, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    labelInputFailure(err, label, url, step)
    throw err
  }
}
