import { ExternalLink, Loader2 } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { TelegramConsent } from "@/lib/api"
import { FORM_ERROR_MESSAGE } from "./login-messages"
import type { FormError } from "./use-telegram-login"

/**
 * The wizard's first step: the terms (served by the server — their copy is
 * not the app's), the owner's own api_id / api_hash, how to sign in, and —
 * right above Continue, where the eye already is — the box that accepts the
 * terms. QR is first and recommended: for a freshly created api_id, Telegram
 * may deliver a phone code only inside an already signed-in Telegram app,
 * never by SMS — the phone option says so up front.
 *
 * Continue is never a silent grey button: pressing it with something missing
 * names each missing thing where it is (`showMissing`) and focuses the first.
 */

export interface ConnectFormValues {
  readonly apiId: string
  readonly apiHash: string
  readonly method: "qr" | "phone"
  readonly phone: string
  readonly agreed: boolean
}

export const EMPTY_FORM: ConnectFormValues = { apiId: "", apiHash: "", method: "qr", phone: "", agreed: false }

export const isValidApiId = (value: string) => /^\d{1,12}$/.test(value.trim())
export const isValidApiHash = (value: string) => /^[0-9a-fA-F]{32}$/.test(value.trim())
/** Spaces, dashes and brackets are how people paste numbers; the server wants digits with an optional +. */
export const normalizePhone = (value: string) => value.replace(/[\s\-()]/g, "")
export const isValidPhone = (value: string) => /^\+?\d{7,15}$/.test(normalizePhone(value))

/** Element ids of the form's fields, in the order they appear on screen. */
export const FIELD_IDS = {
  apiId: "tg-api-id",
  apiHash: "tg-api-hash",
  phone: "tg-phone",
  agreed: "tg-consent",
} as const

/** The first field (in screen order) that still stops Continue, or null when the form is complete. */
export function firstMissingField(values: ConnectFormValues): (typeof FIELD_IDS)[keyof typeof FIELD_IDS] | null {
  if (!isValidApiId(values.apiId)) return FIELD_IDS.apiId
  if (!isValidApiHash(values.apiHash)) return FIELD_IDS.apiHash
  if (values.method === "phone" && !isValidPhone(values.phone)) return FIELD_IDS.phone
  if (!values.agreed) return FIELD_IDS.agreed
  return null
}

export function canSubmit(values: ConnectFormValues, consent: TelegramConsent | undefined): boolean {
  return consent !== undefined && firstMissingField(values) === null
}

interface ConnectFormProps {
  readonly values: ConnectFormValues
  readonly onChange: (patch: Partial<ConnectFormValues>) => void
  readonly consent: TelegramConsent | undefined
  readonly consentLoading: boolean
  /** Continue was pressed with something missing: say what, where it is. */
  readonly showMissing: boolean
  readonly error?: FormError
}

export function ConnectForm({ values, onChange, consent, consentLoading, showMissing, error }: ConnectFormProps) {
  const t = useT()
  // A malformed value is flagged while typing; an empty one only once Continue was pressed.
  const apiIdError = fieldError(values.apiId, isValidApiId, showMissing)
  const apiHashError = fieldError(values.apiHash, isValidApiHash, showMissing)
  const phoneError = values.method === "phone" ? fieldError(values.phone, isValidPhone, showMissing) : null
  const agreedError = showMissing && !values.agreed

  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="tg-consent-title" className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
        <h4 id="tg-consent-title" className="text-sm font-semibold">
          {t("tgacct.consent.title")}
        </h4>
        {consentLoading || !consent ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t("tgacct.consent.loading")}
          </p>
        ) : (
          // dir="auto": the terms arrive in the server's language, which need
          // not be the app's — English terms in a Hebrew UI must still read LTR.
          <ul dir="auto" className="flex list-disc flex-col gap-1 ps-5 text-xs leading-relaxed text-muted-foreground">
            {consent.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="tg-keys-title" className="flex flex-col gap-2">
        <h4 id="tg-keys-title" className="text-sm font-semibold">
          {t("tgacct.keys.title")}
        </h4>
        <p className="text-xs text-muted-foreground">
          {t("tgacct.keys.help")}{" "}
          <a
            href="https://my.telegram.org/apps"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
          >
            {t("tgacct.keys.openSite")}
            <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[140px_1fr]">
          <div className="flex flex-col gap-1">
            <Label htmlFor={FIELD_IDS.apiId}>{t("tgacct.apiId")}</Label>
            <Input
              id={FIELD_IDS.apiId}
              inputMode="numeric"
              autoComplete="off"
              dir="ltr"
              value={values.apiId}
              aria-invalid={apiIdError !== null}
              onChange={(e) => onChange({ apiId: e.target.value })}
            />
            {apiIdError && (
              <p className="text-[11px] text-destructive">
                {t(apiIdError === "missing" ? "tgacct.apiIdRequired" : "tgacct.apiIdInvalid")}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={FIELD_IDS.apiHash}>{t("tgacct.apiHash")}</Label>
            <Input
              id={FIELD_IDS.apiHash}
              type="password"
              autoComplete="off"
              spellCheck={false}
              dir="ltr"
              value={values.apiHash}
              aria-invalid={apiHashError !== null}
              onChange={(e) => onChange({ apiHash: e.target.value })}
            />
            {apiHashError && (
              <p className="text-[11px] text-destructive">
                {t(apiHashError === "missing" ? "tgacct.apiHashRequired" : "tgacct.apiHashInvalid")}
              </p>
            )}
          </div>
        </div>
      </section>

      <section aria-labelledby="tg-method-title" className="flex flex-col gap-2">
        <h4 id="tg-method-title" className="text-sm font-semibold">
          {t("tgacct.method")}
        </h4>
        <RadioGroup
          value={values.method}
          onValueChange={(value) => onChange({ method: value as "qr" | "phone" })}
          className="flex flex-col gap-2"
        >
          <div className="flex items-start gap-2">
            <RadioGroupItem value="qr" id="tg-method-qr" className="mt-0.5" />
            <label htmlFor="tg-method-qr" className="flex cursor-pointer flex-col">
              <span className="text-sm">{t("tgacct.method.qr")}</span>
              <span className="text-xs text-muted-foreground">{t("tgacct.method.qrHint")}</span>
            </label>
          </div>
          <div className="flex items-start gap-2">
            <RadioGroupItem value="phone" id="tg-method-phone" className="mt-0.5" />
            <label htmlFor="tg-method-phone" className="flex cursor-pointer flex-col">
              <span className="text-sm">{t("tgacct.method.phone")}</span>
              <span className="text-xs text-muted-foreground">{t("tgacct.method.phoneHint")}</span>
            </label>
          </div>
        </RadioGroup>
        {values.method === "phone" && (
          <div className="flex flex-col gap-1 ps-6">
            <Label htmlFor={FIELD_IDS.phone}>{t("tgacct.phone")}</Label>
            <Input
              id={FIELD_IDS.phone}
              type="tel"
              autoComplete="tel"
              dir="ltr"
              value={values.phone}
              aria-invalid={phoneError !== null}
              onChange={(e) => onChange({ phone: e.target.value })}
            />
            {phoneError && (
              <p className="text-[11px] text-destructive">
                {t(phoneError === "missing" ? "tgacct.phoneRequired" : "tgacct.phoneInvalid")}
              </p>
            )}
          </div>
        )}
      </section>

      <div
        className={cn(
          "flex flex-col gap-1 rounded-lg border p-3",
          agreedError ? "border-destructive bg-destructive/5" : "bg-muted/30",
        )}
      >
        <div className="flex items-center gap-2">
          <Checkbox
            id={FIELD_IDS.agreed}
            checked={values.agreed}
            disabled={!consent}
            aria-invalid={agreedError}
            aria-describedby={agreedError ? "tg-consent-error" : undefined}
            onCheckedChange={(checked) => onChange({ agreed: checked === true })}
          />
          <label htmlFor={FIELD_IDS.agreed} className="cursor-pointer text-sm font-medium">
            {t("tgacct.consent.agree")}
          </label>
        </div>
        {agreedError && (
          <p id="tg-consent-error" className="ps-6 text-[11px] text-destructive">
            {t("tgacct.consent.required")}
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 p-2.5 text-xs text-destructive">
          {t(FORM_ERROR_MESSAGE[error])}
        </p>
      )}
    </div>
  )
}

/** "missing" (empty, once Continue was pressed), "invalid" (typed but malformed), or null. */
function fieldError(value: string, isValid: (value: string) => boolean, showMissing: boolean): "missing" | "invalid" | null {
  if (value.trim() === "") return showMissing ? "missing" : null
  return isValid(value) ? null : "invalid"
}
