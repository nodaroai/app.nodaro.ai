/**
 * The one poll loop every subcommand uses.
 *
 * Deliberately NOT `nodes.runAndWait`: that helper throws on `cancelled`, which
 * is exactly the state the lifecycle probe needs to keep watching THROUGH. It
 * also stops at the terminal tick, and the "no late output published" check
 * only means anything if something keeps looking afterwards.
 *
 * Two rules the loop is built around:
 *   - a failed status GET is a TRANSPORT failure, not a job failure. It is
 *     retried; the job is never resubmitted. The pilot lost a run to a
 *     transient 502 once and resumed polling rather than paying twice.
 *   - every status change is recorded with a timestamp, because phase timing is
 *     one of the things the acceptance run exists to produce.
 */
import { createHash } from "node:crypto"

export const TERMINAL_STATUSES = Object.freeze(["completed", "failed", "cancelled"])
/** In-flight but parked on a human — progresses only when a reviewer acts. */
export const HELD_STATUS = "pending_review"

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function isTerminal(status) {
  return TERMINAL_STATUSES.includes(status)
}

/**
 * The engine's own PHASE, when the running job publishes one.
 *
 * `status` has four in-flight values and none of them is "planning" or
 * "rendering" — a durable multi-stage parent that wants those visible has to
 * put them somewhere, and `output_data` is the only place a status poll can
 * see. This reads whichever of the conventional keys is present and returns
 * `null` otherwise, so a deployment that publishes nothing degrades to
 * status-only timing rather than to a wrong phase name.
 */
export function phaseOf(snapshot) {
  const output = snapshot?.output_data
  if (!output || typeof output !== "object") return null
  for (const key of ["stage", "phase", "step", "state"]) {
    const value = output[key]
    if (typeof value === "string" && value.trim() !== "") return value.trim()
  }
  return null
}

export function hashOutput(output) {
  if (output === undefined || output === null) return null
  return createHash("sha256").update(JSON.stringify(output)).digest("hex")
}

/**
 * Does this observation satisfy the `--cancel-at` trigger?
 *
 * Pure so the trigger semantics are testable without starting a paid job.
 */
export function shouldCancel(trigger, { status, progress, elapsedMs, phase } = {}) {
  if (!trigger) return false
  if (trigger.kind === "status") return status === trigger.status
  if (trigger.kind === "progress") return typeof progress === "number" && progress >= trigger.progress
  if (trigger.kind === "seconds") return elapsedMs >= trigger.seconds * 1000
  // A named phase matches EITHER the engine's published phase or a status
  // spelled the same way, so `--cancel-at rendering` works on a deployment
  // that publishes phases and `--cancel-at processing` still works on one
  // that does not.
  if (trigger.kind === "phase") return phase === trigger.name || status === trigger.name
  return false
}

/**
 * Follow a job to a terminal state, recording every transition.
 *
 * `onTransition` is called only when something CHANGES — a 30-minute run at a
 * 3-second poll is 600 identical ticks, and a transition log that repeats them
 * is not a phase timeline.
 */
export async function followJob(client, jobId, options = {}) {
  const {
    pollMs = 3000,
    timeoutMs = 60 * 60_000,
    cancelTrigger = null,
    onTransition = () => {},
    graceMs = 0,
    maxTransportRetries = 8,
  } = options

  const startedAt = Date.now()
  const transitions = []
  let lastKey = null
  let cancelRequested = null
  let terminalStatus = null
  let terminalAt = null
  let terminalCount = 0
  let lastOutputHash = null
  let lastOutput = null
  let lateChange = null
  let held = false
  let transportErrors = []
  let consecutiveTransportErrors = 0
  const phasesSeen = []

  for (;;) {
    const elapsedMs = Date.now() - startedAt
    let snapshot
    try {
      const { data } = await client.jobs.getStatus(jobId)
      snapshot = data
      consecutiveTransportErrors = 0
    } catch (error) {
      consecutiveTransportErrors++
      transportErrors.push({ at: new Date().toISOString(), message: String(error?.message ?? error) })
      if (consecutiveTransportErrors > maxTransportRetries) {
        throw new Error(`job ${jobId}: ${consecutiveTransportErrors} consecutive status failures — giving up WITHOUT resubmitting`)
      }
      await sleep(Math.min(pollMs * consecutiveTransportErrors, 30_000))
      continue
    }

    const phase = phaseOf(snapshot)
    if (phase !== null && !phasesSeen.includes(phase)) phasesSeen.push(phase)
    const key = `${snapshot.status}:${snapshot.progress ?? ""}:${phase ?? ""}`
    if (key !== lastKey) {
      const entry = {
        at: new Date().toISOString(),
        elapsedMs,
        status: snapshot.status,
        phase,
        progress: snapshot.progress ?? null,
        creditStatus: snapshot.credit_status ?? null,
      }
      transitions.push(entry)
      lastKey = key
      onTransition(entry, snapshot)
    }

    const outputHash = hashOutput(snapshot.output_data)
    if (terminalStatus !== null) {
      if (snapshot.status !== terminalStatus) {
        lateChange = lateChange ?? { kind: "status-flip", from: terminalStatus, to: snapshot.status, at: new Date().toISOString() }
      }
      if (outputHash !== lastOutputHash) {
        lateChange = lateChange ?? { kind: "output-changed", at: new Date().toISOString() }
      }
    }
    lastOutputHash = outputHash
    lastOutput = snapshot.output_data ?? null

    if (snapshot.status === HELD_STATUS) held = true

    if (!cancelRequested && shouldCancel(cancelTrigger, { status: snapshot.status, progress: snapshot.progress, elapsedMs, phase })) {
      const requestedAt = new Date().toISOString()
      try {
        const result = await client.jobs.cancel(jobId)
        cancelRequested = { at: requestedAt, ok: true, result, observedStatus: snapshot.status, observedPhase: phase, observedProgress: snapshot.progress ?? null, elapsedMs }
      } catch (error) {
        cancelRequested = { at: requestedAt, ok: false, error: String(error?.message ?? error), observedStatus: snapshot.status, observedPhase: phase, elapsedMs }
      }
      onTransition({ at: requestedAt, elapsedMs, status: "cancel-requested", phase, progress: snapshot.progress ?? null }, snapshot)
    }

    if (isTerminal(snapshot.status)) {
      if (terminalStatus === null) {
        terminalStatus = snapshot.status
        terminalAt = Date.now()
        terminalCount = 1
      } else if (snapshot.status !== terminalStatus) {
        terminalCount++
      }
      if (graceMs <= 0 || Date.now() - terminalAt >= graceMs) break
    }

    if (Date.now() - startedAt > timeoutMs) {
      return finish({ timedOut: true })
    }
    await sleep(pollMs)
  }

  return finish({ timedOut: false })

  function finish({ timedOut }) {
    return {
      jobId,
      transitions,
      phasesSeen,
      terminalStatus,
      terminalCount,
      distinctTerminalStates: terminalStatus === null ? 0 : terminalCount,
      lateChange,
      held,
      cancel: cancelRequested,
      outputHash: lastOutputHash,
      output: lastOutput,
      transportErrors,
      timedOut,
      elapsedMs: Date.now() - startedAt,
      startedAt: new Date(startedAt).toISOString(),
    }
  }
}

/**
 * The full job row, read once at the end.
 *
 * `getStatus` is the poll-friendly projection and deliberately omits
 * `input_data` and the timestamp columns; the timings and the parity check both
 * need those, so the loop stays lean and this pays for the detail once.
 */
export async function readJobRecord(client, jobId) {
  const { data } = await client.jobs.get(jobId)
  return data
}

/** Per-phase durations derived from the job's OWN timestamps, not the poller's. */
export function phaseTimings(job, follow) {
  const created = job?.created_at ? Date.parse(job.created_at) : null
  const started = job?.started_at ? Date.parse(job.started_at) : null
  const completed = job?.completed_at ? Date.parse(job.completed_at) : null
  const firstProcessing = follow?.transitions?.find((t) => t.status === "processing")
  return {
    createdAt: job?.created_at ?? null,
    startedAt: job?.started_at ?? null,
    completedAt: job?.completed_at ?? null,
    queueMs: created !== null && started !== null ? started - created : null,
    workMs: started !== null && completed !== null ? completed - started : null,
    totalMs: created !== null && completed !== null ? completed - created : null,
    observedWallMs: follow?.elapsedMs ?? null,
    observedFirstProcessingMs: firstProcessing?.elapsedMs ?? null,
    perPhaseMs: segmentDurations(follow?.transitions ?? [], follow?.elapsedMs ?? null),
    transitions: follow?.transitions ?? [],
  }
}

/**
 * How long the run SAT in each observed status/phase.
 *
 * Derived from the transition timeline rather than from a field, because the
 * only thing the poller can honestly claim is "between these two observations
 * it read this". The last segment is closed with the observed wall clock.
 */
export function segmentDurations(transitions, endElapsedMs) {
  const out = {}
  for (let i = 0; i < transitions.length; i++) {
    const entry = transitions[i]
    if (entry.status === "cancel-requested") continue
    const next = transitions.slice(i + 1).find((t) => t.status !== "cancel-requested")
    const until = next ? next.elapsedMs : endElapsedMs
    if (typeof until !== "number" || typeof entry.elapsedMs !== "number") continue
    const key = entry.phase ? `${entry.status}:${entry.phase}` : entry.status
    out[key] = (out[key] ?? 0) + Math.max(0, until - entry.elapsedMs)
  }
  return out
}

export function percentile(values, p) {
  const sorted = [...values].filter((v) => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const rank = (p / 100) * (sorted.length - 1)
  const low = Math.floor(rank)
  const high = Math.ceil(rank)
  if (low === high) return sorted[low]
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low)
}
