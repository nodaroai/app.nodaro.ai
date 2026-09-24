import { ExternalLink, Loader2 } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { useT } from "@/lib/i18n"
import type { TelegramConsent } from "@/lib/api"
import { FORM_ERROR_MESSAGE } from "./login-messages"
import type { FormError } from "./use-telegram-login"

/**
 * The wizard's first step: the terms (served by the server — their copy is
 * not the app's), the owner's own api_id / api_hash, and how to sign in.
 * QR is first and recommended: for a freshly created api_id, Telegram may
 * deliver a phone code only inside an already signed-in Telegram app, never
 * by SMS — the phone option says so up front.
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

export function canSubmit(values: ConnectFormValues, consent: TelegramConsent | undefined): boolean {
  return (
    values.agreed &&
    consent !== undefined &&
    isValidApiId(values.apiId) &&
    isValidApiHash(values.apiHash) &&
    (values.method === "qr" || isValidPhone(values.phone))
  )
}

interface ConnectFormProps {
  readonly values: ConnectFormValues
  readonly onChange: (patch: Partial<ConnectFormValues>) => void
  readonly consent: TelegramConsent | undefined
  readonly consentLoading: boolean
  readonly error?: FormError
}

export function ConnectForm({ values, onChange, consent, consentLoading, error }: ConnectFormProps) {
  const t = useT()
  const showApiIdError = values.apiId !== "" && !isValidApiId(values.apiId)
  const showApiHashError = values.apiHash !== "" && !isValidApiHash(values.apiHash)
  const showPhoneError = values.method === "phone" && values.phone !== "" && !isValidPhone(values.phone)

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
        <div className="flex items-center gap-2 pt-1">
          <Checkbox
            id="tg-consent"
            checked={values.agreed}
            disabled={!consent}
            onCheckedChange={(checked) => onChange({ agreed: checked === true })}
          />
          <label htmlFor="tg-consent" className="cursor-pointer text-sm">
            {t("tgacct.consent.agree")}
          </label>
        </div>
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
            <Label htmlFor="tg-api-id">{t("tgacct.apiId")}</Label>
            <Input
              id="tg-api-id"
              inputMode="numeric"
              autoComplete="off"
              dir="ltr"
              value={values.apiId}
              aria-invalid={showApiIdError}
              onChange={(e) => onChange({ apiId: e.target.value })}
            />
            {showApiIdError && <p className="text-[11px] text-destructive">{t("tgacct.apiIdInvalid")}</p>}
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="tg-api-hash">{t("tgacct.apiHash")}</Label>
            <Input
              id="tg-api-hash"
              type="password"
              autoComplete="off"
              spellCheck={false}
              dir="ltr"
              value={values.apiHash}
              aria-invalid={showApiHashError}
              onChange={(e) => onChange({ apiHash: e.target.value })}
            />
            {showApiHashError && <p className="text-[11px] text-destructive">{t("tgacct.apiHashInvalid")}</p>}
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
            <Label htmlFor="tg-phone">{t("tgacct.phone")}</Label>
            <Input
              id="tg-phone"
              type="tel"
              autoComplete="tel"
              dir="ltr"
              value={values.phone}
              aria-invalid={showPhoneError}
              onChange={(e) => onChange({ phone: e.target.value })}
            />
            {showPhoneError && <p className="text-[11px] text-destructive">{t("tgacct.phoneInvalid")}</p>}
          </div>
        )}
      </section>

      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 p-2.5 text-xs text-destructive">
          {t(FORM_ERROR_MESSAGE[error])}
        </p>
      )}
    </div>
  )
}
