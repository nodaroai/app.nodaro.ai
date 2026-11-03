import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { hasAdmin } from "@/lib/edition"
import { queryKeys } from "@/lib/query-keys"
import { send, useCaseMove } from "./use-admin-complaints-queries"

/**
 * Admin → an account's record under the repeat-infringer policy (backend
 * ee/routes/admin-repeat-infringers.ts, ee/lib/account-record.ts): the record
 * is read with its case; the moves on it (record and withdraw an
 * infringement, take and lift a measure, unblock the account) and the policy
 * itself. Every move refreshes the whole ["admin", "complaints"] family, as
 * the case's other moves do.
 */

export const MEASURE_KINDS = ["warning", "imports_blocked", "closed"] as const
export type MeasureKind = (typeof MEASURE_KINDS)[number]

/** The longest import block, in days (as the server takes it). */
export const MAX_BLOCK_DAYS = 3650

export interface PolicyStep {
  /** The standing infringements in the window from which this step applies. */
  readonly infringements: number
  readonly kind: MeasureKind
  /** An import block's length in days; absent: until lifted. */
  readonly days?: number
}

export interface RepeatInfringerPolicy {
  readonly windowMonths: number
  readonly steps: readonly PolicyStep[]
}

export interface StoredRepeatInfringerPolicy {
  readonly policy: RepeatInfringerPolicy
  /** False: never saved, the default applies. */
  readonly saved: boolean
  readonly updatedAt: string | null
}

/** A matched account's standing: its infringements within the window, and the measures in force by kind. */
export interface AccountStanding {
  readonly inWindow: number
  readonly inForce: readonly MeasureKind[]
}

export interface RecordInfringement {
  readonly id: string
  readonly complaintId: string
  readonly caseReference: string | null
  readonly caseStatus: string | null
  readonly caseKind: "copyright" | "other" | null
  readonly note: string | null
  readonly recordedAt: string
  readonly withdrawnAt: string | null
  readonly withdrawReason: string | null
  /** Standing and within the window: it counts. */
  readonly counts: boolean
  /** The account's content on that case was restored after its counter-notice. */
  readonly restoredAfterCounterNotice: boolean
}

export interface RecordMeasure {
  readonly id: string
  readonly kind: MeasureKind
  readonly appliedAt: string
  readonly endsAt: string | null
  /** What the account's owner was told. */
  readonly reason: string
  readonly note: string | null
  readonly complaintId: string | null
  readonly caseReference: string | null
  readonly infringementId: string | null
  readonly infringementsInWindow: number
  /** The step it followed, as the policy read then; null when the administrator departed from it. */
  readonly policyStep: Record<string, unknown> | null
  readonly departureReason: string | null
  readonly liftedAt: string | null
  readonly liftReason: string | null
  readonly inForce: boolean
}

/** The record of the account a case names. */
export interface AccountRecord {
  readonly userId: string
  readonly windowMonths: number
  readonly inWindow: number
  /** The step the policy names for that count: what the next measure follows. */
  readonly step: PolicyStep | null
  readonly infringements: readonly RecordInfringement[]
  readonly measures: readonly RecordMeasure[]
  /** Whether the account is blocked now; null when that could not be read. */
  readonly blocked: boolean | null
  /** The block itself, when there is one: its reason (a closure's names its case) and when it was placed. */
  readonly block: { readonly reason: string | null; readonly blockedAt: string } | null
}

const casePath = (id: string, move: string) => `/v1/admin/complaints/${encodeURIComponent(id)}/${move}`

/** Records an infringement against the account the screen showed the case naming (`userId`): refused when the case names another now. */
export function useRecordInfringement() {
  return useCaseMove<{ complaintId: string; userId: string; note: string | null }>(
    (i) => casePath(i.complaintId, "infringement"),
    (i) => ({ userId: i.userId, note: i.note }),
    "Failed to record the infringement",
  )
}

export function useWithdrawInfringement() {
  return useCaseMove<{ infringementId: string; reason: string }>(
    (i) => `/v1/admin/infringements/${encodeURIComponent(i.infringementId)}/withdraw`,
    (i) => ({ reason: i.reason }),
    "Failed to withdraw the infringement",
  )
}

export interface ApplyMeasureInput {
  readonly complaintId: string
  /** The account the screen showed the case naming: refused when the case names another now. */
  readonly userId: string
  readonly kind: MeasureKind
  /** An import block's length; null: until lifted. */
  readonly days: number | null
  readonly reason: string
  readonly note: string | null
  readonly infringementId: string | null
  readonly departureReason: string | null
}

export interface AppliedMeasure {
  readonly data: {
    readonly id: string
    readonly kind: MeasureKind
    readonly endsAt: string | null
    readonly followsPolicy: boolean
    /** A closure: whether sign-in is refused now. */
    readonly signInBlocked: boolean | null
    readonly warning: string | null
  }
}

export function useApplyMeasure() {
  return useCaseMove<ApplyMeasureInput, AppliedMeasure>(
    (i) => casePath(i.complaintId, "measure"),
    (i) => ({
      userId: i.userId,
      kind: i.kind,
      ...(i.kind === "imports_blocked" ? { days: i.days } : {}),
      reason: i.reason,
      note: i.note,
      infringementId: i.infringementId,
      departureReason: i.departureReason,
    }),
    "Failed to take the measure",
  )
}

export interface LiftedMeasure {
  readonly data: { readonly id: string; readonly kind: MeasureKind; readonly liftedAt: string; readonly stillBlocked: boolean | null }
}

export function useLiftMeasure() {
  return useCaseMove<{ measureId: string; reason: string }, LiftedMeasure>(
    (i) => `/v1/admin/measures/${encodeURIComponent(i.measureId)}/lift`,
    (i) => ({ reason: i.reason }),
    "Failed to lift the measure",
  )
}

export interface UnblockedAccount {
  /** Set when the account is unblocked but its sign-in could not be: the screen says so. */
  readonly data: { readonly blocked: false; readonly signInBlocked: boolean | null; readonly warning: string | null }
}

/** Unblocks the account from its case, by the account page's own route (backend ee/routes/admin-access.ts). */
export function useUnblockAccount() {
  return useCaseMove<{ userId: string }, UnblockedAccount>((i) => `/v1/admin/users/${encodeURIComponent(i.userId)}/unblock`, () => undefined, "Failed to unblock the account")
}

const POLICY_PATH = "/v1/admin/repeat-infringer-policy"

export function useRepeatInfringerPolicy() {
  return useQuery({
    queryKey: queryKeys.admin.repeatInfringerPolicy(),
    queryFn: () => send<{ data: StoredRepeatInfringerPolicy }>(POLICY_PATH, {}, "Failed to load the repeat-infringer policy").then((r) => r.data),
    enabled: hasAdmin(),
    staleTime: 60_000,
  })
}

export function useSaveRepeatInfringerPolicy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (policy: RepeatInfringerPolicy) =>
      send<{ data: StoredRepeatInfringerPolicy }>(POLICY_PATH, { method: "PUT", body: JSON.stringify(policy) }, "Failed to save the repeat-infringer policy").then((r) => r.data),
    onSettled: () => qc.invalidateQueries({ queryKey: ["admin", "complaints"] }),
  })
}
