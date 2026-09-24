import { useState } from "react"
import { Link, useParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { queryKeys } from "@/lib/query-keys"
import { useWorkspace } from "@/ee/hooks/use-workspace"
import { useT, type MessageKey, type TFunction } from "@/lib/i18n"
import { listOrgAudit, type OrgAuditEntry } from "@/ee/lib/orgs-api"
import { formatDateTime } from "@/lib/i18n/format"

/**
 * `/org/:slug/audit` — what happened, newest first.
 *
 * The page exists for the conversation that starts "who removed her?". Every
 * other organization screen shows the CURRENT state, which is exactly the
 * information that is useless once something has gone wrong.
 *
 * Readable while the organization is SUSPENDED, unlike every other management
 * screen. A suspension is the moment someone most needs to know what led to
 * it, and hiding the record then would be hiding it at the only point it
 * matters.
 *
 * Actions are rendered from an OPEN vocabulary. New ones arrive as the
 * product grows, and a page that threw on an unrecognised action would turn a
 * new feature into a broken screen — so anything unknown falls back to its
 * raw string, which is still readable.
 */
export default function OrgAuditPage() {
  const t = useT()
  const { slug = "" } = useParams<{ slug: string }>()
  const { organizations, status: membershipStatus } = useWorkspace()
  const [cursor, setCursor] = useState<string | undefined>(undefined)

  const membership = organizations.find((o) => o.slug === slug) ?? null
  const orgId = membership?.id ?? ""
  const canRead = membership?.role === "owner" || membership?.role === "admin"

  const audit = useQuery({
    queryKey: queryKeys.orgs.audit(orgId, cursor),
    queryFn: () => listOrgAudit(orgId, { cursor }),
    enabled: canRead && orgId !== "",
    retry: false,
  })

  if (membershipStatus === "idle" || membershipStatus === "loading") {
    return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>
  }

  // "We could not find out" is not "it does not exist". Collapsing them
  // tells an owner their school vanished because a cache blipped — the one
  // thing the three-state `me` payload exists to prevent.
  if (membershipStatus === "unavailable") {
    return (
      <div className="mx-auto max-w-xl p-6">
        <Card className="space-y-4 p-8">
          <h1 className="text-xl font-semibold">{t("org.orgsLoadFailedTitle")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("org.orgsLoadFailedBody")}
          </p>
          <Button variant="outline" onClick={() => window.location.reload()}>
            {t("common.tryAgain")}
          </Button>
        </Card>
      </div>
    )
  }

  if (!membership || !canRead) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <Card className="space-y-4 p-8">
          <h1 className="text-xl font-semibold">
            {membership ? t("org.notAvailableToYou") : t("org.orgNotFound")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {membership
              ? t("org.auditOwnerAdminOnly")
              : t("org.orgMissingOrNotMember")}
          </p>
          <Button asChild variant="outline">
            <Link to={membership ? `/org/${slug}` : "/"}>{t("common.back")}</Link>
          </Button>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">{t("org.history")}</h1>
        <Link to={`/org/${slug}`} className="text-sm text-muted-foreground hover:underline">
          {membership.name}
        </Link>
      </header>

      {audit.isLoading && <p className="text-sm text-muted-foreground">{t("common.loading")}</p>}
      {audit.error && <p className="text-sm text-muted-foreground">{t("org.historyLoadFailed")}</p>}

      {audit.data?.data.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("org.nothingRecorded")}</p>
      )}

      {(audit.data?.data.length ?? 0) > 0 && (
        <ul className="divide-y rounded-md border">
          {audit.data?.data.map((entry) => (
            <AuditRow key={entry.id} entry={entry} />
          ))}
        </ul>
      )}

      {audit.data?.nextCursor && (
        <Button variant="outline" onClick={() => setCursor(audit.data.nextCursor ?? undefined)}>
          {t("org.showOlder")}
        </Button>
      )}
      {cursor && (
        <Button variant="ghost" onClick={() => setCursor(undefined)}>
          {t("org.backToNewest")}
        </Button>
      )}
    </div>
  )
}

function AuditRow({ entry }: { entry: OrgAuditEntry }) {
  const t = useT()
  const actor = entry.actor?.displayName ?? entry.actor?.email ?? null
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm">{describeAction(entry, t)}</p>
        <p className="text-xs text-muted-foreground">
          {/* "The system" rather than a blank: an action with no actor was
              taken by nobody, and an empty space reads as missing data. */}
          {actor ?? (entry.actor ? entry.actor.userId : t("org.theSystem"))}
        </p>
      </div>
      <time className="text-xs text-muted-foreground" dateTime={entry.createdAt}>
        {formatDateTime(entry.createdAt)}
      </time>
    </li>
  )
}

/**
 * Plain words for the actions we recognise, and the raw action for the rest.
 *
 * Deliberately a LABEL MAP and not a contract: the server owns this
 * vocabulary and adds to it, and the public schema promises only that the
 * column holds a string. So this list makes no claim to be complete, the
 * fallback is the part that has to keep working, and a new action that
 * arrives before this map hears about it renders as its own name — readable,
 * if less friendly — rather than as a blank row or a thrown page.
 *
 * It covers the lifecycle this product HAS — organizations, members,
 * workspaces, invitations, join codes. Actions belonging to levers that have
 * not shipped are left to the fallback on purpose: a friendly label is a
 * commitment, and naming a feature before it exists is a promise made in the
 * wrong place. Add the label when the lever ships.
 */
const ACTION_WORDS: Record<string, MessageKey> = {
  "org.created": "org.auditOrgCreated",
  "org.approved": "org.auditOrgApproved",
  "org.suspended": "org.auditOrgSuspended",
  "org.unsuspended": "org.auditOrgRestored",
  "org.deleted": "org.auditOrgDeleted",
  "org.settings.updated": "org.auditOrgSettings",
  "org.ownership.transferred": "org.auditOwnershipTransferred",
  "org.member.invited": "org.auditMemberInvited",
  "org.member.joined": "org.auditMemberJoined",
  "org.member.role_changed": "org.auditMemberRoleChanged",
  "org.member.suspended": "org.auditMemberSuspended",
  "org.member.unsuspended": "org.auditMemberReinstated",
  "org.member.removed": "org.auditMemberRemoved",
  "org.member.left": "org.auditMemberLeft",
  "invitation.resent": "org.auditInvitationResent",
  "invitation.revoked": "org.auditInvitationRevoked",
  "workspace.created": "org.auditWsCreated",
  "workspace.updated": "org.auditWsUpdated",
  "workspace.archived": "org.auditWsArchived",
  "workspace.unarchived": "org.auditWsRestored",
  "workspace.settings.updated": "org.auditWsSettings",
  "workspace.member.added": "org.auditWsMemberAdded",
  "workspace.member.role_changed": "org.auditWsRoleChanged",
  "workspace.member.suspended": "org.auditWsMemberSuspended",
  "workspace.member.unsuspended": "org.auditWsMemberReinstated",
  "workspace.member.removed": "org.auditWsMemberRemoved",
  "workspace.join_code.rotated": "org.auditJoinCodeRotated",
  "workspace.join_code.enabled": "org.auditJoinCodeEnabled",
  "workspace.join_code.disabled": "org.auditJoinCodeDisabled",
}

function describeAction(entry: OrgAuditEntry, t: TFunction): string {
  const key = ACTION_WORDS[entry.action]
  return key ? t(key) : entry.action
}
