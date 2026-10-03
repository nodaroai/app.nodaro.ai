import { useState } from "react"
import { KeyRound, Loader2, Lock, LockOpen, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { useT } from "@/lib/i18n"
import {
  createHttpCredential,
  deleteHttpCredential,
  isEncryptionKeyMissingError,
  updateHttpCredential,
  type HttpCredentialSummary,
} from "@/lib/api"
import { useHttpCredentials } from "@/hooks/use-http-credentials"
import { CredentialFormDialog, type CredentialFormValues } from "./credential-form-dialog"

/**
 * Integrations → HTTP credentials: the keys a Webhook Output can send with.
 * Saved once, encrypted on the server, never shown again (plan D12). A row is
 * PLAIN (works on the owner's own runs only) until it is LOCKED to an address,
 * which a published app or a shared workflow requires.
 *
 * Row actions stay VISIBLE here, where the account rows in a network card put
 * theirs behind a `⋯`. That is not an inconsistency for its own sake: a
 * network card is one of three in a grid and carries three actions including a
 * destructive one, while this card is full-width with two. In the room
 * available, a visible control the user can see and label beats a menu.
 */
interface CredentialsCardProps {
  /**
   * Lets the page header's primary button open THIS card's dialog instead of
   * owning a second copy of the create flow. The card keeps the API calls and
   * the list refresh, so there is still exactly one place a credential is made.
   */
  readonly addOpen?: boolean
  readonly onAddOpenChange?: (open: boolean) => void
}

export function CredentialsCard({ addOpen, onAddOpenChange }: CredentialsCardProps = {}) {
  const t = useT()
  const { credentials, loading, error, refresh } = useHttpCredentials()
  const [dialog, setDialog] = useState<{ mode: "create" } | { mode: "lock"; credential: HttpCredentialSummary } | null>(null)
  const [saving, setSaving] = useState(false)
  const [encryptionMissing, setEncryptionMissing] = useState(false)
  const [deleting, setDeleting] = useState<HttpCredentialSummary | null>(null)

  // The page may drive the create dialog; everything else is local.
  const openDialog = dialog ?? (addOpen ? { mode: "create" as const } : null)
  const closeDialog = () => {
    setDialog(null)
    onAddOpenChange?.(false)
  }
  const openCreate = () => {
    setDialog({ mode: "create" })
    onAddOpenChange?.(true)
  }

  const submit = async (values: CredentialFormValues) => {
    if (!openDialog) return
    setSaving(true)
    try {
      if (openDialog.mode === "create") {
        await createHttpCredential({
          name: values.name,
          headerName: values.headerName,
          secret: values.secret,
          boundUrl: values.boundUrl,
          boundMatch: values.boundMatch,
        })
        toast.success(t("creds.created"))
      } else {
        await updateHttpCredential(openDialog.credential.id, { boundUrl: values.boundUrl, boundMatch: values.boundMatch })
        toast.success(t("creds.locked"))
      }
      setEncryptionMissing(false)
      closeDialog()
      await refresh()
    } catch (err) {
      setEncryptionMissing(isEncryptionKeyMissingError(err))
      toast.error(err instanceof Error ? err.message : t("creds.saveFailed"))
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    const target = deleting
    setDeleting(null)
    try {
      await deleteHttpCredential(target.id)
      toast.success(t("creds.deleted"))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("creds.saveFailed"))
    }
    await refresh()
  }

  return (
    <section
      aria-labelledby="http-credentials-heading"
      className="flex flex-col overflow-hidden rounded-[16px] border"
      style={{ borderColor: "var(--integ-line)", background: "var(--integ-surface)" }}
    >
      <div className="flex items-start justify-between gap-4 p-5 pb-4">
        <div className="flex gap-3">
          <div className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] bg-primary/10 text-primary">
            <KeyRound className="h-[18px] w-[18px]" />
          </div>
          <div className="flex flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 id="http-credentials-heading" className="text-[15px] font-bold tracking-[-0.01em]" style={{ color: "var(--integ-fg)" }}>
                {t("creds.title")}
              </h3>
              {credentials.length > 0 && (
                <span className="font-mono text-[11px]" style={{ color: "var(--integ-muted)" }}>
                  {t("creds.count", { n: credentials.length })}
                </span>
              )}
            </div>
            <p className="max-w-[440px] text-[12.5px] leading-[1.5] text-pretty" style={{ color: "var(--integ-muted)" }}>
              {t("creds.subtitle")}
            </p>
          </div>
        </div>
        <Button size="sm" variant="outline" className="h-8 shrink-0 gap-1" onClick={openCreate}>
          <Plus className="h-3.5 w-3.5" />
          {t("creds.add")}
        </Button>
      </div>

      {encryptionMissing && (
        <p role="alert" className="mx-5 mb-4 rounded-lg bg-destructive/10 p-3 text-xs text-destructive">
          {t("creds.encryptionMissing")}
        </p>
      )}

      <div className="mx-5 border-t border-dashed" style={{ borderColor: "var(--integ-line-soft)" }} />

      <div className="flex flex-col gap-2 p-5 pt-3.5">
        {loading ? (
          <div className="flex items-center gap-2 text-xs" style={{ color: "var(--integ-muted)" }}>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t("creds.loading")}
          </div>
        ) : error ? (
          <p className="text-xs" style={{ color: "var(--integ-muted)" }}>{t("creds.loadFailed")}</p>
        ) : credentials.length === 0 ? (
          // The handoff's note: an empty state should say what to do next, not
          // only that there is nothing here.
          <div className="flex flex-col gap-0.5 rounded-[11px] border border-dashed p-4" style={{ borderColor: "var(--integ-line-dashed)" }}>
            <span className="text-[13px] font-semibold" style={{ color: "var(--integ-fg)" }}>{t("creds.emptyTitle")}</span>
            <span className="text-[11.5px]" style={{ color: "var(--integ-muted)" }}>{t("creds.emptyHint")}</span>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {credentials.map((cred) => (
              // Two tiers on purpose. A bound address is long enough to push
              // the actions onto a second line on its own, which left locked
              // and plain rows looking like different components; giving the
              // address its own line keeps every row the same shape and lets a
              // long URL truncate instead of reflowing the controls.
              <li
                key={cred.id}
                className="flex flex-col gap-1.5 rounded-[11px] border px-3 py-2.5"
                style={{ borderColor: "var(--integ-line-soft)", background: "var(--integ-sunken)" }}
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className="h-1.5 w-1.5 flex-none rounded-full"
                    style={{ background: cred.boundUrl ? "var(--integ-ok)" : "var(--integ-warn)" }}
                    aria-hidden
                  />
                  <span className="truncate text-[13px] font-semibold" style={{ color: "var(--integ-fg)" }}>
                    {cred.name}
                  </span>
                  <span
                    className="flex-none rounded-md px-1.5 py-0.5 font-mono text-[11.5px]"
                    style={{ background: "var(--integ-raised)", color: "var(--integ-muted)" }}
                  >
                    {cred.headerName}
                  </span>
                  {cred.boundUrl ? (
                    <span className="inline-flex flex-none items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
                      <Lock className="h-3 w-3" />
                      {cred.boundMatch === "prefix" ? t("creds.prefixBadge") : t("creds.lockedBadge")}
                    </span>
                  ) : (
                    <span className="inline-flex flex-none items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
                      <LockOpen className="h-3 w-3" />
                      {t("creds.unlockedBadge")}
                    </span>
                  )}
                  <div className="ms-auto flex flex-none items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 text-xs"
                      onClick={() => setDialog({ mode: "lock", credential: cred })}
                      aria-label={`${cred.boundUrl ? t("creds.changeAddress") : t("creds.lock")}${t("common.labelColon")}${cred.name}`}
                    >
                      <Lock className="h-3 w-3" />
                      {cred.boundUrl ? t("creds.changeAddress") : t("creds.lock")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => setDeleting(cred)}
                      aria-label={`${t("creds.delete")}${t("common.labelColon")}${cred.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                {cred.boundUrl && (
                  <span
                    className="truncate ps-4 font-mono text-[11.5px]"
                    style={{ color: "var(--integ-muted)" }}
                    title={cred.boundUrl}
                  >
                    {cred.boundUrl}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        <span className="text-[11.5px]" style={{ color: "var(--integ-muted)" }}>{t("creds.footerNote")}</span>
      </div>

      <CredentialFormDialog
        open={openDialog !== null}
        mode={openDialog?.mode ?? "create"}
        credential={openDialog?.mode === "lock" ? openDialog.credential : null}
        saving={saving}
        onSubmit={submit}
        onClose={() => { if (!saving) closeDialog() }}
      />
      <DeleteConfirmationDialog
        isOpen={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title={t("creds.deleteTitle")}
        description={t("creds.deleteDesc")}
      />
    </section>
  )
}
