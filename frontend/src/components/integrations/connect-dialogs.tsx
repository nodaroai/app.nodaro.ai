import { useMemo } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { useT } from "@/lib/i18n"
import type { SocialProviderInfo } from "@/lib/api"
import { BOTFATHER_URL } from "@/lib/telegram-links"

/**
 * The two non-OAuth connect forms, lifted out of `platform-card.tsx` so the
 * card is a card. They collect and report; the card still owns the API calls,
 * so a failure toast and the list refresh stay in one place.
 */

interface TelegramDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly token: string
  readonly onTokenChange: (token: string) => void
  readonly busy: boolean
  readonly error: string | null
  readonly onConnect: () => void
}

export function TelegramConnectDialog({
  open,
  onOpenChange,
  token,
  onTokenChange,
  busy,
  error,
  onConnect,
}: TelegramDialogProps) {
  const t = useT()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("integ.connectTelegramBot")}</DialogTitle>
          <DialogDescription>
            {t("integ.telegramDescPre")}
            <a
              href={BOTFATHER_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary underline underline-offset-2"
            >
              @BotFather
            </a>
            {t("integ.telegramDescMid")}
            <code className="text-xs">/newbot</code>
            {t("integ.telegramDescPost")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 pt-2">
          <Input
            aria-label={t("integ.connectTelegramBot")}
            placeholder="123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"
            value={token}
            onChange={(e) => onTokenChange(e.target.value)}
            disabled={busy}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button onClick={onConnect} disabled={busy || !token.trim()} className="w-full">
            {busy && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
            {t("integ.connect")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

interface FieldsDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly provider: SocialProviderInfo
  readonly values: Record<string, string>
  readonly onValuesChange: (next: Record<string, string>) => void
  readonly busy: boolean
  readonly error: string | null
  readonly onConnect: () => void
}

/**
 * The form renders from the provider's own FieldSpec list, so a new backend
 * network gets its connect form for free — that stays true here.
 */
export function FieldsConnectDialog({
  open,
  onOpenChange,
  provider,
  values,
  onValuesChange,
  busy,
  error,
  onConnect,
}: FieldsDialogProps) {
  const t = useT()

  const validationError = useMemo(() => {
    for (const f of provider.customFields ?? []) {
      const value = (values[f.key] ?? "").trim()
      if (!value) return t("integ.fieldRequired", { field: f.label })
      if (f.validation && !new RegExp(f.validation).test(value)) return t("integ.fieldInvalid", { field: f.label })
    }
    return null
  }, [provider.customFields, values, t])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("integ.connectProvider", { name: provider.label })}</DialogTitle>
          <DialogDescription>{t("integ.credentialValidated", { name: provider.label })}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 pt-2">
          {(provider.customFields ?? []).map((field) => (
            <div key={field.key} className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" htmlFor={`cf-${provider.id}-${field.key}`}>
                {field.label}
              </label>
              <Input
                id={`cf-${provider.id}-${field.key}`}
                type={field.type === "password" ? "password" : "text"}
                value={values[field.key] ?? ""}
                onChange={(e) => onValuesChange({ ...values, [field.key]: e.target.value })}
                disabled={busy}
              />
              {field.hint && <p className="text-xs text-muted-foreground">{field.hint}</p>}
            </div>
          ))}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button
            onClick={onConnect}
            disabled={busy || validationError !== null}
            title={validationError ?? undefined}
            className="w-full"
          >
            {busy && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
            {t("integ.connect")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
