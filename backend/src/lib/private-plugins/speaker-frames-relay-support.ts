import { hasCredits } from "../config.js"
import { getPluginSupports } from "./supports-registry.js"
import type { PluginSupports } from "./types.js"

/**
 * THE answer to "can Speaker Frames run from this install?" for the relay
 * (P3.6, decided 2026-10-09: build the node now; a connected self-host gets a
 * clear "not available on a connected install yet" until the plugin side
 * lands). Read by `GET /v1/speaker-frames/capabilities`, the self-host's
 * `POST /v1/speaker-frames` shim and the relay worker.
 *
 *   - nodaro.ai (`hasCredits()`): whether its loaded plugin accepts a RELAYED
 *     job — `supports().speakerFramesRelayedProxies` (the proxies + the
 *     relayed marker, P3-15 (a), P3-23 (b)). No call out.
 *   - A self-host CONNECTED to nodaro.ai: what nodaro.ai answers on its own
 *     `GET /v1/speaker-frames/capabilities`, over the relay's credential,
 *     cached for `SPEAKER_FRAMES_RELAY_TTL_MS`. A 404 (a nodaro.ai from before
 *     the route) is an answer: no. Unreachable fails CLOSED and says so
 *     (`source: "nodaro.ai-unreachable"`), cached only briefly, so the worker
 *     retries instead of refusing for good — the Edit Plan modes arrangement
 *     (`plannable-edit-plan-modes.ts`). A 401/403 is NOT unreachability: the
 *     install's credential was revoked or has expired
 *     (`source: "nodaro.ai-rejected"`), which no retry fixes; cached as briefly,
 *     so a reconnect is picked up at once.
 *   - A self-host NOT connected: no (`source: "not-connected"`). The route asks
 *     for a connection before it gets here, but a workflow run reaches the
 *     relay worker without the route, so the answer says why.
 *
 * `speakerFramesRelayRefusal` turns a "no" into the one refusal the route and
 * the worker both give.
 */
import {
  NODARO_CONNECTION_REJECTED_MESSAGE,
  NODARO_CONNECTION_REQUIRED_CODE,
  NODARO_CONNECTION_REQUIRED_MESSAGE,
} from "../nodaro-connection-messages.js"

export const SPEAKER_FRAMES_RELAY_TTL_MS = 60_000
/** Under the video queue's first retry delay, so a retried job asks again. */
export const SPEAKER_FRAMES_RELAY_FAILURE_TTL_MS = 4_000
const CLOUD_TIMEOUT_MS = 3_000
const CAPABILITIES_PATH = "/v1/speaker-frames/capabilities"

export interface SpeakerFramesRelayAnswer {
  readonly relay: boolean
  readonly source: "server" | "nodaro.ai" | "nodaro.ai-unreachable" | "nodaro.ai-rejected" | "not-connected"
}

export interface SpeakerFramesRelaySupportDeps {
  hasCredits: () => boolean
  getPluginSupports: () => PluginSupports
  isNodaroConnected: () => Promise<boolean>
  cloudFetch: (path: string, init?: RequestInit) => Promise<Response>
  now: () => number
}

const defaultDeps: SpeakerFramesRelaySupportDeps = {
  hasCredits,
  getPluginSupports,
  isNodaroConnected: async () => (await import("../nodaro-connect.js")).isNodaroConnected(),
  cloudFetch: async (path, init) => (await import("../nodaro-connect.js")).nodaroCloudFetch(path, init),
  now: () => Date.now(),
}

let cached: { answer: SpeakerFramesRelayAnswer; until: number } | null = null
let inflight: Promise<SpeakerFramesRelayAnswer> | null = null

async function askNodaroAi(deps: SpeakerFramesRelaySupportDeps): Promise<SpeakerFramesRelayAnswer> {
  try {
    const res = await deps.cloudFetch(CAPABILITIES_PATH, { method: "GET", signal: AbortSignal.timeout(CLOUD_TIMEOUT_MS) })
    let relay = false
    if (res.status === 401 || res.status === 403) {
      const answer: SpeakerFramesRelayAnswer = { relay: false, source: "nodaro.ai-rejected" }
      cached = { answer, until: deps.now() + SPEAKER_FRAMES_RELAY_FAILURE_TTL_MS }
      return answer
    }
    if (res.status !== 404) {
      if (!res.ok) throw new Error(`nodaro.ai answered ${res.status}`)
      const body = (await res.json()) as { relay?: unknown } | null
      relay = body?.relay === true
    }
    const answer: SpeakerFramesRelayAnswer = { relay, source: "nodaro.ai" }
    cached = { answer, until: deps.now() + SPEAKER_FRAMES_RELAY_TTL_MS }
    return answer
  } catch {
    const answer: SpeakerFramesRelayAnswer = { relay: false, source: "nodaro.ai-unreachable" }
    cached = { answer, until: deps.now() + SPEAKER_FRAMES_RELAY_FAILURE_TTL_MS }
    return answer
  }
}

export async function speakerFramesRelaySupport(deps: SpeakerFramesRelaySupportDeps = defaultDeps): Promise<SpeakerFramesRelayAnswer> {
  if (deps.hasCredits()) return { relay: deps.getPluginSupports().speakerFramesRelayedProxies === true, source: "server" }
  const connected = await deps.isNodaroConnected().catch(() => false)
  if (!connected) return { relay: false, source: "not-connected" }
  if (cached && deps.now() < cached.until) return cached.answer
  if (!inflight) {
    inflight = askNodaroAi(deps).finally(() => {
      inflight = null
    })
  }
  return inflight
}

/** The refusal a connected self-host answers while nodaro.ai does not take a
 *  relayed Speaker Frames job (decided 2026-10-09). */
export const SPEAKER_FRAMES_RELAY_UNAVAILABLE_CODE = "speaker_frames_relay_unavailable"
export const SPEAKER_FRAMES_RELAY_UNAVAILABLE_MESSAGE =
  "Speaker Frames is not available on a connected install yet — run it on nodaro.ai for now."
export const SPEAKER_FRAMES_RELAY_UNREACHABLE_MESSAGE =
  "Couldn't reach nodaro.ai to check whether it runs Speaker Frames for a connected install — try again in a moment."

/** Why a "no" answer refuses, as the route answers it (status, code, words)
 *  and whether the worker should let the queue retry. `null` for a yes. */
export interface SpeakerFramesRelayRefusal {
  readonly status: 503
  readonly code: string
  readonly message: string
  /** Only an outage is worth a retry; every other "no" is the same answer seconds later. */
  readonly retryable: boolean
}

export function speakerFramesRelayRefusal(answer: SpeakerFramesRelayAnswer): SpeakerFramesRelayRefusal | null {
  if (answer.relay) return null
  switch (answer.source) {
    case "not-connected":
      return { status: 503, code: NODARO_CONNECTION_REQUIRED_CODE, message: NODARO_CONNECTION_REQUIRED_MESSAGE, retryable: false }
    // A revoked or expired credential: the remedy is the connection's, so it
    // answers the connection code, with the reason.
    case "nodaro.ai-rejected":
      return { status: 503, code: NODARO_CONNECTION_REQUIRED_CODE, message: NODARO_CONNECTION_REJECTED_MESSAGE, retryable: false }
    case "nodaro.ai-unreachable":
      return { status: 503, code: SPEAKER_FRAMES_RELAY_UNAVAILABLE_CODE, message: SPEAKER_FRAMES_RELAY_UNREACHABLE_MESSAGE, retryable: true }
    default:
      return { status: 503, code: SPEAKER_FRAMES_RELAY_UNAVAILABLE_CODE, message: SPEAKER_FRAMES_RELAY_UNAVAILABLE_MESSAGE, retryable: false }
  }
}

/** Test seam — the cache is process-global. */
export function _resetSpeakerFramesRelaySupportForTests(): void {
  cached = null
  inflight = null
}
