import type { MessageKey } from "@/lib/i18n/en"
import type { TelegramLoginFailure } from "@/lib/api"
import type { FormError } from "./use-telegram-login"

/** Why a connect attempt ended, in the owner's words — one key per server reason. */
export const FAILURE_MESSAGE: Readonly<Record<TelegramLoginFailure, MessageKey>> = {
  expired: "tgacct.fail.expired",
  cancelled: "tgacct.fail.cancelled",
  account_disabled: "tgacct.fail.account_disabled",
  too_many_accounts: "tgacct.fail.too_many_accounts",
  too_many_tries: "tgacct.fail.too_many_tries",
  flood_wait: "tgacct.fail.flood_wait",
  rate_limited: "tgacct.fail.rate_limited",
  phone_invalid: "tgacct.fail.phone_invalid",
  code_expired: "tgacct.fail.code_expired",
  login_unavailable: "tgacct.fail.login_unavailable",
  api_credentials_invalid: "tgacct.fail.api_credentials_invalid",
  network: "tgacct.fail.network",
  internal: "tgacct.fail.internal",
}

/** Why the form could not start an attempt at all. */
export const FORM_ERROR_MESSAGE: Readonly<Record<FormError, MessageKey>> = {
  rate_limited: "tgacct.form.rate_limited",
  consent_outdated: "tgacct.form.consent_outdated",
  unavailable: "tgacct.form.unavailable",
  invalid: "tgacct.form.invalid",
  unknown: "tgacct.form.unknown",
}

/** The owner-facing label of an account status; an unknown status reads as itself. */
export const STATUS_MESSAGE: Readonly<Record<string, MessageKey>> = {
  active: "tgacct.status.active",
  paused: "tgacct.status.paused",
  revoked: "tgacct.status.revoked",
  disabled: "tgacct.status.disabled",
}
