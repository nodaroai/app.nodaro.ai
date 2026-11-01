/**
 * Provider egress seam.
 *
 * Every outbound provider HTTP call flows through `providerFetch`. With NO
 * decorator registered it is byte-identical to a bare `fetch` — that is
 * mainline's behavior. A registered `EgressDecorator` (e.g. an external
 * metering/proxy adapter, built in that deployment's own repo) may add
 * request headers via `decorate(call)` and inspect the response via
 * `observe(call, res)`; `observe` may mark an error message user-safe, which
 * `createSanitizedError` then passes through verbatim instead of sanitizing.
 *
 * `modelKey` is OUR key (MODEL_CATALOG / KIE model key), never the provider's
 * model id, and it is a REQUIRED field of `EgressCall` — money is per-call and
 * never ambient. Identity (userId) is the one thing that DOES ride ambiently,
 * via the job-cancellation AsyncLocalStorage (see `getJobUserId`), because a
 * decorator that needs it reads it there rather than threading a param through
 * every provider method.
 *
 * Concurrency lanes: a billing call (`modelKey !== null`) runs through
 * `withConcurrencySlot` (lib/concurrency-lanes/slot.ts), which takes a slot of
 * its lane according to the hold it runs under — none under a job's leaf slot,
 * a front slot under a coordinator, the request's slot inside a request, and
 * none (counted as ungated) under no hold at all. A poll or status read
 * (`modelKey: null`) never takes one. The SDK clients (Replicate, fal) send
 * every call with `modelKey: null` and say which of their calls create work
 * (`createsWork`), so those take a slot here too.
 */
import { withConcurrencySlot } from "../lib/concurrency-lanes/slot.js"
import type { LeafLane } from "../lib/concurrency-lanes/leaf-lanes.js"

/** The request as it is actually leaving us — after every per-model remap. */
export interface EgressCall {
  /** Coarse provider family: "kie" | "elevenlabs" | "replicate" | "fal" | "heygen" | "beeble" | "nodaro" | … */
  provider: string
  /** Stable operation label, e.g. "jobs.createTask" | "veo.generate" | "tts". */
  operation: string
  /** OUR Nodaro key (MODEL_CATALOG / KIE_MODELS), NOT the provider's id. `null` for non-billing calls (polls, audit). */
  modelKey: string | null
  /** The body actually being sent (post-resolutionMap/extraParams/duration-snap). */
  body: unknown
  /** Billing dimensions the wire body implies: resolution, audio, videoInput,
   *  durationLabel, duration, characters, … Booleans are allowed (audio /
   *  videoInput are two-state cost levers). */
  dimensions: Record<string, string | number | boolean | undefined>
}

/** The two billing-bearing fields a client entry point threads to a call site. */
export interface EgressMeta {
  modelKey: string | null
  dimensions?: Record<string, string | number | boolean | undefined>
}

export interface EgressObservation {
  status: number
  headers: Headers
  /** Parsed JSON body, when the response was JSON; otherwise undefined. */
  body?: unknown
}

export interface EgressDecorator {
  /** Return request headers to merge, or null for none. */
  decorate(call: EgressCall): { headers?: Record<string, string> } | null
  /** Observe the response; may mark a message user-safe. Best-effort — may not throw meaningfully. */
  observe?(call: EgressCall, res: EgressObservation): { userSafeMessage?: string } | void
}

// A single replaceable slot. One adapter per deployment; register at composition root.
let decorator: EgressDecorator | null = null
export function setEgressDecorator(d: EgressDecorator | null): void {
  decorator = d
}
export function getEgressDecorator(): EgressDecorator | null {
  return decorator
}
export function clearEgressDecorator(): void {
  decorator = null
}

// Per-Response user-safe mark. Keyed by the Response instance (each call gets
// its own), so it is race-free and never mutates the Response.
const userSafeMarks = new WeakMap<Response, string>()
export function readUserSafeMessage(res: Response): string | null {
  const m = userSafeMarks.get(res)
  return m && m.trim() ? m : null
}

/**
 * The lane a provider call counts in. `local` (in-house compute) never leaves
 * through the egress, and no LLM text call does either: the LLM router's lanes
 * use their own clients and take their `llm` slot in the router. So every
 * egress call is a `provider` call; a hand-kept list of LLM vendors here would
 * only drift. An LLM call that one day leaves through the egress states its
 * lane here, from the call itself.
 */
export function laneForEgress(_call: Pick<EgressCall, "provider">): Exclude<LeafLane, "local"> {
  return "provider"
}

/**
 * A `fetch`-shaped adapter for provider SDKs (Replicate, fal) that own their
 * transport. The SDK boundary does not expose OUR modelKey or the parsed body,
 * so those are null/undefined — identity (via the ALS-reading decorator) and
 * observation still apply. `operation` is derived from the request URL path.
 *
 * `createsWork(method, url)` names the calls that start provider work (a
 * prediction, a queue submit): those take a concurrency slot like a billing
 * call; every other call (status, result, uploads) takes none.
 */
export function egressSdkFetch(
  provider: string,
  opts: { createsWork?: (method: string, url: string) => boolean } = {},
): (input: Request | string | URL, init?: RequestInit) => Promise<Response> {
  return (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    let path = url
    try {
      path = new URL(url).pathname
    } catch {
      /* leave the raw url as the operation suffix */
    }
    const call: EgressCall = { provider, operation: `${provider}${path}`, modelKey: null, body: undefined, dimensions: {} }
    const method = (init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase()
    if (opts.createsWork?.(method, url)) {
      return withConcurrencySlot({ lane: laneForEgress(call), provider, jobType: call.operation, model: null }, () => sendEgress(call, url, init ?? {}))
    }
    return sendEgress(call, url, init ?? {})
  }
}

// Deliberately NOT `async`: both branches already return a promise, and an
// async wrapper around them would add microtask turns to every provider call —
// including the lane-free poll path, which must cost exactly what a bare
// sendEgress costs (nothing lane-related may delay a call).
export function providerFetch(
  call: EgressCall,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  // A poll or status read (no billing model) never takes a concurrency slot.
  if (call.modelKey === null) return sendEgress(call, url, init)
  return withConcurrencySlot(
    { lane: laneForEgress(call), provider: call.provider, jobType: call.operation, model: call.modelKey },
    () => sendEgress(call, url, init),
  )
}

async function sendEgress(call: EgressCall, url: string, init: RequestInit): Promise<Response> {
  const dec = decorator
  // Inert default: no decorator ⇒ exactly a bare fetch. No headers, no clone.
  if (!dec) return fetch(url, init)

  const extra = dec.decorate(call)
  let outgoing = init
  if (extra?.headers) {
    const headers = new Headers(init.headers)
    for (const [k, v] of Object.entries(extra.headers)) headers.set(k, v)
    outgoing = { ...init, headers }
  }

  const res = await fetch(url, outgoing)

  if (dec.observe) {
    // Best-effort + observe-only: an observer failure must never break the
    // provider call, and the response the caller receives is unchanged.
    try {
      let body: unknown
      const ct = res.headers.get("content-type") ?? ""
      // Only tee JSON — never clone a large binary body (audio/video).
      if (ct.includes("json")) {
        try {
          body = await res.clone().json()
        } catch {
          /* malformed JSON error body — leave body undefined */
        }
      }
      const out = dec.observe(call, { status: res.status, headers: res.headers, body })
      if (out && typeof out.userSafeMessage === "string" && out.userSafeMessage.trim()) {
        userSafeMarks.set(res, out.userSafeMessage)
      }
    } catch (err) {
      console.error(`[egress] observe threw for ${call.provider}/${call.operation}`, err)
    }
  }

  return res
}
