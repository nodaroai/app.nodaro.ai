import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { CheckCircle2, Loader2, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useT } from "@/lib/i18n"
import { getTelegramConsent } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"
import { ConnectForm, EMPTY_FORM, canSubmit, normalizePhone, type ConnectFormValues } from "./connect-form"
import { FAILURE_MESSAGE } from "./login-messages"
import { TelegramQrCode } from "./telegram-qr-code"
import { useTelegramLogin } from "./use-telegram-login"

/**
 * "Connect a Telegram account" — the wizard. The server runs the login; this
 * dialog shows its steps: the form, a QR code to scan (primary), a phone code
 * and the two-step password (when the account has one), then done or failed.
 *
 * Secrets typed here (api_hash, code, password) live only in this component's
 * state and are dropped when it closes. Closing mid-login cancels the attempt
 * on the server as well.
 */

interface TelegramConnectDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onConnected: () => void
}

export function TelegramConnectDialog({ open, onOpenChange, onConnected }: TelegramConnectDialogProps) {
  const t = useT()
  const login = useTelegramLogin({ onConnected })
  const [values, setValues] = useState<ConnectFormValues>(EMPTY_FORM)
  const [code, setCode] = useState("")
  const [password, setPassword] = useState("")
  const consent = useQuery({
    queryKey: queryKeys.telegramAccounts.consent(),
    queryFn: getTelegramConsent,
    enabled: open,
    staleTime: 5 * 60_000,
  })

  const { view } = login
  const formError = view.step === "form" ? view.error : undefined
  const refetchConsent = consent.refetch

  // Terms changed under the owner: show the new ones and ask again.
  useEffect(() => {
    if (formError !== "consent_outdated") return
    setValues((current) => ({ ...current, agreed: false }))
    void refetchConsent()
  }, [formError, refetchConsent])

  const close = () => {
    if (view.step !== "done") login.cancel()
    setValues(EMPTY_FORM)
    setCode("")
    setPassword("")
    onOpenChange(false)
  }

  const startOver = () => {
    login.cancel()
    setCode("")
    setPassword("")
  }

  const submitForm = () => {
    if (!consent.data || !canSubmit(values, consent.data)) return
    void login.start({
      method: values.method,
      apiId: values.apiId.trim(),
      apiHash: values.apiHash.trim(),
      ...(values.method === "phone" ? { phone: normalizePhone(values.phone) } : {}),
      consentVersion: consent.data.version,
    })
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-[520px]"
        // The description promises nothing reaches Telegram until Continue —
        // true on the form only, so later steps carry none (and say so to Radix).
        {...(view.step === "form" ? {} : { "aria-describedby": undefined })}
      >
        <DialogHeader>
          <DialogTitle>{t("tgacct.dialog.title")}</DialogTitle>
          {view.step === "form" && <DialogDescription>{t("tgacct.dialog.description")}</DialogDescription>}
        </DialogHeader>

        {view.step === "form" && (
          <ConnectForm
            values={values}
            onChange={(patch) => setValues((current) => ({ ...current, ...patch }))}
            consent={consent.data}
            consentLoading={consent.isLoading}
            {...(view.error ? { error: view.error } : {})}
          />
        )}

        {view.step === "qr" && (
          <div className="flex flex-col items-center gap-3 text-center">
            <h4 className="text-sm font-semibold">{t("tgacct.qr.title")}</h4>
            <p className="max-w-[380px] text-xs text-muted-foreground">{t("tgacct.qr.steps")}</p>
            <TelegramQrCode loginUrl={view.loginUrl} alt={t("tgacct.qr.alt")} />
            <p className="text-[11px] text-muted-foreground">{t("tgacct.qr.refreshes")}</p>
            <p className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t("tgacct.qr.waiting")}
            </p>
          </div>
        )}

        {view.step === "code" && (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (code.trim()) void login.submitCode(code.trim())
            }}
          >
            <h4 className="text-sm font-semibold">{t("tgacct.code.title")}</h4>
            <p className="text-xs text-muted-foreground">{t("tgacct.code.body")}</p>
            <Label htmlFor="tg-code">{t("tgacct.code.label")}</Label>
            <Input
              id="tg-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              dir="ltr"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              aria-invalid={view.error === "code_invalid"}
              autoFocus
            />
            {view.error === "code_invalid" && <p className="text-[11px] text-destructive">{t("tgacct.code.invalid")}</p>}
            <button type="submit" hidden />
          </form>
        )}

        {view.step === "password" && (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (password) void login.submitPassword(password)
            }}
          >
            <h4 className="text-sm font-semibold">{t("tgacct.password.title")}</h4>
            <p className="text-xs text-muted-foreground">{t("tgacct.password.body")}</p>
            <Label htmlFor="tg-password">{t("tgacct.password.label")}</Label>
            <Input
              id="tg-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={view.error === "password_invalid"}
              autoFocus
            />
            {view.hint && <p className="text-[11px] text-muted-foreground">{t("tgacct.password.hint", { hint: view.hint })}</p>}
            {view.error === "password_invalid" && (
              <p className="text-[11px] text-destructive">{t("tgacct.password.invalid")}</p>
            )}
            <button type="submit" hidden />
          </form>
        )}

        {view.step === "done" && (
          <div className="flex flex-col items-center gap-2 py-4 text-center" aria-live="polite">
            <CheckCircle2 className="h-10 w-10 text-emerald-600" aria-hidden />
            <h4 className="text-base font-semibold">{t("tgacct.done.title")}</h4>
            <p className="text-sm text-muted-foreground">{t("tgacct.done.body", { label: view.label ?? "" })}</p>
          </div>
        )}

        {view.step === "failed" && (
          <div className="flex flex-col items-center gap-2 py-4 text-center" role="alert">
            <XCircle className="h-10 w-10 text-destructive" aria-hidden />
            <h4 className="text-base font-semibold">{t("tgacct.failed.title")}</h4>
            <p className="text-sm text-muted-foreground">
              {t(FAILURE_MESSAGE[view.reason], { seconds: view.retryAfterSeconds ?? 0 })}
            </p>
          </div>
        )}

        <DialogFooter>
          {view.step === "done" ? (
            <Button onClick={close}>{t("tgacct.close")}</Button>
          ) : view.step === "failed" ? (
            <>
              <Button variant="outline" onClick={close}>
                {t("tgacct.close")}
              </Button>
              <Button onClick={startOver}>{t("tgacct.tryAgain")}</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={close}>
                {t("tgacct.cancel")}
              </Button>
              {view.step === "form" && (
                <Button onClick={submitForm} disabled={login.busy || !canSubmit(values, consent.data)}>
                  {login.busy && <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />}
                  {t("tgacct.continue")}
                </Button>
              )}
              {(view.step === "code" || view.step === "password") && (
                <Button
                  onClick={() =>
                    view.step === "code" ? void login.submitCode(code.trim()) : void login.submitPassword(password)
                  }
                  disabled={login.busy || (view.step === "code" ? !code.trim() : !password)}
                >
                  {login.busy && <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />}
                  {t("tgacct.submit")}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
