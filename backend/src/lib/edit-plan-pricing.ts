import { buildEditPlanCreditId, parseEditPlanMode, asEditPlanTier } from "@nodaro/shared"
import { probeMediaDuration } from "../providers/video/ffmpeg-utils.js"

/**
 * Probe-at-reserve for an orchestrated edit-plan run — the DAG twin of the
 * plugin route's preHandler, which (per the review of nodaro-cloud-plugins)
 * ffprobes the MASTER source before reserving so the credit hold buckets on the
 * server-known media length, NEVER the request transcript's last word.
 *
 * The workflow path never touches that route. `buildPayload` reserves on the
 * master source NODE's own duration when it has one, else the transcript's last
 * word/segment (a LOWER bound — a transcript covers spoken words, so trailing
 * music / silence is not in it), else the 180-minute ceiling. A URL /
 * reference-audio master (whose `videoDuration` is a dead field and whose live
 * output is a bare URL) has no node duration, so speech ending just below a
 * bucket boundary + a real outro would bucket one level too low — and the
 * plugin's money gate (per the review: refuses when the re-probed master
 * exceeds the reserved bucket + a small tolerance) then fails the paid job. So
 * we ffprobe the master here too, exactly like `projectDubbingCreditOverride`
 * and `computeEditVideoProCreditOverride`, and rebuild the credit id from the
 * probed length. This yields the EXACT bucket (a 59.4-min episode → `:60m`),
 * zero spurious gate failures, and orchestrated↔REST parity.
 *
 * The probe runs for EVERY orchestrated edit-plan reserve, not only a
 * URL-master run: node-executor cannot see `buildPayload`'s internal masterRow
 * duration, and the plugin's design is probe-always regardless, so this is
 * parity — one ffprobe on a URL the plugin re-probes anyway — not over-reach.
 *
 * Returns the duration-correct credit id (and stamps `payload.reservedCreditId`,
 * which the gate reads, + `payload.probedDurationSec` for settlement/audit
 * parity with dubbing). Returns undefined when the master can't be probed
 * (unreachable / SSRF-blocked / no url) — `buildPayload`'s transcript-or-ceiling
 * basis, already baked into `reservedCreditId`/`modelIdentifier`, then stands as
 * the safe fallback BENEATH the probe. The caller keys the reservation + usage
 * log off the returned id so the reserve, the gate, and the usage log agree.
 */
export async function computeEditPlanReserveId(
  jobName: string,
  payload: Record<string, unknown>,
): Promise<string | undefined> {
  if (jobName !== "edit-plan") return undefined
  // An unknown mode is never re-priced as tighten (buildPayload refuses it
  // first; decided 2026-10-06). An absent one is the node default, tighten.
  const mode = payload.mode === undefined ? "tighten" : parseEditPlanMode(payload.mode)
  if (!mode) return undefined
  const sources = Array.isArray(payload.sources)
    ? (payload.sources as Array<Record<string, unknown>>)
    : []
  // Mirror buildPayload's masterRow selection: the declared master-audio
  // source, else the first source.
  const master = sources.find((s) => s?.role === "master-audio") ?? sources[0]
  const url = typeof master?.url === "string" ? master.url : undefined
  if (!url) return undefined
  let probedSec: number
  try {
    probedSec = await probeMediaDuration(url)
  } catch {
    // Unprobeable master (unreachable / SSRF-blocked / not media): fall back to
    // the transcript/ceiling basis buildPayload already reserved — never crash
    // the run and never lower the hold.
    return undefined
  }
  if (!Number.isFinite(probedSec) || probedSec <= 0) return undefined
  const creditId = buildEditPlanCreditId(
    mode,
    asEditPlanTier(payload.planTier),
    probedSec,
  )
  payload.reservedCreditId = creditId
  payload.probedDurationSec = Math.ceil(probedSec)
  return creditId
}
