import { useCallback, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { tx, useT, type TFunction } from "@/lib/i18n"
import { OrgApiError, createInvitations, type InvitationDelivery, type WorkspaceView } from "@/ee/lib/orgs-api"

/**
 * Inviting people, by pasting the list you already have.
 *
 * Addresses arrive from a spreadsheet column, an email To: field, or a
 * message — so the field accepts commas, semicolons, newlines and spaces
 * alike, and shows what it understood BEFORE anything is sent. Someone
 * inviting thirty students needs to see that it read thirty, and which one
 * it could not.
 *
 * The result is the important half. An install with no mail provider, or a
 * single address that bounced, comes back with a LINK, and the dialog stays
 * open showing it: an invitation that exists and cannot be reached is worse
 * than one that was never created, and closing over the top of it is how
 * that happens.
 */

export const MAX_EMAILS = 200

export interface ParsedEmails {
  valid: string[]
  invalid: string[]
  /** Addresses typed more than once, reported so a count is never a surprise. */
  duplicates: number
}

/**
 * Split on anything a person might separate addresses with, lower-case, and
 * de-duplicate — the same normalization the server does, done here only so
 * the count shown matches the count sent.
 */
export function parseEmails(raw: string): ParsedEmails {
  const tokens = raw
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)

  const seen = new Set<string>()
  const valid: string[] = []
  const invalid: string[] = []
  let duplicates = 0

  for (const token of tokens) {
    // Deliberately loose: the server validates, and a client regex that
    // rejects a real address is worse than one that lets it through.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(token)) {
      if (!invalid.includes(token)) invalid.push(token)
      continue
    }
    const lower = token.toLowerCase()
    if (seen.has(lower)) {
      duplicates += 1
      continue
    }
    seen.add(lower)
    valid.push(lower)
  }
  return { valid, invalid, duplicates }
}

export interface InviteMembersDialogProps {
  orgId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Workspaces the inviter may invite into; empty = organization-level only. */
  workspaces?: WorkspaceView[]
  /** Only an org owner/admin may mint an admin, so only they see the choice. */
  canInviteAdmins?: boolean
  vocabulary?: Record<string, string>
  onInvited?: () => void
}

export function InviteMembersDialog({
  orgId,
  open,
  onOpenChange,
  workspaces = [],
  canInviteAdmins = false,
  vocabulary = {},
  onInvited,
}: InviteMembersDialogProps) {
  const t = useT()
  const [raw, setRaw] = useState("")
  const [orgRole, setOrgRole] = useState<"admin" | "member">("member")
  const [workspaceId, setWorkspaceId] = useState<string>("")
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [deliveries, setDeliveries] = useState<InvitationDelivery[] | null>(null)

  const parsed = useMemo(() => parseEmails(raw), [raw])
  const tooMany = parsed.valid.length > MAX_EMAILS
  const workspaceWord = vocabulary.workspace ?? t("org.workspaceWord")

  const reset = useCallback(() => {
    setRaw("")
    setOrgRole("member")
    setWorkspaceId("")
    setProblem(null)
    setDeliveries(null)
  }, [])

  const send = useCallback(async () => {
    if (busy || parsed.valid.length === 0 || tooMany) return
    setBusy(true)
    setProblem(null)
    try {
      const result = await createInvitations(orgId, {
        emails: parsed.valid,
        ...(orgRole === "admin" ? { orgRole } : {}),
        ...(workspaceId ? { workspaceId } : {}),
      })
      setDeliveries(result)
      onInvited?.()
      // The dialog stays open when anything needs a link handed over; there
      // is nowhere else that information exists.
      if (result.every((d) => d.status === "sent")) {
        onOpenChange(false)
        reset()
      }
    } catch (err: unknown) {
      setProblem(failureMessage(err instanceof OrgApiError ? err.code : "internal_error"))
    } finally {
      setBusy(false)
    }
  }, [busy, parsed.valid, tooMany, orgId, orgRole, workspaceId, onInvited, onOpenChange, reset])

  const needsHandOver = (deliveries ?? []).filter((d) => d.link)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) reset()
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("org.invitePeople")}</DialogTitle>
          <DialogDescription>
            {t("org.invitePasteHint")}
          </DialogDescription>
        </DialogHeader>

        {deliveries ? (
          <div className="space-y-3">
            <p className="text-sm">
              {t("org.inviteResultSummary", { sent: deliveries.filter((d) => d.status === "sent").length, handover: needsHandOver.length })}
            </p>
            {needsHandOver.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  {t("org.inviteHandoverHint")}
                </p>
                <ul className="max-h-56 space-y-2 overflow-y-auto">
                  {needsHandOver.map((delivery) => (
                    <li key={delivery.email} className="rounded-md border p-2 text-xs">
                      <p className="font-medium">{delivery.email}</p>
                      <p className="break-all text-muted-foreground">{delivery.link}</p>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="mt-2"
                        onClick={() => void navigator.clipboard?.writeText(delivery.link ?? "")}
                      >
                        {t("org.copyLink")}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <DialogFooter>
              <Button
                onClick={() => {
                  onOpenChange(false)
                  reset()
                }}
              >
                {t("common.done")}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="invite-emails">{t("org.emailAddresses")}</Label>
              <Textarea
                id="invite-emails"
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                rows={5}
                placeholder="ada@school.example, grace@school.example"
                disabled={busy}
              />
              <p className={cn("text-xs", tooMany ? "text-destructive" : "text-muted-foreground")}>
                {summarize(parsed, tooMany, t)}
              </p>
              {parsed.invalid.length > 0 && (
                <p className="text-xs text-destructive">
                  {t("org.notAnAddress", { list: parsed.invalid.slice(0, 5).join(", ") })}
                  {parsed.invalid.length > 5 ? ` ${t("org.andNMore", { n: parsed.invalid.length - 5 })}` : ""}
                </p>
              )}
            </div>

            {workspaces.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="invite-workspace">{t("org.addToWorkspace", { workspace: workspaceWord.toLowerCase() })}</Label>
                <Select value={workspaceId} onValueChange={setWorkspaceId} disabled={busy}>
                  <SelectTrigger id="invite-workspace">
                    <SelectValue placeholder={t("org.noWorkspaceOrgOnly", { workspace: workspaceWord.toLowerCase() })} />
                  </SelectTrigger>
                  <SelectContent>
                    {workspaces.map((workspace) => (
                      <SelectItem key={workspace.id} value={workspace.id}>
                        {workspace.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {canInviteAdmins && (
              <div className="space-y-2">
                <Label htmlFor="invite-role">{t("org.roleInOrg")}</Label>
                <Select value={orgRole} onValueChange={(v) => setOrgRole(v as "admin" | "member")} disabled={busy}>
                  <SelectTrigger id="invite-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">{vocabulary.workspace_member ?? t("org.roleMember")}</SelectItem>
                    <SelectItem value="admin">{vocabulary.org_admin ?? t("org.roleAdmin")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {problem && <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{problem}</p>}

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                {t("common.cancel")}
              </Button>
              <Button onClick={send} disabled={busy || parsed.valid.length === 0 || tooMany}>
                {busy ? t("pipe.sending") : sendLabel(parsed.valid.length, t)}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function summarize(parsed: ParsedEmails, tooMany: boolean, t: TFunction): string {
  if (tooMany) return t("org.tooManyAddresses", { n: parsed.valid.length, max: MAX_EMAILS })
  if (parsed.valid.length === 0) return t("org.noAddressesYet")
  const parts = [parsed.valid.length === 1 ? t("org.oneAddress") : t("org.nAddresses", { n: parsed.valid.length })]
  if (parsed.duplicates > 0) parts.push(t("org.nRepeated", { n: parsed.duplicates }))
  return `${parts.join(", ")}.`
}

function sendLabel(count: number, t: TFunction): string {
  if (count === 0) return t("org.sendInvitations")
  return count === 1 ? t("org.sendOneInvitation") : t("org.sendNInvitations", { n: count })
}

function failureMessage(code: string): string {
  switch (code) {
    case "bulk_invite_cap_exceeded":
      return tx("org.inviteCapExceeded")
    case "insufficient_role":
      return tx("org.inviteInsufficientRole")
    case "org_not_active":
      return tx("org.inviteOrgNotActive")
    case "workspace_archived":
      return tx("org.inviteWorkspaceArchived")
    case "validation_error":
      return tx("org.inviteValidationError")
    default:
      return tx("org.inviteFailedGeneric")
  }
}
