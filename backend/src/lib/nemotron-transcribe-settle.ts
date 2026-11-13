import {
  addCaptionsNemotronMinutesId,
  nemotronTranscribeStartedMinutes,
  parseAddCaptionsNemotronCreditId,
  parseNemotronTranscribeCreditId,
  NEMOTRON_TRANSCRIBE_ID,
  NEMOTRON_TRANSCRIBE_PRICING,
} from "@nodaro/shared/credits"
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
 * One rule for the Transcribe node (its worker, `handleTranscribe`, and the KIE
 * reconcile) and for Add Captions transcribing on Nemotron (its render worker,
 * decided 2026-11-13), each through its own family of per-minute ids
 * ({@link NemotronMinuteIds}), and exactly ONE commit either way:
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

/**
 * A family of per-started-minute ids a Nemotron run is held and charged on:
 * how one is built from minutes and read back, and the tag its logs carry.
 */
export interface NemotronMinuteIds {
  /** The id for N started minutes (1..60). */
  readonly idOf: (minutes: number) => string
  /** The minutes of one of this family's ids, or undefined for any other id. */
  readonly parse: (id: string) => { minutes: number } | undefined
  /** The tag on this family's log lines. */
  readonly label: string
}

/** The Transcribe node's ids: `nemotron-3-5-transcribe:<N>m`. */
export const NEMOTRON_TRANSCRIBE_MINUTE_IDS: NemotronMinuteIds = {
  idOf: (minutes) => `${NEMOTRON_TRANSCRIBE_ID}:${minutes}m`,
  parse: parseNemotronTranscribeCreditId,
  label: "transcribe",
}

/** Add Captions transcribing on Nemotron: `add-captions:kinetic:nemotron:<N>m` (the render plus the minutes). */
export const ADD_CAPTIONS_NEMOTRON_MINUTE_IDS: NemotronMinuteIds = {
  idOf: addCaptionsNemotronMinutesId,
  parse: parseAddCaptionsNemotronCreditId,
  label: "add-captions",
}

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
export function nemotronChargeId(
  heldId: string | undefined,
  kieSec: number,
  ids: NemotronMinuteIds = NEMOTRON_TRANSCRIBE_MINUTE_IDS,
): string {
  const held = heldId === undefined ? undefined : ids.parse(heldId)
  if (held && kieSec > held.minutes * 60 && kieSec <= held.minutes * 60 + NEMOTRON_UPWARD_GRACE_SEC) return heldId!
  return ids.idOf(nemotronTranscribeStartedMinutes(kieSec))
}

/** What a Nemotron run's charge is decided from. */
export interface NemotronChargeFacts {
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

export interface NemotronSettle extends NemotronChargeFacts {
  readonly usageLogId: string | null | undefined
}

/**
 * The id a finished Nemotron run is charged at, by the rule above — or
 * `undefined` when there is no length to charge on (the hold is committed as
 * it is). Logs the warnings and `[ALERT]`s; commits nothing, so a caller that
 * must know the charge before the job completes (a render held for review)
 * can decide first and commit after.
 */
export function nemotronChargeDecision(
  s: NemotronChargeFacts,
  ids: NemotronMinuteIds = NEMOTRON_TRANSCRIBE_MINUTE_IDS,
): string | undefined {
  const reported = positiveSeconds(s.kieSec)
  const fromCredits = nemotronSecondsFromKieCredits(s.kieCredits)
  const measured = positiveSeconds(s.measuredSec)
  const chargeSec = reported ?? fromCredits ?? measured
  if (chargeSec === undefined) {
    const unmeasuredFullHold = s.heldId === ids.idOf(NEMOTRON_TRANSCRIBE_PRICING.MAX_MINUTES)
    if (unmeasuredFullHold) {
      console.error(
        `[ALERT] [${ids.label}] job ${s.jobId}: an unmeasured file and no length from KIE (no duration, no credits) — ` +
          `committing the whole 60-minute hold`,
      )
    } else {
      console.warn(`[${ids.label}] job ${s.jobId}: no length from KIE or the measurement — committing the held price`)
    }
    return undefined
  }
  if (reported === undefined) {
    console.warn(
      `[${ids.label}] job ${s.jobId}: KIE reported no duration — charging ${Math.round(chargeSec)} s ` +
        `(${fromCredits !== undefined ? "from its billed credits" : "the measured length"})`,
    )
  }
  const chargeId = nemotronChargeId(s.heldId, chargeSec, ids)
  if (s.heldId !== chargeId && nemotronLengthsDisagree(measured, chargeSec)) {
    console.error(
      `[ALERT] [${ids.label}] job ${s.jobId}: the file measured ${Math.round(measured!)} s but KIE decoded ` +
        `${Math.round(chargeSec)} s — held ${s.heldId ?? "unknown"}, charged ${chargeId}`,
    )
  }
  return chargeId
}

/**
 * The ONE commit of a decided charge: the hold as it is when the charge is the
 * held id (or there is none), else the charged price — up or down.
 */
export async function commitNemotronCharge(
  usageLogId: string | null | undefined,
  jobId: string,
  heldId: string | undefined,
  chargeId: string | undefined,
): Promise<void> {
  if (chargeId === undefined || chargeId === heldId) {
    await commitJobCredits(usageLogId, jobId)
    return
  }
  await commitJobCreditsAtActualPrice(usageLogId, jobId, chargeId)
}

export async function settleNemotronTranscribe(
  s: NemotronSettle,
  ids: NemotronMinuteIds = NEMOTRON_TRANSCRIBE_MINUTE_IDS,
): Promise<void> {
  await commitNemotronCharge(s.usageLogId, s.jobId, s.heldId, nemotronChargeDecision(s, ids))
}
