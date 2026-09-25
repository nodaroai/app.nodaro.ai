import { tx, type MessageKey } from "@/lib/i18n"
import { DICTS } from "@/lib/i18n/dicts"
import { useLocaleStore } from "@/lib/locale-store"

/**
 * The text of a failed API call, in the interface language.
 *
 * The server answers `{ error: { code, message } }` with an English
 * `message`, and every client call names its own headline ("Failed to save
 * character") as a dictionary key. English keeps exactly what it always
 * showed: the server's words, else the headline — and so does a stub locale
 * that has no text of its own for the headline. Every other language shows
 * the headline, followed by a reason — translated when the code has a fixed
 * meaning, the server's own text when it carries specifics a code cannot
 * (a validation detail such as "No file provided").
 */

/**
 * Codes whose meaning is fixed, so a translated sentence can stand in for the
 * server's English. A code the server words case by case (`validation_error`,
 * `bad_request`) stays out: its message carries the detail. The `*_failed`
 * codes carry raw internal text (a Postgres error, a stack message), which
 * the translated sentence also keeps off the screen.
 */
const REASON_KEY_BY_CODE: Readonly<Record<string, MessageKey>> = {
  unauthorized: "apiErr.reason.signIn",
  forbidden: "apiErr.reason.forbidden",
  not_found: "apiErr.reason.notFound",
  internal_error: "apiErr.reason.server",
  internal: "apiErr.reason.server",
  server_error: "apiErr.reason.server",
  db_error: "apiErr.reason.server",
  storage_error: "apiErr.reason.server",
  delete_failed: "apiErr.reason.server",
  update_failed: "apiErr.reason.server",
  publish_failed: "apiErr.reason.server",
  restore_failed: "apiErr.reason.server",
  clone_failed: "apiErr.reason.server",
  snapshot_failed: "apiErr.reason.server",
  save_generated_failed: "apiErr.reason.server",
  read_failed: "apiErr.reason.server",
  redact_failed: "apiErr.reason.server",
  connect_failed: "apiErr.reason.server",
  caption_failed: "apiErr.reason.server",
  r2_upload_failed: "apiErr.reason.server",
  strategy_failed: "apiErr.reason.server",
  session_mint_failed: "apiErr.reason.server",
  credit_check_failed: "apiErr.reason.server",
  credit_reservation_failed: "apiErr.reason.server",
  credit_reservation_unavailable: "apiErr.reason.server",
  reservation_failed: "apiErr.reason.server",
  rate_limit_unavailable: "apiErr.reason.server",
  upstream_error: "apiErr.reason.external",
  proxy_error: "apiErr.reason.external",
  provider_down: "apiErr.reason.external",
  provider_error: "apiErr.reason.external",
  cloud_unreachable: "apiErr.reason.external",
  cloud_error: "apiErr.reason.external",
  cloud_stop_failed: "apiErr.reason.external",
  lookup_error: "apiErr.reason.external",
  llm_error: "apiErr.reason.ai",
  llm_failure: "apiErr.reason.ai",
  llm_empty_response: "apiErr.reason.ai",
  llm_unavailable: "apiErr.reason.ai",
  rate_limited: "apiErr.reason.tooManyRequests",
  rate_limit_exceeded: "apiErr.reason.limitReached",
  daily_limit_reached: "apiErr.reason.limitReached",
  job_blocked: "apiErr.reason.notAllowed",
  edition_required: "apiErr.reason.unavailableHere",
  not_available: "apiErr.reason.unavailableHere",
  feature_disabled: "apiErr.reason.unavailableHere",
  billing_unavailable: "apiErr.reason.billingUnavailable",
  conflict: "apiErr.reason.changedElsewhere",
  concurrent_modification: "apiErr.reason.changedElsewhere",
  revision_conflict: "apiErr.reason.changedElsewhere",
  workflow_conflict: "apiErr.reason.changedElsewhere",
  workflow_stale: "apiErr.reason.changedElsewhere",
  read_only: "apiErr.reason.readOnly",
  duplicate: "apiErr.reason.duplicate",
  insufficient_credits: "apiErr.reason.insufficientCredits",
  insufficient_app_credits: "apiErr.reason.insufficientCredits",
  storage_limit_exceeded: "apiErr.reason.storageFull",
  subscription_required: "apiErr.reason.subscriptionRequired",
}

/** The translated reason for a server error code, if the code has a fixed meaning. */
export function apiErrorReasonKey(code: string | undefined): MessageKey | undefined {
  return code !== undefined && Object.hasOwn(REASON_KEY_BY_CODE, code) ? REASON_KEY_BY_CODE[code] : undefined
}

/**
 * Whether the interface language has its own text for `key`. English, and a
 * stub locale that falls back to English, keep the server's own words — they
 * are already in the language on screen, and more specific than a headline.
 */
function speaksOwnLanguage(key: MessageKey): boolean {
  const locale = useLocaleStore.getState().locale
  return locale !== "en" && DICTS[locale]?.[key] !== undefined
}

export interface ApiErrorCopyInput {
  /** The server's machine-readable `error.code`, when it sent one. */
  readonly code?: string
  /** The server's English `error.message`, when it sent one. */
  readonly serverMessage?: string
  /** The calling action's headline ("Failed to save character"). */
  readonly fallbackKey: MessageKey
}

/** The message for a failed API call — see the module comment. */
export function apiErrorMessage({ code, serverMessage, fallbackKey }: ApiErrorCopyInput): string {
  const context = tx(fallbackKey)
  if (!speaksOwnLanguage(fallbackKey)) return serverMessage ?? context
  const reasonKey = apiErrorReasonKey(code)
  const reason = reasonKey ? tx(reasonKey) : serverMessage
  return reason ? tx("apiErr.withReason", { context, reason }) : context
}

/**
 * The message for a refusal that has its own dictionary sentence (a taken
 * name, a missing portrait): the server's words in English, the dictionary's
 * everywhere else.
 */
export function refusalMessage(serverMessage: string | undefined, key: MessageKey): string {
  return speaksOwnLanguage(key) ? tx(key) : (serverMessage ?? tx(key))
}
