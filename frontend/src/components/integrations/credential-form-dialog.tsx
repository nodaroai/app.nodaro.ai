import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useT } from "@/lib/i18n"
import type { HttpCredentialSummary } from "@/lib/api"

/**
 * One dialog, two jobs (plan D12):
 *   - `create` — name, header name, the secret (typed once, masked, never read
 *     back), and the scope.
 *   - `lock`   — set or move the address on an existing credential. The
 *     binding is a ratchet: it can be changed here, never removed.
 * The dialog only collects; the card owns the API calls, so a failure toast
 * and the list refresh live in one place.
 *
 * The scope used to be a switch labelled "Only for this address", which said
 * what it did without saying which to pick. It is now two named choices with
 * the reason for each, because that is the one decision in this form a user
 * cannot make from the field name alone.
 *
 * "Any address" is DISABLED in `lock` mode, and says why. The ratchet is
 * enforced by the server, so offering the option would only produce a refusal
 * with no explanation attached to it.
 */
export interface CredentialFormValues {
  readonly name: string
  readonly headerName: string
  readonly secret: string
  readonly boundUrl: string | null
  readonly boundMatch: "exact" | "prefix"
}

interface Props {
  readonly open: boolean
  readonly mode: "create" | "lock"
  /** The credential being locked (mode `lock`); ignored for `create`. */
  readonly credential?: HttpCredentialSummary | null
  readonly saving: boolean
  readonly onSubmit: (values: CredentialFormValues) => void
  readonly onClose: () => void
}

const HEADER_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/

type Scope = "any" | "one"

export function CredentialFormDialog({ open, mode, credential, saving, onSubmit, onClose }: Props) {
  const t = useT()
  const [name, setName] = useState("")
  const [headerName, setHeaderName] = useState("Authorization")
  const [secret, setSecret] = useState("")
  const [scope, setScope] = useState<Scope>(mode === "lock" ? "one" : "any")
  const [boundUrl, setBoundUrl] = useState("")
  const [prefix, setPrefix] = useState(false)

  // Reset per opening, and drop the secret the moment the dialog closes: the
  // card keeps this component mounted, and a plaintext key sitting in state for
  // the rest of the page's life is a leak into the next heap snapshot.
  useEffect(() => {
    if (!open) {
      setSecret("")
      return
    }
    setName("")
    setHeaderName("Authorization")
    setSecret("")
    setScope(mode === "lock" ? "one" : "any")
    setBoundUrl(credential?.boundUrl ?? "")
    setPrefix(credential?.boundMatch === "prefix")
  }, [open, mode, credential])

  const isLockMode = mode === "lock"
  const locked = scope === "one"
  const urlOk = !locked || /^https:\/\/\S+$/i.test(boundUrl.trim())
  const canSubmit = isLockMode
    ? urlOk && boundUrl.trim().length > 0
    : name.trim().length > 0 && HEADER_NAME_RE.test(headerName.trim()) && secret.length > 0 && urlOk && !/[\r\n]/.test(secret)

  const submit = () => {
    if (!canSubmit || saving) return
    onSubmit({
      name: name.trim(),
      headerName: headerName.trim(),
      secret,
      boundUrl: locked ? boundUrl.trim() : null,
      boundMatch: prefix ? "prefix" : "exact",
    })
  }

  const scopeOptions: ReadonlyArray<{ id: Scope; label: string; hint: string; disabled: boolean }> = [
    {
      id: "any",
      label: t("creds.scopeAny"),
      hint: isLockMode ? t("creds.scopeAnyLocked") : t("creds.scopeAnyHint"),
      // The ratchet. A bound credential can be moved, never opened up again.
      disabled: isLockMode,
    },
    { id: "one", label: t("creds.scopeOne"), hint: t("creds.scopeOneHint"), disabled: false },
  ]

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isLockMode ? (credential?.boundUrl ? t("creds.changeAddress") : t("creds.lock")) : t("creds.add")}</DialogTitle>
          <DialogDescription>{isLockMode ? t("creds.lockHint") : t("creds.subtitle")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {!isLockMode && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cred-name">{t("creds.name")}</Label>
                <Input id="cred-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("creds.namePh")} maxLength={80} />
              </div>

              {/* One short field and one long one, side by side — the handoff's
                  layout, and the shape of the data. */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1.25fr]">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="cred-header">{t("creds.headerName")}</Label>
                  <Input dir="ltr" id="cred-header" value={headerName} onChange={(e) => setHeaderName(e.target.value)} className="font-mono text-xs" maxLength={64} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="cred-secret">{t("creds.secret")}</Label>
                  <Input dir="ltr"
                    id="cred-secret"
                    type="password"
                    autoComplete="off"
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    placeholder={t("creds.secretPh")}
                    className="font-mono text-xs"
                    maxLength={4096}
                  />
                </div>
              </div>
              <p className="-mt-2 text-[11px] text-muted-foreground">{t("creds.secretHint")}</p>
            </>
          )}

          <fieldset className="flex flex-col gap-2.5">
            <legend className="mb-2 text-xs font-bold">{t("creds.scopeLabel")}</legend>
            {scopeOptions.map((option) => {
              const active = scope === option.id
              return (
                <label
                  key={option.id}
                  className={`flex items-start gap-3 rounded-[11px] border-[1.5px] p-3 text-start ${
                    option.disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
                  } ${active ? "border-foreground bg-background" : "border-border bg-muted/30"}`}
                >
                  {/* The native control is kept (it IS the radio — keyboard,
                      screen reader, form semantics) but drawn by the span
                      beside it. The app's base input styling fills an
                      UNCHECKED radio with a solid dark dot, so both options
                      read as selected; that is worse than unstyled. */}
                  <input
                    type="radio"
                    name="cred-scope"
                    value={option.id}
                    checked={active}
                    disabled={option.disabled}
                    onChange={() => setScope(option.id)}
                    className="peer sr-only"
                  />
                  <span
                    aria-hidden
                    className="mt-0.5 h-4 w-4 flex-none rounded-full border-[1.5px] border-muted-foreground/50 bg-background transition-all peer-checked:border-[5px] peer-checked:border-[var(--primary)] peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2"
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-[13px] font-bold">{option.label}</span>
                    <span className="text-[11.5px] leading-[1.45] text-muted-foreground">{option.hint}</span>
                  </span>
                </label>
              )
            })}

            {locked && (
              <div className="flex flex-col gap-2.5 rounded-[11px] border border-border bg-muted/30 p-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="cred-url">{t("creds.boundUrl")}</Label>
                  <Input dir="ltr"
                    id="cred-url"
                    value={boundUrl}
                    onChange={(e) => setBoundUrl(e.target.value)}
                    placeholder="https://hooks.example.com/in/abc"
                    className="font-mono text-xs"
                    maxLength={2048}
                  />
                </div>
                <div className="flex items-start gap-3">
                  <Switch id="cred-prefix" checked={prefix} onCheckedChange={setPrefix} className="mt-0.5" />
                  <Label htmlFor="cred-prefix" className="flex cursor-pointer flex-col items-start gap-0.5">
                    <span className="text-[12.5px] font-semibold">{t("creds.subpathsToggle")}</span>
                    <span className="text-[11.5px] font-normal text-muted-foreground">{t("creds.subpathsHint")}</span>
                  </Label>
                </div>
              </div>
            )}
          </fieldset>
        </div>

        <DialogFooter className="items-center gap-3 sm:justify-between">
          <span className="text-[11.5px] text-muted-foreground">{t("creds.footerNote")}</span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>{t("creds.cancel")}</Button>
            <Button onClick={submit} disabled={!canSubmit || saving}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {saving ? t("creds.saving") : t("creds.save")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
