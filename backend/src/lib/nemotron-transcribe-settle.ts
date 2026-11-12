import { nemotronTranscribeCreditId, nemotronTranscribeStartedMinutes, parseNemotronTranscribeCreditId, NEMOTRON_TRANSCRIBE_PRICING } from "@nodaro/shared/credits"
import { nemotronSecondsFromKieCredits } from "../providers/audio/nemotron-output.js"
import { commitJobCredits, commitJobCreditsAtActualPrice } from "../workers/shared.js"

/**
 * Nemotron 3.5 Transcribe is HELD at the minutes the file's header declares
 * (`lib/nemotron-transcribe-input.ts`) and CHARGED for the minutes KIE reports
 * it decoded — its `duration`, in started minutes, with the hold's own
 * per-minute rounding (decided 2026-11-12). A header can misstate a file's
 * length (a VBR MP3 without a Xing header: 60 s declared for 3:00 decoded) and
 * a host can serve ffprobe and KIE different files; KIE's length is what KIE
 * bills us and what the run costs.
 *
 * One function for the worker (`handleTranscribe`) and the KIE reconcile, and
 * exactly ONE commit either way:
 *  - the charged minutes are the held minutes → the reserved tier
 *    (`commitJobCredits`), byte for byte the plain path;
 *  - fewer → the lower price is committed and the rest released;
 *  - more → the overrun is collected from the payer's balance, as a metered LLM
 *    call's is (`commitJobCreditsAtActualPrice` → `commit_credits_metered`).
 *
 * The length charged on, in order: KIE's `duration`; else the seconds KIE's
 * `creditsConsumed` stands for (it bills this model by the second); else the
 * length measured before the run; and only then the hold itself — a 60-minute
 * hold on a file nobody could measure then committed whole is an `[ALERT]`.
 *
 * A grace of {@link NEMOTRON_UPWARD_GRACE_SEC} upward (decided 2026-11-12): a
 * KIE length at most that far past the held minutes' boundary (held `:1m`, KIE
 * 60.05 s) is charged the held minutes. Only upward; a shorter KIE length
 * still settles down.
 */

/** How far past the held minutes' boundary a KIE length may run and still be charged the held minutes. */
export const NEMOTRON_UPWARD_GRACE_SEC = 1

function positiveSeconds(v: number | undefined): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined
}

/**
 * Whether the measured length and KIE's disagree enough to look at: they fall
 * in different started minutes AND differ by more than one minute, or by more
 * than 20 % of KIE's length. A file whose length was not measured (held at 60
 * minutes) has nothing to disagree with.
 */
export function nemotronLengthsDisagree(measuredSec: number | undefined, kieSec: number): boolean {
  if (measuredSec === undefined) return false
  if (nemotronTranscribeStartedMinutes(measuredSec) === nemotronTranscribeStartedMinutes(kieSec)) return false
  const diff = Math.abs(measuredSec - kieSec)
  return diff > 60 || diff > 0.2 * kieSec
}

/** The id a run is charged at: KIE's started minutes, or the held minutes when KIE ran past them by at most the grace. */
export function nemotronChargeId(heldId: string | undefined, kieSec: number): string {
  const held = heldId === undefined ? undefined : parseNemotronTranscribeCreditId(heldId)
  if (held && kieSec > held.minutes * 60 && kieSec <= held.minutes * 60 + NEMOTRON_UPWARD_GRACE_SEC) return heldId!
  return nemotronTranscribeCreditId(kieSec)
}

export interface NemotronSettle {
  readonly usageLogId: string | null | undefined
  readonly jobId: string
  /** The id the run held (`bucketKey`: the measured minutes, or the 60-minute id). */
  readonly heldId?: string
  /** The length the route or the workflow run measured, when it could. */
  readonly measuredSec?: number
  /** The length KIE reports it decoded and billed. */
  readonly kieSec?: number
  /** KIE's `creditsConsumed` for the task (0.3 a minute, by the second). */
  readonly kieCredits?: number
}

export async function settleNemotronTranscribe(s: NemotronSettle): Promise<void> {
  const reported = positiveSeconds(s.kieSec)
  const fromCredits = nemotronSecondsFromKieCredits(s.kieCredits)
  const measured = positiveSeconds(s.measuredSec)
  const chargeSec = reported ?? fromCredits ?? measured
  if (chargeSec === undefined) {
    const unmeasuredFullHold = s.heldId === nemotronTranscribeCreditId(NEMOTRON_TRANSCRIBE_PRICING.MAX_DURATION_SEC)
    if (unmeasuredFullHold) {
      console.error(
        `[ALERT] [transcribe] job ${s.jobId}: an unmeasured file and no length from KIE (no duration, no credits) — ` +
          `committing the whole 60-minute hold`,
      )
    } else {
      console.warn(`[transcribe] job ${s.jobId}: no length from KIE or the measurement — committing the held price`)
    }
    await commitJobCredits(s.usageLogId, s.jobId)
    return
  }
  if (reported === undefined) {
    console.warn(
      `[transcribe] job ${s.jobId}: KIE reported no duration — charging ${Math.round(chargeSec)} s ` +
        `(${fromCredits !== undefined ? "from its billed credits" : "the measured length"})`,
    )
  }
  const chargeId = nemotronChargeId(s.heldId, chargeSec)
  if (s.heldId !== chargeId && nemotronLengthsDisagree(measured, chargeSec)) {
    console.error(
      `[ALERT] [transcribe] job ${s.jobId}: the file measured ${Math.round(measured!)} s but KIE decoded ` +
        `${Math.round(chargeSec)} s — held ${s.heldId ?? "unknown"}, charged ${chargeId}`,
    )
  }
  if (s.heldId === chargeId) {
    await commitJobCredits(s.usageLogId, s.jobId)
    return
  }
  await commitJobCreditsAtActualPrice(s.usageLogId, s.jobId, chargeId)
}
